import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// Development-only fixture server for the Command console. Production uses
// Command's same-origin /console/ route and per-operator OIDC sessions.
const root = fileURLToPath(new URL('../apps/command/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (request, response) => {
  if (request.url === '/config.js') {
    response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    response.end('globalThis.AGENTUX_COMMAND_CONFIG = {};');
    return;
  }
  const requested = request.url === '/' ? '/index.html' : request.url;
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

const port = Number(process.env.PORT ?? 4174);
server.listen(port, '127.0.0.1', () => console.log(`Command console listening on http://127.0.0.1:${port}`));
