import Docker from "dockerode";
import path from "path";
import fs from "fs";
import { pollJobs, fetchRegistrationToken } from "./bridge.js";
import { config } from "./config.js";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });
const IMAGE = "ghcr.io/actions/actions-runner:latest";
const CONTAINER_PREFIX = "oa-runner-";
const MAX_RUNNERS = 10;
const LOGS_DIR = path.resolve(process.cwd(), "_", "logs");
const PENDING_LOGS_DIR = path.join(LOGS_DIR, "pending");

function getTimestamp(): string {
  const now = new Date();
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, "0");
  const DD = String(now.getDate()).padStart(2, "0");
  const HH = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${YYYY}${MM}${DD}-${HH}${mm}`;
}

interface RunnerState {
  id: string; // Container ID
  name: string;
  type: "warm" | "active";
  stream?: NodeJS.ReadableStream;
  logPath: string;
  logStream: fs.WriteStream;
  timestamp: string;
  commitSha?: string;
}

export class WarmPool {
  private runners: Map<string, RunnerState> = new Map();
  private isRunning: boolean = false;
  private reconcileInterval: NodeJS.Timeout | null = null;
  private nextRunnerId: number = 1;
  private processedJobs: Set<string> = new Set();

  constructor() {
    this.reconcile = this.reconcile.bind(this);
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("[WarmPool] Starting warm pool manager...");

    // Cleanup existing runners on start to ensure clean state
    await this.cleanupAll();

    // Initial reconcile
    await this.reconcile();

    // Start periodic reconcile loop (failsafe)
    this.reconcileInterval = setInterval(this.reconcile, 5000);
  }

  public async stop() {
    console.log("[WarmPool] Stopping warm pool manager...");
    this.isRunning = false;
    if (this.reconcileInterval) clearInterval(this.reconcileInterval);
    await this.cleanupAll();
  }

  private async reconcile() {
    if (!this.isRunning) return;

    // Filter out runners that might have died unexpectedly (if we missed the exit event)
    // For now, we rely on event listeners, but we could add a docker.listContainers check here for robustness.

    const warmCount = Array.from(this.runners.values()).filter((r) => r.type === "warm").length;
    const totalCount = this.runners.size;

    // n + 1 Rule: We want exactly 1 warm runner.
    if (warmCount < 1 && totalCount < MAX_RUNNERS) {
      // Spawn new warm runner
      console.log(`[WarmPool] Need warm runner (Warm: ${warmCount}, Total: ${totalCount}). Spawning...`);
      await this.spawnRunner();
    } else if (warmCount > 1) {
      // Too many warm runners? (Race condition maybe). We could kill one, or just let it be.
      // For now, we only spawn if < 1.
    }
    
    if (totalCount >= MAX_RUNNERS && warmCount === 0) {
      console.warn("[WarmPool] Max runners reached. Cannot spawn new warm runner.");
    }
    
    
    // Poll the bridge to announce presence and get jobs
    const jobs = await pollJobs();
    for (const job of jobs) {
        if (this.processedJobs.has(job.deliveryId)) continue;
        
        console.log(`[WarmPool] Received job: ${job.deliveryId} (LocalSync: ${job.localSync})`);
        this.processedJobs.add(job.deliveryId);

        if (job.localSync) {
            console.log(`[WarmPool] Spawning dedicated local runner for job ${job.deliveryId}`);
            await this.spawnRunner(job);
        }
    }
  }

  private async spawnRunner(job?: any) {
    const runId = this.nextRunnerId++;
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const containerName = `${CONTAINER_PREFIX}${runId}-${randomSuffix}`;

    const workDir = path.resolve(process.cwd(), "_/work", containerName); // Unique work dir per runner name

    // Ensure directories exist
    if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });

    try {
        // Ensure image exists before spawning
        await this.ensureImage();

        console.log(`[WarmPool] Fetching registration token for ${containerName}...`);
        const registrationToken = await fetchRegistrationToken();

        const dockerApiUrl = config.GITHUB_API_URL.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal");
        const repoUrl = `${dockerApiUrl}/${config.GITHUB_REPO}`;

        console.log(`[WarmPool] Creating container ${containerName}...`);
        const container = await docker.createContainer({
            Image: IMAGE,
            name: containerName,
            // Use config.sh for registration if needed, but the official image 
            // usually uses these env vars to auto-configure on startup.
            // Actually, the entrypoint /run.sh handles this if these are set.
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
                ...(job?.localSync ? [
                    `OA_LOCAL_SYNC=true`,
                    `PATH=/tmp/oa-shims:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
                    ...(job.headSha ? [`OA_HEAD_SHA=${job.headSha}`] : [])
                ] : []),
            ],
            // Run config.sh before run.sh to properly register the runner with the correct labels
            Cmd: ["bash", "-c", "echo \"DEBUG: GITHUB_SERVER_URL=$GITHUB_SERVER_URL\" && echo 'Testing connectivity...' && curl -v $GITHUB_API_URL || echo 'Curl failed' && GITHUB_SERVER_URL=$RUNNER_REPOSITORY_URL GITHUB_API_URL= ./config.sh --url $RUNNER_REPOSITORY_URL --token $RUNNER_TOKEN --name $RUNNER_NAME --unattended --ephemeral --labels opposite-actions || echo 'Config failed (ignoring)...' && ./run.sh --once"],
            HostConfig: {
            Binds: [
                `${workDir}:/home/runner/_work`,
                "/var/run/docker.sock:/var/run/docker.sock",
                ...(job?.localSync ? [
                    `${job.localPath}:/home/runner/_work/${job.githubRepo}/${job.githubRepo}`,
                    ...(await this.prepareShims(containerName))
                ] : [])
            ],
            AutoRemove: !job?.localSync, // Keep local sync containers for debugging
            },
            Tty: true,
        });

        const runnerId = container.id;
        const timestamp = getTimestamp();
        const logPath = path.join(PENDING_LOGS_DIR, `${timestamp}-${containerName}.log`);

        // Ensure pending logs dir exists
        if (!fs.existsSync(PENDING_LOGS_DIR)) fs.mkdirSync(PENDING_LOGS_DIR, { recursive: true });

        const logStream = fs.createWriteStream(logPath, { flags: 'a' });
        
        // Add to map IMMEDIATELY as warm
        this.runners.set(runnerId, {
            id: runnerId,
            name: containerName,
            type: "warm",
            logPath,
            logStream,
            timestamp,
            commitSha: job?.headSha
        });

        console.log(`[WarmPool] Starting container ${containerName} (${runnerId.substring(0, 12)})...`);
        await container.start();
        console.log(`[WarmPool] container.start() resolved for ${containerName}`);

        if (job) {
            await this.seedDTU(job);
        }


        // Attach listeners
        this.attachToRunner(container, runnerId);

    } catch (error: any) {
        console.error(`[WarmPool] Failed to spawn runner ${containerName}:`, error.message);
        // Clean up map if needed (though we added it, it failed start, so maybe not there effectively?)
    }
  }

  private async attachToRunner(container: Docker.Container, runnerId: string) {
    // 1. Monitor Logs for "Job received"
    try {
        const stream = await container.logs({
            stdout: true,
            stderr: true,
            follow: true,
            tail: 100
        }) as NodeJS.ReadableStream;

        const runnerState = this.runners.get(runnerId);
        if (runnerState) {
            runnerState.stream = stream;
        }

        stream.on('data', (chunk: Buffer) => {
            const logLine = chunk.toString();
            // console.log(`[Runner ${runnerId.substring(0,6)}] ${logLine.trim()}`); // Verbose

            const runnerState = this.runners.get(runnerId);
            if (runnerState) {
                runnerState.logStream.write(chunk);
            }

            // Detection logic for job assignment
            if (logLine.includes("Job") && logLine.includes("message received")) {
                this.markAsActive(runnerId);
            }

            // Detection logic for critical errors (only if EXIT_ON_ERROR is enabled)
            if (config.EXIT_ON_ERROR) {
                // Ignore "Cannot find GitHub repository..." as it is a benign SystemD error in this context
                if (logLine.includes("Cannot find GitHub repository/organization name from server url")) {
                     console.warn(`[WarmPool] Ignoring known benign error: ${logLine.trim()}`);
                }

                
                // Detect general GitHub Actions runner errors
                if (logLine.includes("[RUNNER") && logLine.includes("ERR")) {
                    // Extract the error message for logging
                    const errorMatch = logLine.match(/\[RUNNER.*ERR.*\]\s*(.*)/);
                    if (errorMatch && errorMatch[1]) {
                        const errorMsg = errorMatch[1].trim();
                        // Only exit on critical errors, not all errors
                        if (errorMsg.includes("System.InvalidOperationException") && !errorMsg.includes("Cannot find GitHub repository/organization name")) {
                            this.handleCriticalError(errorMsg);
                        }
                    }
                }
            }
        });

        // 2. Monitor Exit
        container.wait().then((result) => {
             console.log(`[WarmPool] Runner ${runnerId.substring(0, 12)} exited with code ${result.StatusCode}`);
             this.handleRunnerExit(runnerId, result.StatusCode);
        }).catch(err => {
            console.error(`[WarmPool] Error waiting for runner ${runnerId}:`, err);
             this.handleRunnerExit(runnerId, 1);
        });

    } catch (error) {
        console.error(`[WarmPool] Failed to attach to runner ${runnerId}:`, error);
        // If we can't attach, we should probably kill it to be safe, or just let it die.
        this.handleRunnerExit(runnerId, 1);
    }
  }

  private markAsActive(runnerId: string) {
    const runner = this.runners.get(runnerId);
    if (runner && runner.type === "warm") {
      console.log(`[WarmPool] Runner ${runner.name} picked up a job! Marking as ACTIVE.`);
      runner.type = "active";

      // Move log file if commitSha is known or becomes known
      if (runner.commitSha) {
          const commitDir = path.join(LOGS_DIR, runner.commitSha);
          if (!fs.existsSync(commitDir)) fs.mkdirSync(commitDir, { recursive: true });
          
          const newLogPath = path.join(commitDir, `${runner.timestamp}-${runner.name}.log`);
          
          // Re-pipe strategy: close current stream, move file, reopen stream
          runner.logStream.end(() => {
              try {
                  fs.renameSync(runner.logPath, newLogPath);
                  runner.logPath = newLogPath;
                  runner.logStream = fs.createWriteStream(newLogPath, { flags: 'a' });
              } catch (err) {
                  console.error(`[WarmPool] Failed to move log file:`, err);
                  // Keep writing to old path if move fails? 
                  // For now, we'll just try to reopen at the old path to avoid losing logs
                  runner.logStream = fs.createWriteStream(runner.logPath, { flags: 'a' });
              }
          });
      }

      // Trigger reconcile to spawn a new warm runner
      this.reconcile();
    }
  }

  private handleRunnerExit(runnerId: string, exitCode: number = 0) {
    const runner = this.runners.get(runnerId);
    if (runner) {
        console.log(`[WarmPool] Removed runner ${runnerId.substring(0, 12)} from pool.`);
        
        // Finalize log file
        runner.logStream.end(() => {
            const finalPath = runner.logPath.replace(/\.log$/, `.${exitCode}.log`);
            try {
                fs.renameSync(runner.logPath, finalPath);
                console.log(`[WarmPool] Log finalized: ${finalPath}`);
            } catch (err) {
                console.error(`[WarmPool] Failed to finalize log file:`, err);
            }
        });

        this.runners.delete(runnerId);
        // Trigger reconcile to replace it if it was the warm one
        this.reconcile();
    }
  }

  private async handleCriticalError(errorMessage: string) {
    console.error(`[WarmPool] CRITICAL ERROR DETECTED: ${errorMessage}`);
    console.error(`[WarmPool] Shutting down due to critical error...`);
    await this.stop();
    process.exit(1);
  }

  private async cleanupAll() {
    console.log("[WarmPool] Cleaning up all managed runners...");
    // 1. List all containers matching our prefix
    const containers = await docker.listContainers({
        all: true,
        filters: { name: [CONTAINER_PREFIX] }
    });

    for (const c of containers) {
        console.log(`[WarmPool] Killing/Removing ${c.Names[0]}...`);
        try {
            const container = docker.getContainer(c.Id);
            // If running, kill
            if (c.State === 'running') {
                 await container.kill().catch(() => {});
            }
            // Remove
            await container.remove({ force: true }).catch(() => {});
        } catch (e) {
            console.error(`[WarmPool] Failed to cleanup ${c.Id}:`, e);
        }
    }
    this.runners.clear();
  }

  private async ensureImage(): Promise<void> {
    const images = await docker.listImages({
      filters: { reference: [IMAGE] },
    });
  
    if (images.length === 0) {
      console.log(`[WarmPool] Pulling image ${IMAGE}...`);
      await new Promise<void>((resolve, reject) => {
        docker.pull(IMAGE, (err: any, stream: any) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream, (err: any) => {
            if (err) reject(err);
            else resolve();
          },
          () => {});
        });
      });
      console.log(`[WarmPool] Pull complete.`);
    }
  }

  private async seedDTU(job: any) {
    console.log(`[WarmPool] seedDTU called for job ${job.deliveryId}`);
    try {
        const dtuUrl = config.GITHUB_API_URL;
        console.log(`[WarmPool] Sending POST to ${dtuUrl}/_dtu/seed...`);
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
            console.error(`[WarmPool] Failed to seed DTU: ${response.status}`);
        } else {
            console.log(`[WarmPool] DTU seeded successfully.`);
        }
    } catch (e: any) {
        console.error(`[WarmPool] Error seeding DTU: ${e.message}`);
    }
  }

  private async prepareShims(containerName: string): Promise<string[]> {
    const shimsDir = path.resolve(process.cwd(), "_/shims", containerName);
    if (!fs.existsSync(shimsDir)) fs.mkdirSync(shimsDir, { recursive: true });

    const gitShimPath = path.join(shimsDir, "git");
    const gitShimContent = `#!/bin/bash
case "$1" in
  checkout|fetch|reset|init)
    echo "[OA Shim] Intercepted '$1' to protect local files."
    exit 0
    ;;
  *)
    /usr/bin/git "$@"
    ;;
esac
`;
    fs.writeFileSync(gitShimPath, gitShimContent, { mode: 0o755 });
    
    return [`${shimsDir}:/tmp/oa-shims`];
  }
}

// Export singleton instance or function wrappers for compatibility
export const warmPool = new WarmPool();

export async function startWarmPool() {
    await warmPool.start();
}

export async function stopWarmPool() {
    await warmPool.stop();
}
