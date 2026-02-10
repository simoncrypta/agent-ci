import { env } from "cloudflare:workers";
import { route } from "rwsdk/router";
import { z } from "zod";

import { SECRETS } from "../secrets";

export const apiRoutes = [
  route("/webhook", { post: handleWebhook }),
  route("/jobs", { get: handleJobs }),
  route("/repos/:owner/:repo/actions/jobs/:jobId", { get: handleGitHubJobDetails }),
];

const webhookHeadersSchema = z.object({
  "x-github-delivery": z.string(),
  "x-github-event": z.string(),
  "x-hub-signature-256": z.string(),
});

async function handleWebhook({ request }: { request: Request }): Promise<Response> {
  const headersResult = webhookHeadersSchema.safeParse({
    "x-github-delivery": request.headers.get("x-github-delivery"),
    "x-github-event": request.headers.get("x-github-event"),
    "x-hub-signature-256": request.headers.get("x-hub-signature-256"),
  });

  if (!headersResult.success) {
    return new Response("Missing or invalid GitHub headers", { status: 400 });
  }

  const {
    "x-github-delivery": deliveryId,
    "x-github-event": eventType,
    "x-hub-signature-256": signature,
  } = headersResult.data;

  // 1. Validate Secret & Signature
  const body = await request.text();
  const isValid = await verifySignature(SECRETS.GITHUB_WEBHOOK_SECRET, signature, body);
  if (!isValid) return new Response("Invalid signature", { status: 401 });

  // 2. Filter events
  if (eventType !== "workflow_job") {
    return new Response(`Event type ${eventType} ignored`, { status: 200 });
  }

  // 3. Deduplication check
  const existing = await env.OA1_BRIDGE_JOBS.get(`webhook@${deliveryId}`);
  if (existing) {
    return new Response("Webhook already processed", { status: 200 });
  }

  const payload = JSON.parse(body);
  const username = payload.repository?.owner?.login;

  if (!username) {
    return new Response("Could not identify user", { status: 400 });
  }

  // 4. Store Webhook for UI
  const webhookData = {
    deliveryId,
    eventType,
    timestamp: Date.now(),
    username,
    payload: payload,
    status: "queued",
  };

  await env.OA1_BRIDGE_JOBS.put(`webhook@${deliveryId}`, JSON.stringify(webhookData));
  
  // Store mapping for GitHub API mock
  const jobId = payload.workflow_job?.id;
  if (jobId) {
    await env.OA1_BRIDGE_JOBS.put(`jobid@${jobId}`, deliveryId);
  }
  
  // 5. Identify User & Check Presence
  const presence = await env.OA1_BRIDGE_PRESENCE.get(`presence@${username}`);
  
  if (!presence) {
    console.log(`User ${username} is OFFLINE. Triggering cloud fallback.`);
    webhookData.status = "fallback";
    await env.OA1_BRIDGE_JOBS.put(`webhook@${deliveryId}`, JSON.stringify(webhookData));
    return new Response("User offline, fallback triggered", { status: 200 });
  }

  // 6. Queue Job for Runner (GitHub metadata)
  const jobsJson = await env.OA1_BRIDGE_JOBS.get(`queued_jobs@${username}`);
  const jobs = jobsJson ? JSON.parse(jobsJson) : [];
  
  jobs.push({ 
    deliveryId,
    githubJobId: payload.workflow_job.id,
    githubRepo: payload.repository.full_name,
    githubToken: SECRETS.GITHUB_TOKEN, // Pass the token to the runner -> container
  }); 
  
  await env.OA1_BRIDGE_JOBS.put(`queued_jobs@${username}`, JSON.stringify(jobs));

  return new Response("Job queued locally", { status: 200 });
}



async function handleJobs({ request }: { request: Request }): Promise<Response> {
  const url = new URL(request.url);
  const username = url.searchParams.get("username");

  if (!username) {
    return new Response("Missing username", { status: 400 });
  }

  // Update presence
  await env.OA1_BRIDGE_PRESENCE.put(`presence@${username}`, JSON.stringify({ status: "online", lastSeen: Date.now() }), {
    expirationTtl: 60, // 60 seconds TTL
  });

  // Get and Clear for MVP
  const jobsJson = await env.OA1_BRIDGE_JOBS.get(`queued_jobs@${username}`);
  const jobs = jobsJson ? JSON.parse(jobsJson) : [];

  if (jobs.length > 0) {
    // Clear the queue
    await env.OA1_BRIDGE_JOBS.put(`queued_jobs@${username}`, JSON.stringify([]));
  }

  return new Response(JSON.stringify(jobs), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleGitHubJobDetails({ params }: { params: Record<string, string> }): Promise<Response> {
  const jobId = params.jobId;
  const deliveryId = await env.OA1_BRIDGE_JOBS.get(`jobid@${jobId}`);

  if (!deliveryId) {
    return new Response(JSON.stringify({ message: "Not Found (DTU Mock)" }), { 
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  const webhookDataRaw = await env.OA1_BRIDGE_JOBS.get(`webhook@${deliveryId}`);
  if (!webhookDataRaw) {
    return new Response(JSON.stringify({ message: "Webhook data missing (DTU Mock)" }), { 
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  const webhookData = JSON.parse(webhookDataRaw);
  return new Response(JSON.stringify(webhookData.payload.workflow_job), {
    headers: { "Content-Type": "application/json" },
  });
}


/**
 * Utilities
 */

async function verifySignature(secret: string, header: string | null, payload: string): Promise<boolean> {
  if (!secret || !header) return false;
  const parts = header.split("=");
  const sigHex = parts[1];
  
  if (!sigHex) return false;

  const algorithm = { name: "HMAC", hash: "SHA-256" };
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    algorithm,
    false,
    ["verify"]
  );

  try {
    const verified = await crypto.subtle.verify(
      algorithm,
      key,
      hexToBytes(sigHex) as any,
      new TextEncoder().encode(payload)
    );
    return verified;
  } catch (e) {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
