---
title: Storing Docker Runner Logs
date: 2026-02-16 14:02
author: peterp
---

# Storing Docker Runner Logs

## Summary

Implemented a structured logging system for GitHub Action Runners. Logs are initially captured in a `pending/` directory and then moved to a commit-specific folder once a job starts. On completion, the log file is renamed to include the exit status code.

## The Problem

The goal was to store Docker container logs locally and persistently so they could be referenced even after the container was removed. The logs needed to be organized by commit SHA, include a timestamp in the filename, and indicate the success or failure status.

## Investigation & Timeline

- **Initial State:** Runners were spitting logs to `stdout/stderr` or being lost when containers were removed. `WarmPool` managed life cycle but didn't persist logs.
- **Attempts:**
  - Proposed initial structure in `implementation_plan.md`.
  - Iterated on folder and filename structure based on feedback (removing seconds from timestamp, adding `pending/` folder, using exit codes).
  - Implemented `getTimestamp()` helper and `RunnerState` updates in `runner/src/warm-pool.ts`.
  - Implemented log stream management and file renaming logic in `WarmPool.markAsActive` and `WarmPool.handleRunnerExit`.

  ```typescript
  // Re-pipe strategy: close current stream, move file, reopen stream
  runner.logStream.end(() => {
    try {
      fs.renameSync(runner.logPath, newLogPath);
      runner.logPath = newLogPath;
      runner.logStream = fs.createWriteStream(newLogPath, { flags: "a" });
    } catch (err) {
      console.error(`[WarmPool] Failed to move log file:`, err);
      runner.logStream = fs.createWriteStream(runner.logPath, { flags: "a" });
    }
  });
  ```

  - Updated `runner/src/executor.ts` to follow the same pattern for fallback jobs.

## Discovery & Key Findings

- Moving a log file while it's being written to requires closing the stream, renaming the file, and then reopening the stream with the `a` (append) flag to avoid race conditions or file locking issues.
- Grouping by `commitSha` but keeping individual run timestamps in filenames produces a clean and navigable structure.

## Resolution

The final solution involves a lifecycle where logs move from `runner/_/logs/pending/` to `runner/_/logs/<commitSha>/` and are finally renamed to include the exit code (e.g., `.0.log` or `.1.log`).

## Next Steps

- [ ] Implement a log cleanup policy (e.g., delete logs older than X days).
- [ ] Add a UI component to surface these local logs in the bridge console.
