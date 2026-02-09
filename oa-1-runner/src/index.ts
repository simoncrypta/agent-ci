import { config } from "./config";
import { pollJobs } from "./bridge";
import { executeJob, ensureImageExists } from "./executor";

async function main() {
  console.log(`[Runner] Starting runner for user: ${config.GITHUB_USERNAME}`);
  console.log(`[Runner] Bridge URL: ${config.BRIDGE_URL}`);

  // 1. Pre-warm Docker environment
  await ensureImageExists();
  console.log("[Runner] Docker environment ready.");

  // 2. Initial poll to announce availability
  console.log("[Runner] Announcing availability to bridge...");
  const initialJobs = await pollJobs();
  if (initialJobs.length > 0) {
    for (const job of initialJobs) {
      await executeJob(job);
    }
  }

  // 3. Regular Polling loop
  setInterval(async () => {
    console.log("[Runner] Polling for jobs...");
    const jobs = await pollJobs();

    if (jobs.length > 0) {
      console.log(`[Runner] Found ${jobs.length} jobs.`);
      for (const job of jobs) {
        await executeJob(job);
      }
    }
  }, 10_000);
}

main().catch((err) => {
  console.error("[Runner] Fatal error:", err);
  process.exit(1);
});
