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
    expect(result.stdout).toContain("Runner exited with code 0");

    // Check DTU for the captured logs
    const dump = await (await fetch(`http://localhost:8990/_dtu/dump`)).json();
    const allLogs = Object.values(dump.logs).flat().join("\n");
    expect(allLogs).toContain("Hello from E2E");
  }, 60000);

  it("should place logs in a flat file structure", async () => {
    // We now use the unified logger which places in-progress logs in _/logs/in-progress
    // and finalized logs in _/logs/completed
    const logsDir = path.resolve(process.cwd(), "_", "logs", "completed");

    const countLogFiles = (dir: string) => {
      if (!fs.existsSync(dir)) {
        return 0;
      }
      // Recursively find all files ending in .log
      const scanDir = (d: string): string[] => {
        const entries = fs.readdirSync(d, { withFileTypes: true });
        const files = entries
          .filter((e) => e.isFile() && e.name.endsWith(".log"))
          .map((e) => path.join(d, e.name));
        const subdirs = entries.filter((e) => e.isDirectory());
        for (const sd of subdirs) {
          files.push(...scanDir(path.join(d, sd.name)));
        }
        return files;
      };

      return scanDir(dir).filter((f) => path.basename(f).startsWith("oa-runner-")).length;
    };

    const initialCount = countLogFiles(logsDir);

    const jobId = "log-test-" + Date.now();
    await harness.seedJob({ id: jobId, name: "log-test" });
    await harness.runRunner(jobId);

    const finalCount = countLogFiles(logsDir);
    expect(finalCount).toBeGreaterThan(initialCount);
  }, 60000);
});
