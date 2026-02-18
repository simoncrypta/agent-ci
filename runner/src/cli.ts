import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import { config } from "./config.js";

import { executeLocalJob } from "./localJob.js";
import { getWorkflowTemplate, parseWorkflowSteps, isWorkflowRelevant } from "./workflowParser.js";
import { Job } from "./types.js";

async function run() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "run") {
    // Basic argument parsing
    let sha: string | undefined;
    let workflow: string | undefined;
    let jobName: string | undefined;
    let runAll = false;
    let branch: string | undefined;

    for (let i = 1; i < args.length; i++) {
        if ((args[i] === "--workflow" || args[i] === "-w") && args[i+1]) {
            workflow = args[i+1];
            i++;
        } else if ((args[i] === "--job" || args[i] === "-j") && args[i+1]) {
            jobName = args[i+1];
            i++;
        } else if (args[i] === "--all" || args[i] === "-a") {
            runAll = true;
        } else if (args[i] === "--branch" && args[i+1]) {
            branch = args[i+1];
            i++;
        } else if (!args[i].startsWith("-")) {
            sha = args[i];
        }
    }

    if (runAll && !workflow) {
        await handleRunAll({ sha, branch, jobName });
    } else {
        await handleRun({ sha, workflow, jobName });
    }
  } else {
    console.log("Usage: oa <command> [args]");
    console.log("Commands:");
    console.log("  run [sha] [--workflow <path>] [--job <name>]: Run local CI simulation (defaults to HEAD)");
    console.log("  run [sha] --all [--branch <name>]: Run all relevant PR/Push workflows for the branch");
    process.exit(1);
  }
}

function resolveRepoRoot() {
    let repoRoot = process.cwd();
    while (repoRoot !== "/" && !fs.existsSync(path.join(repoRoot, ".git"))) {
        repoRoot = path.dirname(repoRoot);
    }
    return repoRoot === "/" ? process.cwd() : repoRoot;
}

function resolveRepoInfo(repoRoot: string) {
    let githubRepo = config.GITHUB_REPO;
    try {
        const remoteUrl = execSync("git remote get-url origin", { cwd: repoRoot }).toString().trim();
        const match = remoteUrl.match(/[:/]([^/]+\/[^/]+)\.git$/);
        if (match) {
            githubRepo = match[1];
        }
    } catch (e) {
        console.warn("[OA] Could not detect remote 'origin', using config default.");
    }
    return githubRepo;
}

function resolveHeadSha(repoRoot: string, sha?: string) {
    const ref = sha || "HEAD";
    try {
        const headSha = execSync(`git rev-parse ${ref}`, { cwd: repoRoot }).toString().trim();
        console.log(`[OA] Using SHA: ${headSha} (${ref})`);
        return headSha;
    } catch (e) {
        throw new Error(`Failed to resolve ref: ${ref}`);
    }
}

function getCurrentBranch(repoRoot: string) {
    try {
        return execSync("git branch --show-current", { cwd: repoRoot }).toString().trim();
    } catch (e) {
        return "main";
    }
}

async function handleRun(options: { sha?: string; workflow?: string; jobName?: string }) {
  const { sha } = options;
  let workflow = options.workflow;
  let jobName = options.jobName;

  console.log("[OA] Starting local CI simulation...");

  try {
    const repoRoot = resolveRepoRoot();
    const headSha = resolveHeadSha(repoRoot, sha);
    const githubRepo = resolveRepoInfo(repoRoot);
    const [owner, name] = githubRepo.split("/");

    console.log(`[OA] Repo: ${githubRepo} (Root: ${repoRoot})`);

    // 4. Resolve Workflow
    const workflowsDir = path.resolve(repoRoot, ".github", "workflows");
    if (!workflow) {
        if (!fs.existsSync(workflowsDir)) {
            throw new Error(`Workflow directory not found: ${workflowsDir}`);
        }
        const yamlFiles = fs.readdirSync(workflowsDir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
        if (yamlFiles.includes("test.yml")) {
            workflow = "test.yml";
        } else if (yamlFiles.includes("ci.yml")) {
            workflow = "ci.yml";
        } else if (yamlFiles.length === 1) {
            workflow = yamlFiles[0];
        } else if (yamlFiles.length === 0) {
            throw new Error(`No workflow files found in ${workflowsDir}`);
        } else {
            console.error("[OA] Multiple workflows found. Please specify one with --workflow:");
            yamlFiles.forEach(f => console.error(`  - ${f}`));
            process.exit(1);
        }
    }

    let workflowPath: string;
    if (path.isAbsolute(workflow)) {
        workflowPath = workflow;
    } else {
        // Try relative to cwd, then repoRoot, then workflowsDir
        const pathsToTry = [
            path.resolve(workflow),
            path.resolve(repoRoot, workflow),
            path.resolve(workflowsDir, workflow)
        ];
        workflowPath = pathsToTry.find(p => fs.existsSync(p)) || pathsToTry[1]; // fallback to repoRoot relative
    }

    if (!fs.existsSync(workflowPath)) {
        throw new Error(`Workflow file not found: ${workflowPath}`);
    }

    // 5. Resolve Job
    const template = await getWorkflowTemplate(workflowPath);
    const jobs = template.jobs.filter(j => j.type === "job");

    if (!jobName) {
        if (jobs.length === 1) {
            jobName = jobs[0].id.toString();
        } else {
            const jobIds = jobs.map(j => j.id.toString());
            // Look for common entry point names
            const found = ["test", "ci", "run", "build"].find(name => jobIds.includes(name));
            if (found) {
                jobName = found;
            } else {
                console.error(`[OA] Multiple jobs found in workflow. Please specify one with --job:`);
                jobIds.forEach(id => console.error(`  - ${id}`));
                process.exit(1);
            }
        }
    }

    // Double check specific job if provided
    const jobIds = jobs.map(j => j.id.toString());
    if (!jobIds.includes(jobName)) {
        console.error(`[OA] Job "${jobName}" not found in ${path.basename(workflowPath)}. Available jobs:`);
        jobIds.forEach(id => console.error(`  - ${id}`));
        process.exit(1);
    }

    console.log(`[OA] Parsing workflow: ${path.basename(workflowPath)} (job: ${jobName})`);
    const steps = await parseWorkflowSteps(workflowPath, jobName);

    // 6. Construct Job
    const job: Job = {
      deliveryId: `local-run-${Date.now()}`,
      eventType: 'workflow_job',
      githubJobId: '123',
      githubRepo: githubRepo,
      githubToken: 'mock_token',
      headSha: headSha,
      env: {
        OA_LOCAL: 'true',
      },
      repository: {
        name: name,
        owner: { login: owner }
      },
      steps
    };

    // 7. Execute
    await executeLocalJob(job);

  } catch (error: any) {
    console.error(`[OA] Failed to trigger run: ${error.message}`);
    process.exit(1);
  }
}

async function handleRunAll(options: { sha?: string; branch?: string; jobName?: string }) {
    console.log("[OA] Scanning for relevant workflows...");
    
    try {
        const repoRoot = resolveRepoRoot();
        const headSha = resolveHeadSha(repoRoot, options.sha);
        const githubRepo = resolveRepoInfo(repoRoot);
        const [owner, name] = githubRepo.split("/");
        const branch = options.branch || getCurrentBranch(repoRoot);

        console.log(`[OA] Repo: ${githubRepo} (Root: ${repoRoot}, Branch: ${branch})`);

        const workflowsDir = path.resolve(repoRoot, ".github", "workflows");
        if (!fs.existsSync(workflowsDir)) {
            throw new Error(`Workflow directory not found: ${workflowsDir}`);
        }

        const yamlFiles = fs.readdirSync(workflowsDir).filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
        const relevantJobs: { workflowPath: string; jobName: string }[] = [];

        for (const file of yamlFiles) {
            const workflowPath = path.join(workflowsDir, file);
            const template = await getWorkflowTemplate(workflowPath);
            
            if (isWorkflowRelevant(template, branch)) {
                const jobs = template.jobs.filter(j => j.type === "job");
                for (const job of jobs) {
                    const id = job.id.toString();
                    if (!options.jobName || options.jobName === id) {
                        relevantJobs.push({ workflowPath, jobName: id });
                    }
                }
            }
        }

        if (relevantJobs.length === 0) {
            console.log("[OA] No relevant workflows found for the current branch/triggers.");
            return;
        }

        console.log(`[OA] Found ${relevantJobs.length} relevant job(s) to run.`);

        for (const { workflowPath, jobName } of relevantJobs) {
            console.log(`[OA] --- Running Workflow: ${path.basename(workflowPath)} | Job: ${jobName} ---`);
            const steps = await parseWorkflowSteps(workflowPath, jobName);
            
            const job: Job = {
                deliveryId: `local-run-${Date.now()}`,
                eventType: 'workflow_job',
                githubJobId: Math.floor(Math.random() * 1000000).toString(),
                githubRepo: githubRepo,
                githubToken: 'mock_token',
                headSha: headSha,
                env: {
                  OA_LOCAL: 'true',
                },
                repository: {
                  name: name,
                  owner: { login: owner }
                },
                steps
            };
            
            await executeLocalJob(job);
        }

    } catch (error: any) {
        console.error(`[OA] Failed to run all: ${error.message}`);
        process.exit(1);
    }
}

run().catch((err) => {
  console.error("[OA] Fatal error:", err);
  process.exit(1);
});
