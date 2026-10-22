import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

// Serves AgentUX Office. With COMMAND_URL it shows that Command's
// organization (COMMAND_ORGANIZATION, org-demo by default): requests to /v1/
// go through this server, which adds COMMAND_TOKEN (an operator token with
// organization.read, and approval.decide to decide), so the token never
// reaches the browser and the live stream works. Without COMMAND_URL it shows
// demo data.
const root = fileURLToPath(new URL('../apps/office/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const commandUrl = (process.env.COMMAND_URL || '').replace(/\/$/, '');
const token = process.env.COMMAND_TOKEN || '';
const config = commandUrl ? { command: true, organizationId: process.env.COMMAND_ORGANIZATION || 'org-demo' } : {};

async function proxy(request, response) {
  const headers = { accept: request.headers.accept || 'application/json' };
  if (request.headers['content-type']) headers['content-type'] = request.headers['content-type'];
  if (request.headers['last-event-id']) headers['last-event-id'] = request.headers['last-event-id'];
  if (token) headers.authorization = `Bearer ${token}`;
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : Readable.toWeb(request);
  const controller = new AbortController();
  // The browser went away (a closed stream): stop asking Command.
  response.on('close', () => controller.abort());
  try {
    const upstream = await fetch(`${commandUrl}${request.url}`, { method: request.method, headers, body, duplex: 'half', signal: controller.signal });
    response.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store'
    });
    if (!upstream.body) return response.end();
    // Streams pass through as they come (the live event stream).
    for await (const chunk of upstream.body) response.write(chunk);
    response.end();
  } catch (error) {
    if (response.headersSent) return response.end();
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: `Command is unreachable: ${error.message}` }));
  }
}

const server = createServer(async (request, response) => {
  if (request.url === '/config.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(`globalThis.AGENTUX_OFFICE_CONFIG = ${JSON.stringify(config)};`);
    return;
  }
  if (commandUrl && request.url.startsWith('/v1/')) return proxy(request, response);
  const requested = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  const path = normalize(join(root, requested));
  if (!path.startsWith(root)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(path);
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'text/plain' });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
});

const port = Number(process.env.PORT ?? 4173);
server.listen(port, '127.0.0.1', () => console.log(`Office listening on http://127.0.0.1:${port}${commandUrl ? ` (Command: ${commandUrl})` : ' (demo data)'}`));
