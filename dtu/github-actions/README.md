# Digital Twin Universe (DTU) - GitHub Actions

This directory contains tools and mocks to simulate GitHub Actions workflows locally.

## Purpose

The DTU allows developers to run and test the `oa-1-bridge` and `oa-1-runner` integration without deploying to GitHub. It simulates GitHub events (like `push` and `workflow_dispatch`) and sends them to the local Bridge instance.

## Usage

1.  **Start the Bridge**: Ensure your local `oa-1-bridge` is running.
2.  **Start the Runner**: Ensure your local `oa-1-runner` is running and polling the Bridge.
3.  **Run Simulation**:
    ```bash
    npx tsx dtu/github-actions/simulate.ts
    ```

## Structure

-   `events/`: Contains mock JSON payloads for GitHub events.
    -   `push.json`: Mock payload for a `push` event.
    -   `workflow_dispatch.json`: Mock payload for a manual `workflow_dispatch` event.
-   `simulate.ts`: The main script to trigger simulations.
