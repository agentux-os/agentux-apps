import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// Development/demo server for AgentUX Office. Production operators use the
// same-origin /office/ route served by Command with their own OIDC session.
const root = fileURLToPath(new URL('../apps/office/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = createServer(async (request, response) => {
  if (request.url === '/config.js') {
    response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    response.end('globalThis.AGENTUX_OFFICE_CONFIG = {};');
    return;
  }
  if (request.url.startsWith('/v1/')) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'the demo server does not connect to Command' }));
    return;
  }
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
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`Office demo listening on http://${host}:${port}`));
