---
title: Secure Bridge Auth & GitHub App Migration
date: 2026-02-11 20:18
author: peterp
---

# Secure Bridge Auth & GitHub App Migration

## Summary
Secured the communication between the runner and the bridge using a shared API key and migrated from static tokens to dynamic GitHub App installation tokens.

## The Problem
The bridge's `/jobs` endpoint lacked authentication, and the system relied on a static `GITHUB_TOKEN`, which was insecure and lacked proper scoping.

## Investigation & Timeline
* **Initial State:** The bridge polling endpoint was public, and the runner did not send any authentication headers.
* **Attempts:** 
    * Implemented `requiresAuthToken` middleware in `bridge/src/api/routes.ts`.
    * Updated `runner/src/bridge.ts` to include the `x-api-key` header in poll requests.
    * Migrated the bridge to fetch GitHub installation tokens on-demand via JWT.
    * Added a verification script `bridge/scripts/test-auth.ts`.

## Discovery & Key Findings
* GitHub App installation tokens provide better security by being short-lived and scoped to specific installations.
* A simple `x-api-key` header is sufficient for securing internal bridge-to-runner communication in the current architecture.

## Resolution
Implemented a shared secret (`BRIDGE_API_KEY`) for bridge access and integrated dynamic GitHub token generation.

## Next Steps
- [ ] Set `BRIDGE_API_KEY` in Cloudflare Secrets.
- [ ] Update runner environment with the new mandatory `BRIDGE_API_KEY`.
- [ ] Test end-to-end webhook-to-runner flow.
