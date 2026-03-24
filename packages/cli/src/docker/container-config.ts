import fs from "fs";
import path from "path";
import { execSync } from "child_process";

export interface ContainerEnvOpts {
  containerName: string;
  registrationToken: string;
  repoUrl: string;
  dockerApiUrl: string;
  githubRepo: string;
  headSha?: string;
  dtuHost: string;
  useDirectContainer: boolean;
  repoRoot?: string;
  maxConcurrency?: number;
}

export interface ContainerBindsOpts {
  hostWorkDir: string;
  shimsDir: string;
  signalsDir?: string;
  diagDir: string;
  toolCacheDir: string;
  pnpmStoreDir: string;
  npmCacheDir: string;
  bunCacheDir: string;
  playwrightCacheDir: string;
  warmModulesDir: string;
  hostRunnerDir: string;
  useDirectContainer: boolean;
}

export interface ContainerCmdOpts {
  svcPortForwardSnippet: string;
  dtuPort: string;
  dtuHost: string;
  useDirectContainer: boolean;
  containerName: string;
}

// ─── Yarn Berry detection ─────────────────────────────────────────────────────

/**
 * Detects if the repository uses Yarn Berry.
 *
 * Yarn Berry (yarn 2+) uses .yarnrc.yml. With nmMode:classic or when packages
 * are hoisted to the root of node_modules, Node's module resolution can't find
 * packages because it expects them in a node_modules subdirectory. When agent-ci
 * bind-mounts warm-modules to /tmp/warm-modules and symlinks workspace/node_modules
 * -> /tmp/warm-modules, Node can't resolve packages without NODE_PATH being set.
 *
 * We set NODE_PATH for all Yarn Berry repos to be safe - it doesn't hurt other
 * configurations but fixes the classic/hoisted case.
 */
function shouldSetNodePathForYarnBerry(repoRoot: string | undefined): boolean {
  if (!repoRoot) {
    return false;
  }

  // Check for .yarnrc.yml which indicates Yarn Berry (yarn 2+)
  const yarnrcPath = path.join(repoRoot, ".yarnrc.yml");
  if (fs.existsSync(yarnrcPath)) {
    return true;
  }

  // Also check for .yarn directory which is present in Yarn Berry repos
  const yarnDir = path.join(repoRoot, ".yarn");
  if (fs.existsSync(yarnDir)) {
    return true;
  }

  return false;
}

// ─── Environment variables ────────────────────────────────────────────────────

/**
 * Build the Env array for `docker.createContainer()`.
 */
export function buildContainerEnv(opts: ContainerEnvOpts): string[] {
  const {
    containerName,
    registrationToken,
    repoUrl,
    dockerApiUrl,
    githubRepo,
    headSha,
    dtuHost,
    useDirectContainer,
    repoRoot,
    maxConcurrency,
  } = opts;

  return [
    `RUNNER_NAME=${containerName}`,
    `RUNNER_TOKEN=${registrationToken}`,
    `RUNNER_REPOSITORY_URL=${repoUrl}`,
    `GITHUB_API_URL=${dockerApiUrl}`,
    `GITHUB_SERVER_URL=${repoUrl}`,
    `GITHUB_REPOSITORY=${githubRepo}`,
    `AGENT_CI_LOCAL_SYNC=true`,
    `AGENT_CI_HEAD_SHA=${headSha || "HEAD"}`,
    `AGENT_CI_DTU_HOST=${dtuHost}`,
    `ACTIONS_CACHE_URL=${dockerApiUrl}/`,
    `ACTIONS_RESULTS_URL=${dockerApiUrl}/`,
    `ACTIONS_RUNTIME_TOKEN=mock_cache_token_123`,
    `RUNNER_TOOL_CACHE=/opt/hostedtoolcache`,
    `PATH=/tmp/warm-modules/node_modules/.bin:/home/runner/externals/node24/bin:/home/runner/externals/node20/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    // Force colour output in all child processes (pnpm, Node, etc.)
    `FORCE_COLOR=1`,
    // Custom containers may run as root and lack libicu — configure accordingly
    ...(useDirectContainer
      ? [`RUNNER_ALLOW_RUNASROOT=1`, `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`]
      : []),
    // Yarn Berry with nmMode:classic needs NODE_PATH for module resolution
    // because packages are hoisted to the root of node_modules but Node expects
    // them in a node_modules subdirectory. The warm-modules directory is bind-mounted
    // to /tmp/warm-modules and symlinked as workspace/node_modules.
    ...(shouldSetNodePathForYarnBerry(repoRoot)
      ? [`NODE_PATH=/tmp/warm-modules/node_modules`]
      : []),
    // Resource-aware concurrency caps based on memory budget
    ...(maxConcurrency
      ? [
          `AGENT_CI_MAX_CONCURRENCY=${maxConcurrency}`,
          `NX_PARALLEL=${maxConcurrency}`,
          `JEST_WORKERS=${maxConcurrency}`,
          `OXCORE_NUM_CPUS=${maxConcurrency}`,
        ]
      : []),
  ];
}

// ─── Bind mounts ──────────────────────────────────────────────────────────────

/**
 * Build the Binds array for `docker.createContainer()`.
 */
export function buildContainerBinds(opts: ContainerBindsOpts): string[] {
  const {
    hostWorkDir,
    shimsDir,
    signalsDir,
    diagDir,
    toolCacheDir,
    pnpmStoreDir,
    npmCacheDir,
    bunCacheDir,
    playwrightCacheDir,
    warmModulesDir,
    hostRunnerDir,
    useDirectContainer,
  } = opts;

  const h = toHostPath;
  return [
    // When using a custom container, bind-mount the extracted runner
    ...(useDirectContainer ? [`${h(hostRunnerDir)}:/home/runner`] : []),
    `${h(hostWorkDir)}:/home/runner/_work`,
    "/var/run/docker.sock:/var/run/docker.sock",
    `${h(shimsDir)}:/tmp/agent-ci-shims`,
    // Pause-on-failure IPC: signal files (paused, retry, abort)
    ...(signalsDir ? [`${h(signalsDir)}:/tmp/agent-ci-signals`] : []),
    `${h(diagDir)}:/home/runner/_diag`,
    `${h(toolCacheDir)}:/opt/hostedtoolcache`,
    // Package manager caches (persist across runs)
    `${h(pnpmStoreDir)}:/home/runner/_work/.pnpm-store`,
    `${h(npmCacheDir)}:/home/runner/.npm`,
    `${h(bunCacheDir)}:/home/runner/.bun/install/cache`,
    `${h(playwrightCacheDir)}:/home/runner/.cache/ms-playwright`,
    // Warm node_modules: mounted outside the workspace so actions/checkout can
    // delete the symlink without EBUSY. A symlink in the entrypoint points
    // workspace/node_modules → /tmp/warm-modules/node_modules.
    `${h(warmModulesDir)}:/tmp/warm-modules/node_modules`,
  ];
}

// ─── Container command ────────────────────────────────────────────────────────

/**
 * Build the long entrypoint command string for the container.
 */
export function buildContainerCmd(opts: ContainerCmdOpts): string[] {
  const { svcPortForwardSnippet, dtuPort, dtuHost, useDirectContainer, containerName } = opts;

  // The runner connects directly to the DTU host (no in-container proxy needed).
  // The DTU listens on 0.0.0.0 so it's reachable from the container network.
  const dtuBaseUrl = `http://${dtuHost}:${dtuPort}`;

  // For direct containers, credentials are pre-baked on the host and bind-mounted
  // into /home/runner. For the default image, we write them inline in the
  // entrypoint since /home/runner is baked into the image.
  const credentialSnippet = useDirectContainer
    ? ""
    : `echo '{"agentId":1,"agentName":"${containerName}","poolId":1,"poolName":"Default","serverUrl":"${dtuBaseUrl}","gitHubUrl":"${dtuBaseUrl}/'$GITHUB_REPOSITORY'","workFolder":"_work","ephemeral":true}' > /home/runner/.runner && echo '{"scheme":"OAuth","data":{"clientId":"00000000-0000-0000-0000-000000000000","authorizationUrl":"${dtuBaseUrl}/_apis/oauth2/token","oAuthEndpointUrl":"${dtuBaseUrl}/_apis/oauth2/token","requireFipsCryptography":"False"}}' > /home/runner/.credentials && echo '{"d":"CQpCI+sO2GD1N/JsHHI9zEhMlu5Fcc8mU4O2bO6iscOsagFjvEnTesJgydC/Go1HuOBlx+GT9EG2h7+juS0z2o5n8Mvt5BBxlK+tqoDOs8VfQ9CSUl3hqYRPeNdBfnA1w8ovLW0wqfPO08FWTLI0urYsnwjZ5BQrBM+D7zYeA0aCsKdo75bKmaEKnmqrtIEhb7hE45XQa32Yt0RPCPi8QcQAY2HLHbdWdZYDj6k/UuDvz9H/xlDzwYq6Yikk2RSMArFzaufxCGS9tBZNEACDPYgnZnEMXRcvsnZ9FYbq81KOSifCmq7Yocq+j3rY5zJCD+PIDY9QJwPxB4PGasRKAQ==","dp":"A0sY1oOz1+3uUMiy+I5xGuHGHOrEQPYspd1xGClBYYsa/Za0UDWS7V0Tn1cbRWfWtNe5vTpxcvwQd6UZBwrtHF6R2zyXFhE++PLPhCe0tH4C5FY9i9jUw9Vo8t44i/s5JUHU2B1mEptXFUA0GcVrLKS8toZSgqELSS2Q/YLRxoE=","dq":"GrLC9dPJ5n3VYw51ghCH7tybUN9/Oe4T8d9v4dLQ34RQEWHwRd4g3U3zkvuhpXFPloUTMmkxS7MF5pS1evrtzkay4QUTDv+28s0xRuAsw5qNTzuFygg8t93MvpvTVZ2TNApW6C7NFvkL9NbxAnU8+I61/3ow7i6a7oYJJ0hWAxE=","exponent":"AQAB","inverseQ":"8DVz9FSvEdt5W4B9OjgakZHwGfnhn2VLDUxrsR5ilC5tPC/IgA8C2xEfKQM1t+K/N3pAYHBYQ6EPgtW4kquBS/Sy102xbRI7GSCnUbRtTpWYPOaCn6EaxBNzwWzbp5vCbCGvFqlSu4+OBYRVe+iCj+gAnkmT/TKPhHHbTjJHvw==","modulus":"x0eoW2DD7xsW5YiorMN8pNHVvZk4ED1SHlA/bmVnRz5FjEDnQloMn0nBgIUHxoNArksknrp/FOVJv5sJHJTiRZkOp+ZmH7d3W3gmw63IxK2C5pV+6xfav9jR2+Wt/6FMYMgG2utBdF95oif1f2XREFovHoXkWms2l0CPLLHVPO44Hh9EEmBmjOeMJEZkulHJ44z9y8e+GZ2nYqO0ZiRWQcRObZ0vlRaGg6PPOl4ltay0BfNksMB3NDtlhkdVkAEFQxEaZZDK9NtkvNljXCioP3TyTAbqNUGsYCA5D+IHGZT9An99J9vUqTFP6TKjqUvy9WNiIzaUksCySA0a4SVBkQ==","p":"8fgAdmWy+sTzAN19fYkWMQqeC7t1BCQMo5z5knfVLg8TtwP9ZGqDtoe+r0bGv3UgVsvvDdP/QwRvRVP+5G9l999Y6b4VbSdUbrfPfOgjpPDmRTQzHDve5jh5xBENQoRXYm7PMgHGmjwuFsE/tKtSGTrvt2Z3qcYAo0IOqLLhYmE=","q":"0tXx4+P7gUWePf92UJLkzhNBClvdnmDbIt52Lui7YCARczbN/asCDJxcMy6Bh3qmIx/bNuOUrfzHkYZHfnRw8AGEK80qmiLLPI6jrUBOGRajmzemGQx0W8FWalEQfGdNIv9R2nsegDRoMq255Zo/qX60xQ6abpp0c6UNhVYSjTE="}' > /home/runner/.credentials_rsaparams && `;

  // Timing helper: date +%s%3N gives epoch milliseconds
  const T = (label: string) =>
    `T1=$(date +%s%3N); echo "[agent-ci:boot] ${label}: $((T1-T0))ms"; T0=$T1`;

  const cmdScript = [
    `MAYBE_SUDO() { if command -v sudo >/dev/null 2>&1; then sudo -n "$@"; else "$@"; fi; }`,
    `detect_resources() { CPUS=$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 1); MEM_KB=$(awk '/MemAvailable/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); if [ "$MEM_KB" -gt 0 ]; then HEAP_MB=$((MEM_KB / 1024 - 512)); else HEAP_MB=2048; fi; if [ "$HEAP_MB" -lt 1024 ]; then HEAP_MB=1024; fi; export AGENT_CI_MAX_CPUS="$CPUS"; [ -z "$NX_PARALLEL" ] && export NX_PARALLEL="$CPUS"; [ -z "$JEST_WORKERS" ] && export JEST_WORKERS="$CPUS"; [ -z "$OXCORE_NUM_CPUS" ] && export OXCORE_NUM_CPUS="$CPUS"; DYNAMIC_NODE_OPTIONS="--max-old-space-size=$HEAP_MB --no-network-family-autoselection --experimental-vm-modules"; if [ -n "$NODE_OPTIONS" ]; then export NODE_OPTIONS="$NODE_OPTIONS $DYNAMIC_NODE_OPTIONS"; else export NODE_OPTIONS="$DYNAMIC_NODE_OPTIONS"; fi; echo "[agent-ci:boot] resources: cpus=$CPUS heap_mb=$HEAP_MB"; }`,
    `init_warm_modules() { mkdir -p /tmp/warm-modules /tmp/warm-modules/node_modules; chmod 1777 /tmp 2>/dev/null || true; chmod 777 /tmp/warm-modules /tmp/warm-modules/node_modules 2>/dev/null || true; }`,
    `BOOT_T0=$(date +%s%3N); T0=$BOOT_T0`,
    // chmod is done host-side in workspacePrepPromise — skip it here
    `if [ -f /usr/bin/git ]; then MAYBE_SUDO mv /usr/bin/git /usr/bin/git.real 2>/dev/null; MAYBE_SUDO cp -p /tmp/agent-ci-shims/git /usr/bin/git 2>/dev/null; MAYBE_SUDO chmod +x /usr/bin/git 2>/dev/null; fi`,
    T("git-shim"),
    `${svcPortForwardSnippet}chmod 666 /var/run/docker.sock 2>/dev/null || true`,
    T("docker-sock"),
    `cd /home/runner`,
    `${credentialSnippet}true`,
    T("credentials"),
    `REPO_NAME=$(basename $GITHUB_REPOSITORY)`,
    `WORKSPACE_PATH=/home/runner/_work/$REPO_NAME/$REPO_NAME`,
    `mkdir -p $WORKSPACE_PATH`,
    `detect_resources`,
    `init_warm_modules`,
    `ln -sfn /tmp/warm-modules/node_modules $WORKSPACE_PATH/node_modules 2>/dev/null || true`,
    `if [ -d $WORKSPACE_PATH/node_modules/@leftlane ]; then rm -f $WORKSPACE_PATH/node_modules/@leftlane/utils 2>/dev/null; ln -sfn $WORKSPACE_PATH/utils $WORKSPACE_PATH/node_modules/@leftlane/utils 2>/dev/null || true; rm -f $WORKSPACE_PATH/node_modules/@leftlane/gql-mocks 2>/dev/null; ln -sfn $WORKSPACE_PATH/gql-mocks $WORKSPACE_PATH/node_modules/@leftlane/gql-mocks 2>/dev/null || true; rm -f $WORKSPACE_PATH/node_modules/@leftlane/contract 2>/dev/null; ln -sfn $WORKSPACE_PATH/customer-app-contract $WORKSPACE_PATH/node_modules/@leftlane/contract 2>/dev/null || true; fi`,
    T("workspace-setup"),
    `echo "[agent-ci:boot] total: $(($(date +%s%3N)-BOOT_T0))ms"`,
    `echo "[agent-ci:boot] starting run.sh --once"`,
    `RUNNER_PID=""; ./run.sh --once & RUNNER_PID=$!; if [ -z "$RUNNER_PID" ]; then echo "[agent-ci:boot] failed to start runner"; exit 1; fi`,
    `touch /tmp/agent-ci-runner-heartbeat`,
    `echo "$RUNNER_PID" >/tmp/agent-ci-runner.pid`,
    `MONITOR_PID=""; ( while [ -f /tmp/agent-ci-runner.pid ]; do RUN_PID=$(cat /tmp/agent-ci-runner.pid 2>/dev/null || true); if [ -z "$RUN_PID" ] || ! kill -0 "$RUN_PID" 2>/dev/null; then break; fi; MEM_KB=$(awk '/MemAvailable/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); LOAD=$(awk '{print $1}' /proc/loadavg 2>/dev/null || echo 0); touch /tmp/agent-ci-runner-heartbeat 2>/dev/null || true; if [ "$MEM_KB" -gt 0 ] && [ "$MEM_KB" -lt 131072 ]; then echo "[agent-ci:guard] low-memory mem_kb=$MEM_KB load=$LOAD"; kill -STOP "$RUN_PID" 2>/dev/null || true; sleep 2; kill -CONT "$RUN_PID" 2>/dev/null || true; fi; sleep 5; done ) & MONITOR_PID=$!`,
    `wait "$RUNNER_PID"; RUNNER_EXIT=$?; rm -f /tmp/agent-ci-runner.pid; if [ -n "$MONITOR_PID" ]; then kill "$MONITOR_PID" 2>/dev/null || true; wait "$MONITOR_PID" 2>/dev/null || true; fi; exit "$RUNNER_EXIT"`,
  ].join(" && ");

  return [...(useDirectContainer ? ["-c"] : ["bash", "-c"]), cmdScript];
}

// ─── DTU host resolution ──────────────────────────────────────────────────────

/**
 * Resolve the DTU host address that nested Docker containers can reach.
 * Inside Docker: use the container's own bridge IP.
 * On host: use `host.docker.internal`.
 */
export function resolveDtuHost(): string {
  const isInsideDocker = fs.existsSync("/.dockerenv");
  if (!isInsideDocker) {
    return "host.docker.internal";
  }
  try {
    const ip = execSync("hostname -I 2>/dev/null | awk '{print $1}'", {
      encoding: "utf8",
    }).trim();
    if (ip) {
      return ip;
    }
  } catch {}
  return "172.17.0.1"; // fallback to bridge gateway
}

/**
 * Rewrite a DTU URL to be reachable from inside Docker containers.
 */
export function resolveDockerApiUrl(dtuUrl: string, dtuHost: string): string {
  return dtuUrl.replace("localhost", dtuHost).replace("127.0.0.1", dtuHost);
}

// ─── Docker-outside-of-Docker path translation ──────────────────────────────

interface MountMapping {
  containerPath: string;
  hostPath: string;
}

let _mountMappings: MountMapping[] | null = null;

/**
 * When running inside a container with Docker-outside-of-Docker (shared socket),
 * bind mount paths must use HOST paths, not container paths. This function
 * inspects our own container's mounts to build a translation table.
 *
 * Returns [] when running on bare metal (no translation needed).
 */
function getMountMappings(): MountMapping[] {
  if (_mountMappings !== null) {
    return _mountMappings;
  }

  if (!fs.existsSync("/.dockerenv")) {
    _mountMappings = [];
    return _mountMappings;
  }

  try {
    const containerId = fs.readFileSync("/etc/hostname", "utf8").trim();
    const json = execSync(`docker inspect ${containerId}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const data = JSON.parse(json);
    const mounts = data[0]?.Mounts || [];
    _mountMappings = mounts
      .filter((m: { Type: string }) => m.Type === "bind")
      .map((m: { Source: string; Destination: string }) => ({
        hostPath: m.Source,
        containerPath: m.Destination,
      }))
      // Sort longest containerPath first for greedy matching
      .sort((a: MountMapping, b: MountMapping) => b.containerPath.length - a.containerPath.length);
  } catch {
    _mountMappings = [];
  }
  return _mountMappings!;
}

/**
 * Translate a local filesystem path to the corresponding Docker host path.
 * Only applies when running inside a container (Docker-outside-of-Docker).
 * Returns the path unchanged when running on bare metal.
 */
export function toHostPath(localPath: string): string {
  const mappings = getMountMappings();
  for (const { containerPath, hostPath } of mappings) {
    if (localPath === containerPath || localPath.startsWith(containerPath + "/")) {
      return hostPath + localPath.slice(containerPath.length);
    }
  }
  return localPath;
}
