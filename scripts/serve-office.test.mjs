// The demo server ignores legacy proxy credentials and never connects to
// Command. Production uses Command's same-origin Office and Console routes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('Office demo server does not proxy requests or expose legacy credentials', async (t) => {
  let requests = 0;
  const command = createServer((request, response) => {
    requests++;
    response.writeHead(200).end('unexpected upstream request');
  });
  await new Promise((resolve) => command.listen(0, '127.0.0.1', resolve));
  const port = 41000 + Math.floor(Math.random() * 1000);
  const office = spawn(process.execPath, [fileURLToPath(new URL('./serve-office.mjs', import.meta.url))], {
    env: { ...process.env, COMMAND_URL: `http://127.0.0.1:${command.address().port}`, COMMAND_TOKEN: 'secret-token', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  t.after(() => { office.kill(); command.close(); });
  await new Promise((resolve) => office.stdout.once('data', resolve));

  const response = await fetch(`http://127.0.0.1:${port}/v1/organizations/acme/definitions/2`, { method: 'PUT' });
  assert.equal(response.status, 404);
  assert.equal(requests, 0, 'legacy upstream URL is ignored');
  const config = await (await fetch(`http://127.0.0.1:${port}/config.js`)).text();
  assert.equal(config, 'globalThis.AGENTUX_OFFICE_CONFIG = {};');
  assert.ok(!config.includes('secret-token'));
});
