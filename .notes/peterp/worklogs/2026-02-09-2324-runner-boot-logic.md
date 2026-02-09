---
title: Runner Pre-warming and Availability Announcement
date: 2026-02-09 23:24
author: peterp
---

# Runner Pre-warming and Availability Announcement

## Summary
Refined the runner startup sequence to ensure it is fully ready before signaling the bridge. The runner now pulls the required Docker image (`catthehacker/ubuntu:act-latest`) on boot and makes an immediate call to the bridge to announce its online status.

## The Problem
Previously, the runner would start polling the bridge before confirming it had the necessary worker images. This could lead to a race condition where a runner accepts a job but is then stalled for minutes while downloading a multi-gigabyte Docker image, leading to timeouts or perceived "ghost" runners.

## Investigation & Timeline
*   **Initial State:** Polling started immediately on boot; image pulling was handled per-job inside `executeJob`.
*   **Attempts:**
    *   **Refactoring:** Extracted image validation logic into a standalone `ensureImageExists` utility in `executor.ts`.
    *   **Sequential Startup:** Modified `main()` to wait for `ensureImageExists()` to resolve before starting the polling interval.
    *   **Immediate Announcement:** Inserted an initial `pollJobs()` call after pre-warming but before the `setInterval` loop to ensure the bridge sees the runner as active immediately.

## Discovery & Key Findings
*   Blocking the main startup loop for `docker.pull` is safer than lazy-loading for the first job, as it guarantees the runner's capability to execute work from the moment it "reports for duty."
*   `dockerode`'s `followProgress` is essential for waiting until a pull is actually complete vs just initiated.

## Resolution
1.  **`executor.ts`**: Exported `ensureImageExists` which checks for the local existence of `ghcr.io/catthehacker/ubuntu:act-latest` and pulls it if missing.
2.  **`index.ts`**: Implemented a 3-phase startup:
    *   Phase 1: `ensureImageExists()` (Pre-warm).
    *   Phase 2: `pollJobs()` (Announce/Immediate Check).
    *   Phase 3: `setInterval(pollJobs, 10000)` (Routine Polling).

## Next Steps
- [ ] Add specific error handling for failed pre-warming (e.g., Docker daemon not running).
- [ ] Configure `GHCR` authentication if a private worker image is eventually required.
