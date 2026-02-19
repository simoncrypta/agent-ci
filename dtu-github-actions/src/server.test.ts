import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { server, jobs } from "./server.js";
import { config } from "./config.js";
import http from "node:http";

const PORT = config.DTU_PORT + 2; // Use a different port for tests

async function request(method: string, path: string, body?: any) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "localhost",
        port: PORT,
        path: path,
        method: method,
        headers: body ? { "Content-Type": "application/json" } : {},
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode || 0,
              body: data ? JSON.parse(data) : null,
            });
          } catch {
            resolve({ status: res.statusCode || 0, body: data });
          }
        });
      },
    );

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe("DTU Server", () => {
  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(PORT, () => resolve());
    });
  });

  beforeEach(() => {
    jobs.clear();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("should handle health check", async () => {
    const res = await request("GET", "/");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("online");
  });

  it("should seed a job", async () => {
    const job = { id: 123, name: "test-job" };
    const res = await request("POST", "/_dtu/seed", job);
    expect(res.status).toBe(201);
    expect(res.body.jobId).toBe("123");
    const storedJob = jobs.get("123");
    expect(storedJob.id).toBe(job.id);
    expect(storedJob.name).toBe(job.name);
  });

  it("should retrieve a seeded job", async () => {
    await request("POST", "/_dtu/seed", { id: 123, name: "test-job" });
    const res = await request("GET", "/repos/owner/repo/actions/jobs/123");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(123);
  });

  it("should handle missing job", async () => {
    const res = await request("GET", "/repos/owner/repo/actions/jobs/999");
    expect(res.status).toBe(404);
  });

  it("should handle installation lookup", async () => {
    const res = await request("GET", "/repos/owner/repo/installation");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(12345678);
    expect(res.body.access_tokens_url).toContain("/app/installations/12345678/access_tokens");
  });

  it("should handle access token exchange", async () => {
    const res = await request("POST", "/app/installations/12345678/access_tokens");
    expect(res.status).toBe(201);
    expect(res.body.token).toContain("ghs_mock_token_12345678");
  });

  it("should handle registration token generation", async () => {
    const res = await request("POST", "/repos/owner/repo/actions/runners/registration-token");
    expect(res.status).toBe(201);
    expect(res.body.token).toContain("ghr_mock_registration_token");
  });

  it("should handle pipeline service discovery", async () => {
    const res = await request("GET", "/_apis/pipelines");
    expect(res.status).toBe(200);
    expect(res.body.locationServiceData).toBeDefined();
    expect(res.body.locationServiceData.serviceDefinitions).toBeDefined();
  });

  it("should handle global runner registration", async () => {
    const res = await request("POST", "/actions/runner-registration");
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.token_schema).toBe("OAuthAccessToken");
  });

  it("should handle session creation", async () => {
    const res = await request("POST", "/distributedtask/pools/1/sessions");
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.agent.name).toBe("oa-runner");
  });

  it("should handle long polling for messages", async () => {
    // 1. Create a session first
    const sessionRes = await request("POST", "/distributedtask/pools/1/sessions");
    const sessionId = sessionRes.body.sessionId;

    // 2. Poll for messages (expecting 204 or 200 if job seeded)
    // We'll seed a job first to ensure 200
    await request("POST", "/_dtu/seed", { id: 456, name: "poll-job" });

    const pollRes = await request("GET", `/_apis/distributedtask/messages?sessionId=${sessionId}`);
    expect(pollRes.status).toBe(200);
    expect(pollRes.body.MessageType).toBe("PipelineAgentJobRequest");
    const body = JSON.parse(pollRes.body.Body);
    expect(body.JobDisplayName).toBe("poll-job");
  });
});
