# Bridge

The **Bridge** is a Cloudflare Worker that acts as a secure traffic controller between GitHub Actions and your local runner.

## Architecture

This service is "stateless" but uses Cloudflare KV for presence and job queuing.

### Roles
1. **Webhook Handler**: Receives `workflow_job` events from GitHub.
2. **Presence Monitor**: Tracks if your local runner is online via Heartbeat API.
3. **Job Queue**: Temporarily holds jobs (in KV) until the local runner picks them up.

### API Endpoints

- `POST /api/webhook`: Receives GitHub webhooks using `X-Hub-Signature-256`.
- `GET /api/jobs?username=...`: Returns pending jobs for a specific user. Requires `x-api-key` header.

## Development

This package is part of a `pnpm` workspace.

1. **Environment Variables**:
   This package symlinks `.env` and `.dev.vars` to the root of the project. Ensure you have configured the root `.env` file.

2. **Run Locally**:
   From the project root:
   ```bash
   pnpm --filter bridge dev
   ```

## Deploy

```bash
pnpm --filter bridge release
```
