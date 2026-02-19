---
title: Fix Runner Configuration and Session 404
date: 2026-02-17 16:03
author: peterp
---

# Fix Runner Configuration and Session 404

## Summary

Resolved a persistent configuration crash in the GitHub Actions runner and implemented missing API endpoints in the DTU mock server to allow successful session establishment and job polling.

## The Problem

1. **Configuration Crash:** The runner was failing with `System.InvalidOperationException: Cannot find GitHub repository/organization name from server url: 'http://host.docker.internal:8910'`. This error, while benign for the actual configuration, was being flagged as critical by the `WarmPool` manager, which then terminated the container.
2. **Session 404:** Once the crash was bypassed, the runner failed to establish a connection with `HTTP 404` because the DTU mock server lacked `/sessions` and `/messages` endpoints.

## Investigation & Timeline

- **Initial State:** Runner containers were exiting immediately after configuration with code 137 or 1.
- **Attempts:**
  - Modified `GITHUB_SERVER_URL` and `GITHUB_API_URL` to include repo paths, but the runner's internal `SystemDControlManager` still failed.
  - Identified that the error occurs after successful registration and is non-fatal for the runner's operation in Docker.
  - Modified `runner/src/warm-pool.ts` to suppress this specific error.
  - Discovered the runner then entered a busy-loop of 404s against the DTU server.

## Discovery & Key Findings

- The GitHub runner's `SystemDControlManager` attempts to calculate service names from the server URL even in non-systemd environments, leading to non-critical but noisy exceptions.
- Without a long-polling simulation (delay) on the `messages` endpoint, the runner busy-loops, generating massive log files (~60MB in minutes).

## Resolution

### Runner Fix

Modified `runner/src/warm-pool.ts` to ignore the benign SystemD error:

```typescript
if (
  errorMsg.includes("System.InvalidOperationException") &&
  !errorMsg.includes("Cannot find GitHub repository/organization name")
) {
  this.handleCriticalError(errorMsg);
}
```

### DTU Fix

Implemented `sessions` and `messages` (with 20s delay) in `dtu/github-actions/src/server.ts`:

```typescript
if (method === "GET" && url?.includes("/messages")) {
  setTimeout(() => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ count: 0, value: [] }));
  }, 20000);
  return;
}
```

## Next Steps

- [ ] Trigger a dummy job through the bridge to verify the runner executes it.
- [ ] Monitor DTU logs to ensure session state remains consistent.
