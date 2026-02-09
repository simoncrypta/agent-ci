To understand how GitHub communicates with a runner, you have to look at the direction of the traffic. It is a pull-based system, not a push-based one. GitHub never actually "calls" your runner; your runner calls GitHub.

1. The Long-Poll Connection
When you start the GitHub Actions runner application on your machine, it establishes an HTTPS connection to GitHub's message service. It uses Long Polling.

The Request: The runner sends a request to GitHub saying, "Do you have a job for me?"

The Wait: GitHub holds that request open for up to 50 seconds. If a job appears during that time, GitHub responds immediately with the job details.

The Loop: If no job appears, the connection times out, and the runner immediately sends a new request.

2. Job Assignment and Token Exchange
Once a job is available and the runner claims it, the communication shifts into a more intensive phase:

Ephemeral Token: GitHub provides the runner with a temporary ACTIONS_RUNTIME_TOKEN. This token is only valid for the duration of that specific job.

Job Specification: GitHub sends a JSON payload containing the "Plan." This includes the steps, environment variables, and secrets (encrypted) required for the run.

Heartbeats: While the job is running, the runner sends "heartbeat" signals every few seconds. If GitHub stops receiving these, it assumes the runner has crashed or lost power and marks the job as failed.

3. Log and Artifact Streaming
As the runner executes your shell commands (or Docker containers), it needs to send data back so you can see it in the browser:

Live Logs: The runner streams stdout and stderr back to GitHub’s log service in real-time chunks.

Artifacts: If your workflow has an upload-artifact step, the runner opens a separate connection to GitHub’s storage service (usually backed by Azure Blob Storage or AWS S3) to upload those files.

4. Why this matters for "Opposite-Action"
This architecture is exactly why your Opposite-Action system is possible:

No Inbound Ports: Because the runner initiates the connection, you don't need to open any ports on your router or handle complex firewall rules.

Cloudflare as the Buffer: In your system, the Cloudflare Worker mimics this "Message Service" behavior. Your local oa agent polls the Worker just like the official runner polls GitHub, creating a familiar and secure communication loop.