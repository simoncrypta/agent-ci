import path from "path";
import fs from "fs";
import { type JobResult, type StepResult, tailLogFile } from "../output/reporter.js";

// ─── Timeline parsing ─────────────────────────────────────────────────────────

/**
 * Read `timeline.json` and map task records into `StepResult[]`.
 */
export function parseTimelineSteps(timelinePath: string): StepResult[] {
  try {
    if (!fs.existsSync(timelinePath)) {
      return [];
    }
    const records: any[] = JSON.parse(fs.readFileSync(timelinePath, "utf-8"));
    return records
      .filter((r: any) => r.type === "Task" && r.name)
      .map((r: any) => ({
        name: r.name,
        status:
          r.result === "Succeeded" || r.result === "succeeded"
            ? ("passed" as const)
            : r.result === "Failed" || r.result === "failed"
              ? ("failed" as const)
              : r.result === "Skipped" || r.result === "skipped"
                ? ("skipped" as const)
                : r.state === "completed"
                  ? ("passed" as const)
                  : ("skipped" as const),
      }));
  } catch {
    return [];
  }
}

// ─── Step name sanitization ───────────────────────────────────────────────────

/**
 * Reproduce the DTU sanitization logic for step log filenames.
 */
export function sanitizeStepName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 80);
}

// ─── Failure details extraction ───────────────────────────────────────────────

export interface FailureDetails {
  exitCode?: number;
  stepLogPath?: string;
  tailLines?: string[];
  failureHighlights?: string[];
  failedTaskDetails?: Array<{ task: string; command?: string; error?: string; hint?: string }>;
}

function isSignalErrorLine(raw: string): boolean {
  const line = raw.trim();
  if (!line) {
    return false;
  }

  return (
    line.includes("Validation Error") ||
    /^Module\s+.+\s+was not found\./.test(line) ||
    line.startsWith("command not found:") ||
    line.includes("error TS") ||
    line.includes("Cannot find module") ||
    line.includes("Cannot find package") ||
    line.startsWith("Error [") ||
    line.startsWith("Error:") ||
    line.includes("ERR_")
  );
}

function extractFailureHighlights(lines: string[], max = 5): string[] {
  const actionable: string[] = [];
  const generic: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!isSignalErrorLine(trimmed)) {
      continue;
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    if (trimmed.includes("Validation Error")) {
      generic.push(trimmed);
    } else {
      actionable.push(trimmed);
    }
  }

  const highlights: string[] = [];
  for (const line of actionable) {
    highlights.push(line);
    if (highlights.length >= max) {
      break;
    }
  }
  for (const line of generic) {
    if (highlights.length >= max) {
      break;
    }
    highlights.push(line);
  }
  return highlights;
}

function extractFailedTaskDetails(stepLogPath: string): {
  details: Array<{ task: string; command?: string; error?: string; hint?: string }>;
  highlights: string[];
} {
  try {
    const content = fs.readFileSync(stepLogPath, "utf-8");
    const lines = content.split("\n");
    const highlights = extractFailureHighlights(lines);

    const failedTasksIdx = lines.findIndex((l) => l.trim() === "Failed tasks:");
    if (failedTasksIdx < 0) {
      return { details: [], highlights };
    }

    const failedTasks: string[] = [];
    for (let i = failedTasksIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith("- ")) {
        break;
      }
      failedTasks.push(line.slice(2).trim());
    }

    if (failedTasks.length === 0) {
      return { details: [], highlights };
    }

    const commandFailures = lines
      .map((line, index) => {
        const m = line.match(/Warning: command "(.+?)" exited with non-zero status code/);
        if (!m) {
          return undefined;
        }
        return { command: m[1], index };
      })
      .filter((item): item is { command: string; index: number } => Boolean(item));

    const nearestSignalError = (anchor: number): string | undefined => {
      const start = Math.max(0, anchor - 40);
      const end = Math.min(lines.length - 1, anchor + 5);
      for (let i = end; i >= start; i--) {
        if (isSignalErrorLine(lines[i])) {
          return lines[i].trim();
        }
      }
      return undefined;
    };

    const details: Array<{ task: string; command?: string; error?: string; hint?: string }> = [];
    if (failedTasks.length === commandFailures.length) {
      for (let i = 0; i < failedTasks.length; i++) {
        details.push({
          task: failedTasks[i],
          command: commandFailures[i].command,
          error: nearestSignalError(commandFailures[i].index),
          hint: "mapped by command failure order",
        });
      }
    } else {
      const fallbackError = highlights[0];
      for (const task of failedTasks) {
        details.push({
          task,
          error: fallbackError,
          hint:
            commandFailures.length > 0
              ? "multiple failures detected; task-specific command mapping ambiguous"
              : "no explicit command failure markers found in step log",
        });
      }
    }
    return { details, highlights };
  } catch {
    return { details: [], highlights: [] };
  }
}

/**
 * Given a failed step name and the timeline, extract:
 *  - The actual exit code (from the issues array)
 *  - The path to the step's log file
 *  - The last N lines of that log
 */
export function extractFailureDetails(
  timelinePath: string,
  failedStepName: string,
  logDir: string,
): FailureDetails {
  const result: FailureDetails = {};
  try {
    const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf-8"));
    const failedRecord = timeline.find((r: any) => r.name === failedStepName && r.type === "Task");
    if (!failedRecord) {
      return result;
    }

    // Attempt to parse the actual step exit code from the issues array
    const issueMsg = failedRecord.issues?.find((i: any) => i.type === "error")?.message;
    if (issueMsg) {
      const m = issueMsg.match(/exit code (\d+)/i);
      if (m) {
        result.exitCode = parseInt(m[1], 10);
      }
    }

    const stepsDir = path.join(logDir, "steps");
    const sanitized = sanitizeStepName(failedStepName);

    // Try sanitized name first, then record.id (feed handler), then log.id (POST/PUT handlers)
    for (const id of [sanitized, failedRecord.id, failedRecord.log?.id]) {
      if (!id) {
        continue;
      }
      const stepLogPath = path.join(stepsDir, `${id}.log`);
      if (fs.existsSync(stepLogPath)) {
        result.stepLogPath = stepLogPath;
        result.tailLines = tailLogFile(stepLogPath);
        const extracted = extractFailedTaskDetails(stepLogPath);
        result.failedTaskDetails = extracted.details;
        result.failureHighlights = extracted.highlights;
        break;
      }
    }
  } catch {
    /* best-effort */
  }
  return result;
}

// ─── Step output extraction ───────────────────────────────────────────────────

/**
 * Extract step outputs from the runner's `_runner_file_commands/` directory.
 *
 * The GitHub Actions runner writes step outputs to files named `set_output_<uuid>`
 * in `<workDir>/_runner_file_commands/`. Each file contains key=value pairs,
 * with multiline values using the heredoc format:
 *   key<<DELIMITER
 *   line1
 *   line2
 *   DELIMITER
 *
 * @param workDir The container's work directory (bind-mounted from host)
 * @returns Record<string, string> of all output key-value pairs
 */
export function extractStepOutputs(workDir: string): Record<string, string> {
  const outputs: Record<string, string> = {};

  // The runner writes to _temp/_runner_file_commands/ under the work dir
  // $GITHUB_OUTPUT = /home/runner/_work/_temp/_runner_file_commands/set_output_<uuid>
  const candidates = [
    path.join(workDir, "_temp", "_runner_file_commands"),
    path.join(workDir, "_runner_file_commands"),
  ];

  for (const fileCommandsDir of candidates) {
    if (!fs.existsSync(fileCommandsDir)) {
      continue;
    }

    let entries: string[];
    try {
      entries = fs.readdirSync(fileCommandsDir).sort(); // Sort for deterministic override order
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.startsWith("set_output_")) {
        continue;
      }

      try {
        const content = fs.readFileSync(path.join(fileCommandsDir, entry), "utf-8");
        parseOutputFileContent(content, outputs);
      } catch {
        // Best-effort: skip unreadable files
      }
    }
  }

  return outputs;
}

/**
 * Parse the content of a single set_output file into the outputs record.
 * Handles both `key=value` and `key<<DELIMITER\nvalue\nDELIMITER` formats.
 */
function parseOutputFileContent(content: string, outputs: Record<string, string>): void {
  const lines = content.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heredoc format: key<<DELIMITER
    const heredocMatch = line.match(/^([^=]+)<<(.+)$/);
    if (heredocMatch) {
      const key = heredocMatch[1];
      const delimiter = heredocMatch[2];
      const valueLines: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== delimiter) {
        valueLines.push(lines[i]);
        i++;
      }
      outputs[key] = valueLines.join("\n");
      i++; // Skip the closing delimiter
      continue;
    }

    // Simple format: key=value
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0) {
      const key = line.slice(0, eqIdx);
      const value = line.slice(eqIdx + 1);
      outputs[key] = value;
    }

    i++;
  }
}

// ─── Job output resolution ────────────────────────────────────────────────────

/**
 * Resolve job output definitions against actual step outputs.
 *
 * Job output templates reference `steps.<stepId>.outputs.<name>`. Since the
 * runner writes all step outputs to `$GITHUB_OUTPUT` files keyed only by
 * output name (not step ID), we resolve by matching the output name from
 * the template against the flat step outputs map.
 *
 * @param outputDefs  Job output definitions from parseJobOutputDefs
 * @param stepOutputs Flat step outputs from extractStepOutputs
 * @returns Resolved job outputs
 */
export function resolveJobOutputs(
  outputDefs: Record<string, string>,
  stepOutputs: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [outputName, template] of Object.entries(outputDefs)) {
    // Replace ${{ steps.<id>.outputs.<name> }} with the actual step output value
    result[outputName] = template.replace(
      /\$\{\{\s*steps\.[^.]+\.outputs\.([^\s}]+)\s*\}\}/g,
      (_match, outputKey: string) => {
        return stepOutputs[outputKey] ?? "";
      },
    );
  }

  return result;
}

// ─── Job result builder ───────────────────────────────────────────────────────

export interface BuildJobResultOpts {
  containerName: string;
  job: { workflowPath?: string; taskId?: string };
  startTime: number;
  jobSucceeded: boolean;
  lastFailedStep: string | null;
  containerExitCode: number;
  timelinePath: string;
  logDir: string;
  debugLogPath: string;
  /** Raw step outputs from $GITHUB_OUTPUT files */
  stepOutputs?: Record<string, string>;
}

/**
 * Build the structured `JobResult` from container exit state and timeline data.
 */
export function buildJobResult(opts: BuildJobResultOpts): JobResult {
  const {
    containerName,
    job,
    startTime,
    jobSucceeded,
    lastFailedStep,
    containerExitCode,
    timelinePath,
    logDir,
    debugLogPath,
    stepOutputs,
  } = opts;

  const steps = parseTimelineSteps(timelinePath);
  const result: JobResult = {
    name: containerName,
    workflow: job.workflowPath ? path.basename(job.workflowPath) : "unknown",
    taskId: job.taskId ?? "unknown",
    succeeded: jobSucceeded,
    durationMs: Date.now() - startTime,
    debugLogPath,
    steps,
  };

  if (!jobSucceeded) {
    result.failedStep = lastFailedStep ?? undefined;
    // The container exits with 0 if it successfully reported the job failure,
    // so only use the container exit code if it actually indicates a crash (non-zero).
    result.failedExitCode = containerExitCode !== 0 ? containerExitCode : undefined;

    if (lastFailedStep) {
      const failure = extractFailureDetails(timelinePath, lastFailedStep, logDir);
      if (failure.exitCode !== undefined) {
        result.failedExitCode = failure.exitCode;
      }
      result.failedStepLogPath = failure.stepLogPath;
      result.lastOutputLines = failure.tailLines ?? [];
      result.failureHighlights = failure.failureHighlights;
      result.failedTaskDetails = failure.failedTaskDetails;
    } else {
      result.lastOutputLines = [];
    }
  }

  // Attach raw step outputs (will be resolved to job outputs by cli.ts)
  if (stepOutputs && Object.keys(stepOutputs).length > 0) {
    result.outputs = stepOutputs;
  }

  return result;
}
