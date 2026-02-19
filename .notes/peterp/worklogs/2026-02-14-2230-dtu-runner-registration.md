---
title: Implementing Mock Runner Registration in DTU
date: 2026-02-14 22:30
author: peterp
---

# Implementing Mock Runner Registration in DTU

## Summary

Investigated and implemented missing GitHub API endpoints in the Digital Twin Universe (DTU) to support full runner registration emulation. Added automated Vitest tests to verify the API routes.

## The Problem

The DTU mock server was missing endpoints required for the runner registration flow, specifically for fetching installation IDs and registration tokens. We wanted to ensure every step of the GitHub communication is emulated locally.

## Investigation & Timeline

- **Initial State:** The DTU only emulated job fetching and basic JWT exchange. The bridge was still configured to hit the real GitHub API (or fail) for registration tokens.
- **Attempts:**
  - Identified missing endpoints in `bridge/src/github.ts`.
  - Added `GET /repos/:owner/:repo/installation` and `POST /repos/:owner/:repo/actions/runners/registration-token` to `dtu/github-actions/src/server.ts`.
  - Refactored `server.ts` to export the server instance for testing.
  - Installed `vitest` and wrote `server.test.ts`.
  - Encountered `ZodError` in tests due to missing environment variables (`BRIDGE_URL`, `GITHUB_WEBHOOK_SECRET`).
  - Resolved by injecting dummy environment variables into the `test` script in `package.json`.

## Discovery & Key Findings

- The official GitHub Actions runner depends on the `/registration-token` endpoint for setup.
- ES module hoisting in Vitest requires environment variables to be set in the shell or via a configuration file rather than at the top of the test file if they are needed by imported modules during initialization.

## Resolution

Implemented the missing endpoints in `dtu/github-actions/src/server.ts` and added a comprehensive test suite in `server.test.ts`. Updated `package.json` with a robust `test` script.

## Next Steps

- [x] Verify full orchestrator boot with mock registration.
- [ ] Add more edge cases to DTU (e.g., token expiration).
- [ ] Implement mock runner status updates in DTU.
