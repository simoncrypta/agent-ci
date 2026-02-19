---
title: Fixing Runner Job Payload and Protocol Alignment
date: 2026-02-18 15:12
author: peterp
---

# Fixing Runner Job Payload and Protocol Alignment

## Summary

The primary goal was to enable the local runner to execute specific workflow steps by implementing workflow parsing and step seeding. While we successfully implemented the parsing and seeding logic, the majority of the session was spent resolving critical runner execution errors (`NullReferenceException`, `ArgumentNullException`) that prevented the job from starting. We resolved these by aligning the DTU mock server's `PipelineAgentJobRequest` payload with the runner's strict protocol requirements.

## The Problem

We started with the goal of making the local runner execute steps defined in a `.github/workflows/test.yml` file. This required:

1. Parsing the YAML into the runner protocol format.
2. Seeding those steps into the DTU mock server.
3. Ensuring the runner could fetch and execute those steps without crashing.

The specific technical hurdle was that the runner worker process would fail initialization with `System.ArgumentNullException: Value cannot be null. (Parameter 'repoFullName')` because the payload sent by the DTU was missing mandatory context or used incorrect casing.
`System.ArgumentNullException: Value cannot be null. (Parameter 'repoFullName')`
This happened even when repository variables were present, suggesting the runner was unable to deserialize the `ContextData` or `Variables` dictionaries due to casing mismatches or structural omissions.

## Investigation & Timeline

- **Initial State:** The DTU server sent job requests using camelCase fields, which worked for the dispatcher but failed for the worker process. `AccessToken` parsing was also causing `JsonWebTokenDeserializationException`.
- **Attempts:**
  - **Attempt 1:** Fixed `AccessToken` by using an empty string to bypass JWT parsing in `JobDispatcher.cs`.
  - **Attempt 2:** Added `system.github.repository` and `github.repository` to the `variables` dictionary.
  - **Attempt 3:** Discovered the worker expects PascalCase for many fields (e.g., `Jobs`, `Variables`, `ContextData`) because of C# `[DataMember]` attributes.
  - **Attempt 4:** Refactored the server to use a unified payload generator to ensure consistency between different notification paths.
  - **Attempt 5:** Resolved `ReferenceError: exports is not defined` in the runner package by performing a clean ESM build (`rm -rf dist && pnpm build`), aligning the generated code with `type: "module"`.

```typescript
// Example of the dual-casing strategy implemented
const jobRequest = {
  Variables: variables,
  variables: variables,
  ContextData: contextData,
  contextData: contextData,
  // ...
};
```

## Discovery & Key Findings

- The runner's `JobDispatcher` is more lenient with casing than the `Worker` process.
- `VariableValue` objects must have PascalCase `Value` and `IsSecret` fields.
- `ContextData` must contain a `github` dictionary with specific keys like `repository`, `actor`, and `sha` for the `JobExtension` to initialize.
- Stale CommonJS builds in the `dist` folder can cause `ReferenceError: exports is not defined` when `package.json` specifies `type: "module"`. Always perform a clean build when switching between module systems.

## Resolution

Refactored `dtu/github-actions/src/server.ts` to use a `createJobResponse` helper that generates a robust, dual-cased payload. This ensures that regardless of whether the runner fetches a job via polling or is notified via seeding, it receives the exact structure required for successful execution.

## Next Steps

- [ ] Restore Docker infrastructure (daemon went down during final verification).
- [ ] Run end-to-end verification of the "HelloWorld" workflow once Docker is back.
- [ ] Clean up redundant camelCase fields once PascalCase is confirmed as sufficient.
