# Runner

The **Runner** is a Node.js daemon that executes on your local machine. It polls the **Bridge** for jobs and manages Docker containers to execute GitHub Actions.

## Features

- **Polling**: Continuously checks for assigned jobs.
- **Docker Integration**: Spawns isolated containers for job execution.
- **Freeze on Failure**: Keeps containers alive if a step fails for easy debugging.

## Development

This package is part of a `pnpm` workspace.

1. **Environment Variables**:
   Symlinked to the root `.env`. Ensure the root `.env` is configured.

2. **Run Locally**:
   From the project root:
   ```bash
   pnpm --filter runner dev
   ```

## Configuration

The runner relies on:

- `BRIDGE_URL`: The URL of the Bridge API.
- `BRIDGE_API_KEY`: Authentication for polling jobs.
- `GITHUB_USERNAME`: Your GitHub username for identifying assigned jobs.

## Future

We will enable authentication via GitHub for your personal account.
