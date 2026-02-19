---
title: Unify job logging across local and remote runners
date: 2026-02-18 20:49
author: peterp
---

# Unify job logging across local and remote runners

## Summary

I unified the logging implementation for local and remote jobs by creating a shared logger utility and updating the runner components to follow a consistent directory structure and naming convention.

## The Problem

Logging was inconsistent across different runner modes. Local jobs used `_/logs` directly for streaming, while executors and warm pools used `_/logs/pending`. Filename patterns also varied, and there was no unified way to prepend or append exit codes consistently.

## Investigation & Timeline

- **Initial State:**
  - `localJob.ts` had its own `getTimestamp()` and logged directly to `_/logs`.
  - `executor.ts` and `warm-pool.ts` used a `PENDING_LOGS_DIR` but differed in how they moved or renamed logs on completion.
  - Terminology was inconsistent (e.g., "pending" vs "active").
- **Attempts:**
  - Designed a 3-stage directory structure: `pending` -> `in-progress` -> `completed`.
  - Centralized timestamp and path logic in a new `runner/src/logger.ts` file.
  - Updated `localJob.ts`, `executor.ts`, and `warm-pool.ts` to use the shared logic.

## Discovery & Key Findings

- GitHub Actions uses `in-progress` (with a hyphen) for its own job states, so we adopted that for consistency.
- Centralizing the `finalizeLog` logic allowed us to easily support commit SHA subdirectories in the `completed` folder for remote jobs.

## Resolution

Created `runner/src/logger.ts` with:

- `getTimestamp()`: Consistent `YYYYMMDD-HHmm` format.
- `ensureLogDirs()`: Creates the 3 directories.
- `finalizeLog()`: Appends `-exitCode` and moves logs to `completed/`.

Modified components to remove duplicate logic and use these shared helpers.

## Next Steps

- [ ] Monitor log rotation and cleanup strategy as the number of completed logs grows.
- [ ] Integrate these logs into the Bridge UI for better visibility.
