---
title: Fixing the DTU Mock Server Implementation
date: 2026-02-17 19:40
author: peterp
---

# Fixing the DTU Mock Server Implementation

## Summary
Fixed the mock GitHub Actions API implementation in the DTU (Digital Twin Universe) to allow the runner to successfully pick up and dispatch jobs. This involved aligning the JSON message structure with the runner's C# SDK expectations.

## The Problem
The GitHub Actions runner was failing to pick up jobs from our mock server. Initially, it reported "received message 0 with unsupported message type .". After correcting the message type, it threw a `NullReferenceException` in `JobDispatcher.Run` and later a `JsonWebTokenDeserializationException`.

```text
[RUNNER 2026-02-17 16:32:33Z INFO Runner] Received message 1 with unsupported message type PipelineAvailable.
An error occurred: Object reference not set to an instance of an object.
GitHub.Services.WebApi.Jwt.JsonWebTokenDeserializationException: Failed to deserialize the JsonWebToken object.
```

## Investigation & Timeline
*   **Initial State:** The mock server was sending a `PipelineAvailable` message with camelCase properties and was missing mandatory containers like `Resources.Endpoints`.
*   **Attempts:**
    *   Renamed `PipelineAvailable` to `PipelineAgentJobRequest` in `server.ts`.
    *   Switched property casing to PascalCase to match the runner's `VssJsonMediaTypeFormatter` defaults.
    *   Added `Workspace: {}`, `ContextData: {}`, and `Resources` objects.
    *   Mocked a `SystemVssConnection` within `Resources.Endpoints` to satisfy the runner's orchestration requirements.
    *   Replaced a simple string token with a 3-part JWT (`header.payload.signature`) using `alg: "None"` and `typ: "JWT"` to prevent deserialization errors.

```typescript
// Updated message structure in server.ts
Body: JSON.stringify({
    MessageType: 'PipelineAgentJobRequest',
    Plan: { PlanId: crypto.randomUUID() },
    Timeline: { Id: crypto.randomUUID() },
    JobId: crypto.randomUUID(),
    RequestId: parseInt(jobId) || 1,
    Resources: { Endpoints: [ { Name: "SystemVssConnection", ... } ] },
    Workspace: {},
    ContextData: {}
})
```

## Discovery & Key Findings
*   **Casing Sensitivity:** While many GitHub REST APIs use camelCase, the `distributedtask` polling endpoint involves deserializing raw bodies directly into C# types like `AgentJobRequestMessage`. Without explicit `[DataMember(Name = "...")]` overrides, these fields require PascalCase JSON keys.
*   **Mandatory Fields:** The runner's `JobDispatcher.cs` expects `Resources.Endpoints` to be iterable and attempts to parse a JWT from the `SystemVssConnection` authorization parameters to find an `orch_id`.
*   **JWT Strictness:** The runner's `JsonWebToken.Create` method expects exactly three dot-separated parts and is case-sensitive regarding the `alg` header (it must be `None`, not `none`).

## Resolution
The mock server in [dtu/github-actions/src/server.ts](dtu/github-actions/src/server.ts) was updated to use the correct `PipelineAgentJobRequest` type, PascalCase property keys, and a valid three-part JWT for the system connection. Additionally, the `GITHUB_API_URL` in [runner/.env](runner/.env) was updated to include the repository path, allowing the runner to correctly parse the organization name for its service initialization.

## Next Steps
- [ ] Implement full job execution logic (steps, variables) within the DTU mock.
- [ ] Connect the runner output back to the bridge for real-time reporting.
- [ ] Verify handling of job cancellation and sequence ids.
