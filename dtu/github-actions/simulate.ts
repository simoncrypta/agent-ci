
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BRIDGE_URL = process.env.BRIDGE_URL || 'http://localhost:8910';
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || 'dtu-sandbox-secret';

async function signPayload(payload: string, secret: string): Promise<string> {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

async function main() {
  const event = process.argv[2] || 'workflow_job';

  const payloadPath = path.join(__dirname, 'events', `${event}.json`);

  if (!fs.existsSync(payloadPath)) {
    const availableEvents = fs.readdirSync(path.join(__dirname, 'events'))
      .map(f => f.replace('.json', ''));
    console.error(`Payload not found: ${payloadPath}`);
    console.error(`Available events: ${availableEvents.join(', ')}`);
    process.exit(1);
  }

  const rawPayload = fs.readFileSync(payloadPath, 'utf-8');
  const payload = JSON.parse(rawPayload);
  const deliveryId = crypto.randomUUID();

  console.log(`[DTU] Simulating "${event}" event...`);
  console.log(`[DTU] Delivery ID: ${deliveryId}`);
  console.log(`[DTU] Target Bridge: ${BRIDGE_URL}`);

  const signature = await signPayload(rawPayload, WEBHOOK_SECRET);

  try {
    const response = await fetch(`${BRIDGE_URL}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': event,
        'X-GitHub-Delivery': deliveryId,
        'X-Hub-Signature-256': signature,
      },
      body: rawPayload,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[DTU] Failed to trigger event: ${response.status} ${response.statusText}`);
      console.error(`[DTU] Response: ${text}`);
      process.exit(1);
    }

    console.log('[DTU] Event triggered successfully!');
    const text = await response.text();
    console.log('[DTU] Bridge Response:', text);

  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error(`[DTU] Error: Could not connect to Bridge at ${BRIDGE_URL}. Is it running?`);
    } else {
      console.error('[DTU] Error triggering event:', error);
    }
    process.exit(1);
  }
}

main();
