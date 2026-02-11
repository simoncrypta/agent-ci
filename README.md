# Opposite-Action

**Opposite-Action** is a local-first CI runner system. It allows GitHub Actions to execute on your own hardware (your MacBook) while providing a seamless fallback to GitHub-hosted runners when you are offline.

Unlike standard ephemeral runners, **Opposite-Action** is designed to **freeze on failure**, preserving the Docker container and local filesystem for immediate, interactive debugging.

---

## Project Structure

This project is organized as a `pnpm` workspace:

- [bridge/](file:///Users/peterp/gh/redwoodjs/oa-1/bridge): A Cloudflare Worker that orchestrates jobs and presence.
- [runner/](file:///Users/peterp/gh/redwoodjs/oa-1/runner): A Node.js agent that polls the bridge and runs Docker jobs.
- [dtu/github-actions/](file:///Users/peterp/gh/redwoodjs/oa-1/dtu/github-actions): Digital Twin Universe mock tools for local simulation.

---

## Getting Started

### 1. Prerequisites
- `pnpm` (v10+)
- `Docker` installed and running.

### 2. Install Dependencies
Run from the root directory:
```bash
pnpm install
```

### 3. Environment Setup
Shared environment variables are managed at the root.
1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
2. Edit `.env` and `.dev.vars` at the root as needed. 

> [!NOTE]
> All services use symbolic links pointing back to these root files:
> - `bridge/.env` -> `../.env`
> - `runner/.env` -> `../.env`
> - `dtu/github-actions/.env` -> `../../.env`

---

## Run Locally

You can run all services in the required sequence from the root:
```bash
pnpm dev
```

This command uses `concurrently` and `wait-on` to ensure:
1. `dtu/github-actions` (Mock Server) starts first on port 8910.
2. `bridge` waits for the mock server to be ready and starts on port 8911.
3. `runner` waits for the bridge to be ready.

Or target specific services:
```bash
pnpm --filter dtu/github-actions dev
pnpm --filter bridge dev
```

---

## System Architecture

The system consists of three primary technical components:

1.  **Cloudflare Worker (Orchestrator):** The source of truth for runner availability. It queues jobs and manages "Heartbeats" from local nodes.
2.  **Local Runner (Agent):** A Node.js daemon running on your MacBook that polls for jobs and manages the Docker lifecycle.
3.  **Docker Environment (Execution):** Standard `ghcr.io/actions/actions-runner` containers that perform the work.

---

## The Fallback Logic

The system ensures that your PRs are never blocked. It uses a dynamic `runs-on` strategy based on your current local availability.

### Workflow Configuration (`.github/workflows/ci.yml`)

```yaml
jobs:
  check-availability:
    runs-on: ubuntu-latest
    outputs:
      target_runner: ${{ steps.status.outputs.label }}
    steps:
      - id: status
        run: |
          # Query the Cloudflare Orchestrator for local agent presence
          RESPONSE=$(curl -s https://oa.your-domain.workers.dev/status?user=${{ github.actor }})
          if [ "$RESPONSE" == "active" ]; then
            echo "label=self-hosted" >> $GITHUB_OUTPUT
          else
            echo "label=ubuntu-latest" >> $GITHUB_OUTPUT
          fi

  test:
    needs: check-availability
    runs-on: ${{ needs.check-availability.outputs.target_runner }}
    steps:
      - uses: actions/checkout@v4
      - name: Run Tests
        run: |
          # Your standard test commands
          pnpm test
```