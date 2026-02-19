import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { E2ETestHarness } from "./setup.js";
import fs from "node:fs";
import path from "node:path";

describe("Runner E2E Regressions", () => {
  const harness = new E2ETestHarness();

  beforeAll(async () => {
    await harness.startDTU();
  }, 30000);

  afterAll(async () => {
    await harness.stopDTU();
  });

  it("should connect to DTU, receive tasks, and exit correctly", async () => {
    const jobId = "e2e-job-" + Date.now();
    await harness.seedJob({
      id: jobId,
      name: "e2e-test-job",
      steps: [{ id: "step-1", name: "Say Hello", run: 'echo "Hello from E2E"' }],
    });

    const result = await harness.runRunner(jobId);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("DTU seeded successfully");
    expect(result.stdout).toContain("Hello from E2E");
    expect(result.stdout).toContain("Runner exited with code 0");
  }, 60000);

  it("should place logs in a numerical directory", async () => {
    const logsDir = path.resolve(process.cwd(), "_", "logs");
    if (fs.existsSync(logsDir)) {
      const initialDirs = fs.readdirSync(logsDir).filter((d) => d.startsWith("oa-runner-"));

      const jobId = "log-test-" + Date.now();
      await harness.seedJob({ id: jobId, name: "log-test" });
      await harness.runRunner(jobId);

      const finalDirs = fs.readdirSync(logsDir).filter((d) => d.startsWith("oa-runner-"));
      expect(finalDirs.length).toBeGreaterThan(initialDirs.length);
    }
  }, 60000);
});
