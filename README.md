# Opposite-Action

**Opposite-Action** is a local-first CI runner system. It allows GitHub Actions to execute on your own hardware (your MacBook) while providing a seamless fallback to GitHub-hosted runners when you are offline.

Unlike standard ephemeral runners, **Opposite-Action** is designed to **freeze on failure**, preserving the Docker container and local filesystem for immediate, interactive debugging.

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
          RESPONSE=$(curl -s [https://oa.your-domain.workers.dev/status?user=$](https://oa.your-domain.workers.dev/status?user=$){{ github.actor }})
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
          npm test