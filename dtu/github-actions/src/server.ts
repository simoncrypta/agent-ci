import http from 'node:http';
import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Digital Twin Universe (DTU) - GitHub API Mock Server
 * 
 * This server mirrors the GitHub REST API for Actions.
 * It maintains an in-memory store of job metadata seeded by simulation scripts.
 */

export const jobs = new Map<string, any>();
export const sessions = new Map<string, any>();
export const messageQueues = new Map<string, any[]>();
export const pendingPolls = new Map<string, http.ServerResponse>();

// Clear state on start
jobs.clear();
sessions.clear();
messageQueues.clear();
pendingPolls.clear();

export const server = http.createServer((req, res) => {
  const { method, headers } = req;
  let { url } = req;

  if (!url) {
    res.statusCode = 400;
    res.end('Missing URL');
    return;
  }

  // Handle absolute URIs (proxy requests)
  if (url.startsWith('http')) {
    const parsedUrl = new URL(url);
    url = parsedUrl.pathname + parsedUrl.search;
  }

  let host = headers.host || `localhost:${config.DTU_PORT}`;
  const protocol = headers['x-forwarded-proto'] || 'http';

  // If host is host.docker.internal without port, append it
  if (host === 'host.docker.internal' || host === 'localhost') {
     host = `${host}:${config.DTU_PORT}`;
  }

  const baseUrl = `${protocol}://${host}`;

  console.log(`[DTU] ${method} ${url} (Host: ${host})`);
  console.log(`[DTU] Headers:`, JSON.stringify(headers, null, 2));
  console.log(`[DTU] Constructed BaseURL: ${baseUrl}`);

  // 1. Internal Seeding Endpoint
  if (method === 'POST' && url === '/_dtu/seed') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const jobId = payload.id?.toString();
        if (jobId) {
          jobs.set(jobId, payload);
          console.log(`[DTU] Seeded job: ${jobId}`);
          
          // Notify any pending polls
          for (const [sessionId, res] of pendingPolls) {
              console.log(`[DTU] Notifying session ${sessionId} of new job ${jobId}`);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                  messageId: 1,
                  messageType: 'PipelineAgentJobRequest',
                  body: JSON.stringify({
                      MessageType: 'PipelineAgentJobRequest',
                      Plan: {
                          PlanId: crypto.randomUUID(),
                      },
                      Timeline: {
                          Id: crypto.randomUUID(),
                      },
                      JobId: crypto.randomUUID(),
                      RequestId: parseInt(jobId) || 1,
                      JobName: payload.name || 'test-job',
                      Steps: [],
                      Variables: {},
                      Resources: {
                          Endpoints: [
                              {
                                  Name: "SystemVssConnection",
                                  Url: baseUrl,
                                  Authorization: {
                                      Scheme: "OAuth",
                                      Parameters: {
                                          AccessToken: `${Buffer.from(JSON.stringify({ alg: "None", typ: "JWT" })).toString('base64url')}.${Buffer.from(JSON.stringify({ orch_id: crypto.randomUUID() })).toString('base64url')}.`
                                      }
                                  }
                              }
                          ]
                      },
                      Workspace: {},
                      ContextData: {}
                  })
              }));
              pendingPolls.delete(sessionId);
          }

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', jobId }));
        } else {
          res.writeHead(400);
          res.end('Missing job ID');
        }
      } catch (e) {
        res.writeHead(400);
        res.end('Invalid JSON');
      }
    });
    return;
  }

  // 2. GitHub REST API Mirror
  const jobMatch = url?.match(/\/repos\/[^/]+\/[^/]+\/actions\/jobs\/(\d+)/);
  if (method === 'GET' && jobMatch) {
    const jobId = jobMatch[1];
    const job = jobs.get(jobId);
    if (job) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(job));
    } else {
      console.warn(`[DTU] Job not found: ${jobId}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not Found (DTU Mock)' }));
    }
    return;
  }

  // 3. GitHub App Token Exchange Mock (App Level)
  const tokenMatch = url?.match(/\/app\/installations\/(\d+)\/access_tokens/);
  if (method === 'POST' && tokenMatch) {
    const installationId = tokenMatch[1];
    const authHeader = req.headers['authorization'];
    console.log(`[DTU] Token exchange for installation: ${installationId}`);
    if (authHeader) {
      console.log(`[DTU] Received JWT: ${authHeader.substring(0, 20)}...`);
    }
    
    // Return a mock installation token
    const response = {
      token: `ghs_mock_token_${installationId}_${Math.random().toString(36).substring(7)}`,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      permissions: {
        actions: "read",
        metadata: "read"
      },
      repository_selection: "selected"
    };

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
    return;
  }

  // 4. GitHub Installation Lookup Mock (Repo Level)
  const repoInstallationMatch = url?.match(/\/repos\/([^/]+)\/([^/]+)\/installation/);
  if (method === 'GET' && repoInstallationMatch) {
    const owner = repoInstallationMatch[1];
    const repo = repoInstallationMatch[2];
    console.log(`[DTU] Fetching installation for ${owner}/${repo}`);

    const response = {
      id: 12345678,
      account: {
        login: owner,
        type: "User",
      },
      repository_selection: "all",
      access_tokens_url: `${baseUrl}/app/installations/12345678/access_tokens`,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
    return;
  }

  // 5. GitHub Runner Registration Token Mock
  const registrationTokenMatch = url?.match(/(?:\/api\/v3)?\/repos\/([^/]+)\/([^/]+)\/actions\/runners\/registration-token/);
  if (method === 'POST' && registrationTokenMatch) {
    const owner = registrationTokenMatch[1];
    const repo = registrationTokenMatch[2];
    console.log(`[DTU] Generating registration token for ${owner}/${repo}`);

    const response = {
      token: `ghr_mock_registration_token_${Math.random().toString(36).substring(7)}`,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString()
    };

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
    return;
  }

  // 6. Global Runner Registration Mock (Discovery/Handshake)
  if (method === 'POST' && (url === '/actions/runner-registration' || url === '/api/v3/actions/runner-registration')) {
    console.log(`[DTU] Handling global runner registration: ${url}`);
    const token = `ghr_mock_tenant_token_${Math.random().toString(36).substring(7)}`;
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      token: token,
      token_schema: "OAuthAccessToken",
      authorization_url: `${baseUrl}/auth/authorize`,
      client_id: "mock-client-id",
      tenant_id: "mock-tenant-id",
      expiration: expiresAt,
      url: baseUrl, // Attempt to populate TenantUrl as well if needed
    }));
    return;
  }

  // 12. Sessions Handler (Mock)
  if (url?.includes('/sessions')) {
    const sessionMatch = url?.match(/\/distributedtask\/pools\/(\d+)\/sessions(?:\/([^/?]+))?/);
    if (sessionMatch) {
      const poolId = sessionMatch[1];
      const sessionId = sessionMatch[2];

      if (method === 'POST' && !sessionId) {
        console.log(`[DTU] Creating session for pool ${poolId}`);
        const newSessionId = crypto.randomUUID();
        const response = {
          sessionId: newSessionId,
          ownerName: "oa-runner",
          agent: {
            id: 1,
            name: "oa-runner",
            version: "2.331.0",
            osDescription: "Linux",
            enabled: true,
            status: "online"
          },
          encryptionKey: {
            value: Buffer.from(crypto.randomBytes(32)).toString('base64'),
            k: "encryptionKey"
          }
        };

        sessions.set(newSessionId, response);
        messageQueues.set(newSessionId, []);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
        return;
      }

      if (method === 'DELETE' && sessionId) {
        console.log(`[DTU] Deleting session ${sessionId} for pool ${poolId}`);
        res.writeHead(204);
        res.end();
        return;
      }
    }
  }

  // 13. Messages Handler (Mock) - Long Polling
  if (url?.includes('/messages')) {
    const urlParts = new URL(url, baseUrl);
    const sessionId = urlParts.searchParams.get('sessionId');

    if (method === 'GET') {
       const lastMessageId = urlParts.searchParams.get('lastMessageId');
       console.log(`[DTU] Polling messages for session ${sessionId} (lastMessageId: ${lastMessageId})`);

       if (!sessionId || !sessions.has(sessionId)) {
           res.writeHead(404);
           res.end('Session not found');
           return;
       }

       // If there's already a pending poll for this session, close it
       const existing = pendingPolls.get(sessionId);
       if (existing) {
           existing.writeHead(204);
           existing.end();
       }
       pendingPolls.set(sessionId, res);

       // Check if we have any queued jobs to send immediately
       if (jobs.size > 0) {
           const [[jobId, jobData]] = Array.from(jobs.entries());
           console.log(`[DTU] Sending immediate job ${jobId} to session ${sessionId}`);
           res.writeHead(200, { 'Content-Type': 'application/json' });
           res.end(JSON.stringify({
               messageId: 1,
               messageType: 'PipelineAgentJobRequest',
               body: JSON.stringify({
                   MessageType: 'PipelineAgentJobRequest',
                   Plan: {
                       PlanId: crypto.randomUUID(),
                   },
                   Timeline: {
                       Id: crypto.randomUUID(),
                   },
                   JobId: crypto.randomUUID(),
                   RequestId: parseInt(jobId) || 1,
                   JobName: jobData.name || 'test-job',
                   Steps: [],
                   Variables: {},
                   Resources: {
                       Endpoints: []
                   },
                   Workspace: {},
                   ContextData: {}
               })
           }));
           jobs.delete(jobId);
           pendingPolls.delete(sessionId);
           return;
       }

       // Long poll: Wait up to 20 seconds before returning empty
       const timeout = setTimeout(() => {
         if (pendingPolls.get(sessionId) === res) {
           pendingPolls.delete(sessionId);
           if (!res.writableEnded) {
             // Returning 204 No Content for timeout is often better for mocks
             res.writeHead(204);
             res.end();
           }
         }
       }, 20000);

       res.on('close', () => {
           clearTimeout(timeout);
           if (pendingPolls.get(sessionId) === res) {
               pendingPolls.delete(sessionId);
           }
       });
       return;
    }

    if (method === 'DELETE') {
       const messageId = urlParts.searchParams.get('messageId');
       console.log(`[DTU] Acknowledging/Deleting message ${messageId} for session ${sessionId}`);
       res.writeHead(204);
       res.end();
       return;
    }
  }

  // 7. Pipeline Service Discovery Mock
  if (method === 'GET' && (url?.includes('/_apis/pipelines') || url?.includes('/_apis/connectionData'))) {
    console.log(`[DTU] Handling service discovery: ${url}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      value: [],
      locationId: crypto.randomUUID(),
      instanceId: crypto.randomUUID(),
      locationServiceData: {
        serviceOwner: "A85B8835-C1A1-4AAC-AE97-1C3D0BA72DBD",
        defaultAccessMappingMoniker: "PublicAccessMapping",
        accessMappings: [
          {
            moniker: "PublicAccessMapping",
            displayName: "Public Access",
            accessPoint: baseUrl
          }
        ],
        serviceDefinitions: [
          {
            serviceType: "distributedtask",
            identifier: "A85B8835-C1A1-4AAC-AE97-1C3D0BA72DBD",
            displayName: "distributedtask",
            relativeToSetting: 3, // FullyQualified
            relativePath: "",
            description: "Distributed Task Service",
            serviceOwner: "A85B8835-C1A1-4AAC-AE97-1C3D0BA72DBD",
            locationMappings: [
              {
                accessMappingMoniker: "PublicAccessMapping",
                location: baseUrl
              }
            ]
          },
          {
            serviceType: "distributedtask",
            identifier: "A8C47E17-4D56-4A56-92BB-DE7EA7DC65BE", // Pools
            displayName: "Pools",
            relativeToSetting: 3, // FullyQualified
            relativePath: "/_apis/distributedtask/pools",
            description: "Pools Service",
            serviceOwner: "A85B8835-C1A1-4AAC-AE97-1C3D0BA72DBD",
            locationMappings: [
              {
                accessMappingMoniker: "PublicAccessMapping",
                location: `${baseUrl}/_apis/distributedtask/pools`
              }
            ]
          }
        ]
      }
    }));
    return;
  }

  // 10. Pools Handler (Mock)
  if (method === 'GET' && url?.includes('/_apis/distributedtask/pools') && !url?.includes('/agents')) {
    console.log(`[DTU] Handling pools request: ${url}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      count: 1,
      value: [
        {
          id: 1,
          name: "Default",
          isHosted: false,
          autoProvision: true
        }
      ]
    }));
    return;
  }

  // 11. Agents Handler (Mock)
  // GET: Check if agent exists
  if (method === 'GET' && url?.includes('/_apis/distributedtask/pools') && url?.includes('/agents')) {
    console.log(`[DTU] Handling get agents request: ${url}`);
    const agentName = new URLSearchParams(url.split('?')[1]).get('agentName');
    
    // If querying by name, return empty list to simulate "not found" so runner registers
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      count: 0,
      value: []
    }));
    return;
  }

  // POST: Register new agent
  if (method === 'POST' && url?.includes('/_apis/distributedtask/pools') && url?.includes('/agents')) {
    console.log(`[DTU] Handling register agent request: ${url}`);
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const payload = JSON.parse(body);
      const agentId = Math.floor(Math.random() * 10000);
      
      const response = {
        id: agentId,
        name: payload.name,
        version: payload.version,
        osDescription: payload.osDescription,
        ephemeral: payload.ephemeral,
        disableUpdate: payload.disableUpdate,
        enabled: true,
        status: "online",
        provisioningState: "Provisioned",
        authorization: {
          clientId: crypto.randomUUID(),
          authorizationUrl: `${baseUrl}/auth/authorize`,
        },
        accessPoint: `${baseUrl}/_apis/distributedtask/pools/${payload.poolId}/agents/${agentId}`
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    });
    return;
  }

  // 8. Global OPTIONS Handler (for CORS/Capabilities + Resource Discovery)
  if (method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-TFS-FedAuthRedirect, X-VSS-E2EID, X-TFS-Session',
      'Content-Type': 'application/json'
    });
    
    // Return the list of available API resources
    // This allows VssHttpClientBase to discover the "Pools" resource
    res.end(JSON.stringify({
      count: 1,
      value: [
        {
          id: "A8C47E17-4D56-4A56-92BB-DE7EA7DC65BE",
          area: "distributedtask",
          resourceName: "pools",
          routeTemplate: "_apis/distributedtask/pools/{poolId}",
          resourceVersion: 1,
          minVersion: "1.0",
          maxVersion: "9.0",
          releasedVersion: "9.0"
        },
        {
          id: "E298EF32-5878-4CAB-993C-043836571F42",
          area: "distributedtask",
          resourceName: "agents",
          routeTemplate: "_apis/distributedtask/pools/{poolId}/agents/{agentId}",
          resourceVersion: 1,
          minVersion: "1.0",
          maxVersion: "9.0",
          releasedVersion: "9.0"
        },
        {
          id: "C3A054F6-7A8A-49C0-944E-3A8E5D7ADFD7",
          area: "distributedtask",
          resourceName: "messages",
          routeTemplate: "_apis/distributedtask/pools/{poolId}/messages",
          resourceVersion: 1,
          minVersion: "1.0",
          maxVersion: "9.0",
          releasedVersion: "9.0"
        },
        {
          id: "134E239E-2DF3-4794-A6F6-24F1F19EC8DC",
          area: "distributedtask",
          resourceName: "sessions",
          routeTemplate: "_apis/distributedtask/pools/{poolId}/sessions/{sessionId}",
          resourceVersion: 1,
          minVersion: "1.0",
          maxVersion: "9.0",
        },
        {
          id: "83597576-CC2C-453C-BEA6-2882AE6A1653",
          area: "distributedtask",
          resourceName: "timelines",
          routeTemplate: "_apis/distributedtask/timelines/{timelineId}",
          resourceVersion: 1,
          minVersion: "1.0",
          maxVersion: "9.0",
          releasedVersion: "9.0"
        },
        {
          id: "8893BC5B-35B2-4BE7-83CB-99E683551DB4",
          area: "distributedtask",
          resourceName: "records",
          routeTemplate: "_apis/distributedtask/timelines/{timelineId}/records/{recordId}",
          resourceVersion: 1,
          minVersion: "1.0",
          maxVersion: "9.0",
          releasedVersion: "9.0"
        },
        {
          id: "FC825784-C92A-4299-9221-998A02D1B54F",
          area: "distributedtask",
          resourceName: "jobrequests",
          routeTemplate: "_apis/distributedtask/jobrequests/{jobId}",
          resourceVersion: 1,
          minVersion: "1.0",
          maxVersion: "9.0",
          releasedVersion: "9.0"
        },
        {
          id: "0A1EFD25-ABDA-43BD-9629-6C7BDD2E0D60",
          area: "distributedtask",
          resourceName: "jobinstances",
          routeTemplate: "_apis/distributedtask/jobinstances/{jobId}",
          resourceVersion: 1,
          minVersion: "1.0",
          maxVersion: "9.0",
          releasedVersion: "9.0"
        }
      ]
    }));
    return;
  }

  // 9. Generic API Root Handler (to prevent 404s on discovery)
  if (method === 'GET' && url?.startsWith('/_apis')) {
    console.log(`[DTU] Catch-all for _apis: ${url}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value: [] }));
    return;
  }


  // health check
  if ((method === 'GET' || method === 'HEAD') && url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(method === 'GET' ? JSON.stringify({ status: 'online', seededJobs: jobs.size }) : undefined);
    return;
  }

  res.writeHead(404);
  res.end('Not Found (DTU Mock)');
});

if (import.meta.url === `file://${process.argv[1]}` || process.env.NODE_ENV !== 'test') {
  server.listen(config.DTU_PORT, () => {
    console.log(`[DTU] Mock GitHub API server running at http://localhost:${config.DTU_PORT}`);
  });
}
