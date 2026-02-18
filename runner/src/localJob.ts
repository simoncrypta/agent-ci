import Docker from "dockerode";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { config } from "./config";
import { Job } from "./types";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });
const IMAGE = "ghcr.io/actions/actions-runner:latest";
const LOGS_DIR = path.resolve(process.cwd(), "_", "logs");

function getTimestamp(): string {
  const now = new Date();
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const DD = String(now.getDate()).padStart(2, "0");
  const HH = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${YYYY}${MM}${DD}-${HH}${mm}`;
}

export async function executeLocalJob(job: Job): Promise<void> {
  console.log(`[LocalJob] Starting local execution for job: ${job.deliveryId}`);

  // 1. Seed the job to Local DTU
  // This allows the runner to fetch the job details when it connects.
  try {
    const dtuUrl = config.GITHUB_API_URL;
    console.log(`[LocalJob] Seeding job to DTU at ${dtuUrl}...`);
    const response = await fetch(`${dtuUrl}/_dtu/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            id: job.githubJobId || "1",
            name: "local-job",
            status: "queued",
            ...job
        }),
    });
    if (!response.ok) {
        throw new Error(`Failed to seed DTU: ${response.status} ${response.statusText}`);
    }
    console.log(`[LocalJob] DTU seeded successfully.`);
  } catch (e: any) {
    console.error(`[LocalJob] Error seeding DTU: ${e.message}`);
    throw e;
  }

  // 2. Registration Token
  // Since we are running completely locally against the DTU, we don't need to 
  // fetch a real registration token from the Bridge/GitHub. The DTU mock 
  // server accepts any token for registration.
  const registrationToken = "mock_local_token"; 
  console.log(`[LocalJob] Using mock registration token for local execution.`);

  // 3. Prepare Runner Container
  const containerName = `oa-local-runner-${Date.now()}`;
  const workDir = path.resolve(process.cwd(), "_/work", containerName);
  const shimsDir = path.resolve(process.cwd(), "_/shims", containerName);

  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
  if (!fs.existsSync(shimsDir)) fs.mkdirSync(shimsDir, { recursive: true });

  // Create git shim to protect local files
  const gitShimPath = path.join(shimsDir, "git");
  fs.writeFileSync(gitShimPath, `#!/bin/bash
case "$1" in
  checkout|fetch|reset|init)
    echo "[OA Shim] Intercepted '$1' to protect local files."
    exit 0
    ;;
  *)
    /usr/bin/git "$@"
    ;;
esac
`, { mode: 0o755 });

  // 4. Start Container
  console.log(`[LocalJob] Ensuring image ${IMAGE} exists...`);
  // (Assuming image exists or pulled elsewhere, but we should ensure it)
  // For brevity, skipping explicit pull check if we assume dev environment has it. 
  // But let's add a quick check if simple. 
  // Actually, let's trust Docker to pull if missing or fail. Code becomes cleaner.

  const dockerApiUrl = config.GITHUB_API_URL.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal");
  const repoUrl = `${dockerApiUrl}/${config.GITHUB_REPO}`;

  // 4. Prepare Clean Workspace (Checkout Emulation)
  const workspaceId = Date.now();
  const workspaceDir = path.resolve(process.cwd(), "_/work", `workspace-${workspaceId}`);
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });

  console.log(`[LocalJob] Preparing clean workspace in ${workspaceDir}...`);
  try {
    if (job.headSha && job.headSha !== "HEAD") {
      console.log(`[LocalJob] Exporting SHA ${job.headSha}...`);
      execSync(`git archive ${job.headSha} | tar -x -C ${workspaceDir}`, { stdio: "inherit" });
    } else {
      console.log(`[LocalJob] Exporting tracked files from working directory...`);
      // Note: checkout-index needs the trailing slash in --prefix
      execSync(`git checkout-index -a -f --prefix=${workspaceDir}/`, { stdio: "inherit" });
    }
  } catch (e: any) {
    console.error(`[LocalJob] Failed to prepare workspace: ${e.message}`);
    // Cleanup and abort
    if (fs.existsSync(workspaceDir)) fs.rmSync(workspaceDir, { recursive: true, force: true });
    throw e;
  }

  console.log(`[LocalJob] Spawning container ${containerName}...`);
  const container = await docker.createContainer({
    Image: IMAGE,
    name: containerName,
    Env: [
        `RUNNER_NAME=${containerName}`,
        `RUNNER_TOKEN=${registrationToken}`,
        `RUNNER_REPOSITORY_URL=${repoUrl}`,
        `GITHUB_API_URL=${dockerApiUrl}`,
        `GITHUB_SERVER_URL=${repoUrl}`,
        `GITHUB_REPOSITORY=${config.GITHUB_REPO}`,
        `http_proxy=${dockerApiUrl}`,
        `https_proxy=${dockerApiUrl}`,
        `no_proxy=`,
        `OA_LOCAL_SYNC=true`,
        `OA_HEAD_SHA=${job.headSha || "HEAD"}`,
        `PATH=/tmp/oa-shims:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    ],
    Cmd: ["bash", "-c", "echo \"DEBUG: GITHUB_SERVER_URL=$GITHUB_SERVER_URL\" && echo 'Testing connectivity...' && curl -v $GITHUB_API_URL || echo 'Curl failed' && GITHUB_SERVER_URL=$RUNNER_REPOSITORY_URL GITHUB_API_URL= ./config.sh --url $RUNNER_REPOSITORY_URL --token $RUNNER_TOKEN --name $RUNNER_NAME --unattended --ephemeral --work _work --labels opposite-actions || echo 'Config failed (ignoring)...' && ./run.sh --once"],
    HostConfig: {
        Binds: [
            `${workDir}:/home/runner/_work`,
            "/var/run/docker.sock:/var/run/docker.sock",
            `${shimsDir}:/tmp/oa-shims`,
            // Mount the clean workspace as the repository root
            `${workspaceDir}:/home/runner/_work/${config.GITHUB_REPO}`
        ],
        AutoRemove: true // Clean up after ourselves for this one-off
    },
    Tty: true
  });

  await container.start();
  console.log(`[LocalJob] Container started. Streaming logs...`);

  // 5. Stream Logs
  const timestamp = getTimestamp();
  const logPath = path.join(LOGS_DIR, `${timestamp}-${containerName}.log`);
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  const logStream = fs.createWriteStream(logPath);

  const stream = await container.logs({
    stdout: true,
    stderr: true,
    follow: true
  }) as NodeJS.ReadableStream;

  stream.pipe(process.stdout);
  stream.pipe(logStream);

  // 6. Wait for Exit
  const waitResult = await container.wait();
  console.log(`[LocalJob] Runner exited with code ${waitResult.StatusCode}`);

  // 7. Cleanup
  console.log(`[LocalJob] Cleaning up temporary workspace...`);
  if (fs.existsSync(workspaceDir)) fs.rmSync(workspaceDir, { recursive: true, force: true });
  if (fs.existsSync(shimsDir)) fs.rmSync(shimsDir, { recursive: true, force: true });
  // We keep workDir (the runner settings/home) for now, or could clean it too.
}
