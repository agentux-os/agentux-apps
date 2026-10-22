// serve-office's proxy against a fake Command: what the browser sends that
// Command needs (If-Match, the token it adds) gets there, and what Command
// answers that the page needs (ETag) comes back.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('the proxy passes If-Match and the token to Command, and ETag back', async (t) => {
  const seen = [];
  const command = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      seen.push({ method: request.method, url: request.url, ifMatch: request.headers['if-match'], authorization: request.headers.authorization, body });
      response.writeHead(200, { 'content-type': 'application/json', etag: '"4"' });
      response.end(JSON.stringify({ revision: 4 }));
    });
  });
  await new Promise((resolve) => command.listen(0, '127.0.0.1', resolve));
  const port = 41000 + Math.floor(Math.random() * 1000);
  const office = spawn(process.execPath, [fileURLToPath(new URL('./serve-office.mjs', import.meta.url))], {
    env: { ...process.env, COMMAND_URL: `http://127.0.0.1:${command.address().port}`, COMMAND_TOKEN: 'secret-token', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  t.after(() => { office.kill(); command.close(); });
  await new Promise((resolve) => office.stdout.once('data', resolve));

  const response = await fetch(`http://127.0.0.1:${port}/v1/organizations/acme/definitions/2`, {
    method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': '"3"' }, body: JSON.stringify({ schema_version: '1.0' })
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('etag'), '"4"');
  assert.deepEqual(seen[0], { method: 'PUT', url: '/v1/organizations/acme/definitions/2', ifMatch: '"3"', authorization: 'Bearer secret-token', body: '{"schema_version":"1.0"}' });
  const config = await (await fetch(`http://127.0.0.1:${port}/config.js`)).text();
  assert.ok(!config.includes('secret-token'), 'the token never reaches the page');
});
