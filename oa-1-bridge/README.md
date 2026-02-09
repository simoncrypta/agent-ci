# OA-1 Bridge

The **OA-1 Bridge** is a Cloudflare Worker that acts as a secure traffic controller between GitHub Actions and your local runner.

## Architecture

This service is "stateless" but uses Cloudflare KV for presence and job queuing.

### Roles
1. **Webhook Handler**: Receives `workflow_job` events from GitHub.
2. **Presence Monitor**: Tracks if your local runner is online via Heartbeat API.
3. **Job Queue**: Temporarily holds jobs (in KV) until the local runner picks them up.

### API Endpoints

- `POST /api/webhook`: Receives GitHub webhooks using `X-Hub-Signature-256`.
- `POST /api/heartbeat`: Receives `{ runnerId, status }` to update presence.
- `GET /api/jobs?runnerId=...`: Returns pending jobs for a specific runner.

## Development

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run Locally**:
   ```bash
   npm run dev
   ```

3. **Simulate Webhook (Testing)**:
   You can use `curl` to simulate a GitHub webhook targeting your local development server.

## Deploy

```bash
npm run release
```
