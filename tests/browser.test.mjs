// Office in a real browser (Chromium, through Playwright) against a fake
// Command: accessibility (axe), keyboard approval, repeated submission, a
// slow network, Command unavailable, a large organization and Portuguese.
//
//   npx playwright install chromium   # once
//   npm run test:browser
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const axe = await readFile(fileURLToPath(new URL('../node_modules/axe-core/axe.min.js', import.meta.url)), 'utf8');

const projection = (overrides = {}) => ({
  organizationId: 'acme', schemaVersion: 'office-projection.v1', definitionVersion: 'definition-2', projectedAt: new Date().toISOString(),
  source: 'command-postgres', freshness: 'fresh', lastEventId: 'e1',
  organization: { id: 'acme', name: 'Acme Robotics' },
  areas: [{ id: 'eng', name: 'Engineering' }], missions: [{ id: 'ship', area_id: 'eng', name: 'Ship a release' }],
  agents: [{ id: 'dev-1', role_id: 'dev' }],
  nodes: [{ id: 'node-a', presence: 'online', status: 'online', connected: true }],
  runs: [{ id: 'run-1', kind: 'mission', missionId: 'ship', status: 'waiting', step: 'review' }],
  approvals: [{ id: 'ap-1', runId: 'run-1', title: 'Ship a release: review', status: 'pending', policy: 'human-required' }],
  artifacts: [],
  events: [{ eventId: 'e1', eventType: 'mission.run.gate_waiting', runId: 'run-1', occurredAt: new Date().toISOString(), data: { runId: 'run-1', step: 'review' } }],
  ...overrides
});

/** The fake Command's behavior, changed by each test. */
const scenario = { delay: 0, status: 200, body: projection(), resolves: 0 };
const command = createServer((request, response) => {
  const url = new URL(request.url, 'http://x');
  const send = (status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
  if (url.pathname === '/v1/office/projection') {
    return setTimeout(() => (scenario.status === 200 ? send(200, scenario.body) : send(scenario.status, { error: 'projection_unavailable' })), scenario.delay);
  }
  if (url.pathname.endsWith('/events/stream')) { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write(': open\n\n'); return; }
  if (url.pathname.endsWith('/events')) return send(200, { events: [], next: 0 });
  if (url.pathname.endsWith('/resolve')) {
    scenario.resolves += 1;
    let body = '';
    request.on('data', (c) => { body += c; });
    return request.on('end', () => setTimeout(() => send(200, { ok: true, organizationId: 'acme', approvalId: 'ap-1', decision: JSON.parse(body).decision }), 300));
  }
  send(404, { error: 'not found' });
});

let browser;
const servers = [];
const start = (env) => new Promise((resolve) => {
  const port = 42000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/serve-office.mjs', import.meta.url))], { env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  servers.push(child);
  child.stdout.once('data', () => resolve(`http://127.0.0.1:${port}`));
});
let demo, live;

before(async () => {
  await new Promise((resolve) => command.listen(0, '127.0.0.1', resolve));
  demo = await start({});
  live = await start({ COMMAND_URL: `http://127.0.0.1:${command.address().port}`, COMMAND_ORGANIZATION: 'acme' });
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); for (const s of servers) s.kill(); command.close(); });

async function page(url, options = {}) {
  const context = await browser.newContext({ locale: 'en-US', ...options });
  const p = await context.newPage();
  await p.goto(url);
  return p;
}

async function violations(p) {
  await p.addScriptTag({ content: axe });
  const result = await p.evaluate(async () => globalThis.axe.run(document, { resultTypes: ['violations'] }));
  return result.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test('the floor, a detail and the editor have no serious accessibility problems', async () => {
  const floor = await page(`${demo}/`);
  await floor.waitForSelector('a.desk');
  assert.deepEqual(await violations(floor), []);
  await floor.goto(`${demo}/#/run/run-fulfillment`);
  await floor.waitForSelector('#detail:not([hidden]) #detail-title');
  assert.deepEqual(await violations(floor), []);
  const editor = await page(`${demo}/editor.html`);
  await editor.waitForSelector('#history li');
  assert.deepEqual(await violations(editor), []);
});

test('an approval is decided from the keyboard, once however often it is pressed', async () => {
  Object.assign(scenario, { delay: 0, status: 200, body: projection(), resolves: 0 });
  const p = await page(`${live}/`);
  const approve = p.locator('button[data-approval="ap-1"][data-decision="approved"]');
  await approve.focus();
  await p.keyboard.press('Enter');
  await p.keyboard.press('Enter');
  await approve.click({ force: true }).catch(() => {});
  await p.waitForFunction(() => document.querySelector('[data-outcome="ap-1"]')?.textContent.includes('Decision recorded'));
  assert.equal(scenario.resolves, 1, 'one request');
  assert.equal(await p.evaluate(() => globalThis.agentuxOffice.metrics.decisions), 1);
});

test('a slow Command shows loading, then the organization', async () => {
  Object.assign(scenario, { delay: 1500, status: 200, body: projection() });
  const p = await page(`${live}/`);
  await p.waitForSelector('#state-banner:not([hidden])');
  assert.match(await p.textContent('#state-banner'), /Loading/);
  await p.waitForSelector('a.desk', { timeout: 5000 });
  assert.equal(await p.isHidden('#state-banner'), true);
  assert.ok(await p.evaluate(() => globalThis.agentuxOffice.metrics.lastLoadMs) >= 1400);
});

test('Command unavailable is an alert, and Office says when it retries', async () => {
  Object.assign(scenario, { delay: 0, status: 503 });
  const p = await page(`${live}/`);
  await p.waitForSelector('#state-banner[role="alert"]');
  assert.match(await p.textContent('#state-banner'), /projection_unavailable|unavailable/);
  await p.waitForFunction(() => /retrying in \d+ s/.test(document.getElementById('connection-status').textContent));
  Object.assign(scenario, { status: 200, body: projection() });
});

test('a large organization draws 300 desks and says how to see the rest', async () => {
  const runs = Array.from({ length: 5000 }, (_, i) => ({ id: `run-${i}`, missionId: 'ship', status: i % 2 ? 'running' : 'failed' }));
  Object.assign(scenario, { delay: 0, status: 200, body: projection({ runs }) });
  const p = await page(`${live}/`);
  await p.waitForSelector('a.desk');
  assert.equal(await p.locator('a.desk').count(), 300);
  assert.match(await p.textContent('#floor-more'), /Showing 300 of 5002/);
  assert.ok(await p.evaluate(() => globalThis.agentuxOffice.metrics.lastRenderMs) < 1000, 'render within a second');
  await p.selectOption('#status-filter', 'blocked');
  assert.equal(await p.locator('a.desk').count(), 300);
  Object.assign(scenario, { body: projection() });
});

test('Office speaks Portuguese to a Portuguese browser', async () => {
  Object.assign(scenario, { delay: 0, status: 200, body: projection() });
  const p = await page(`${live}/`, { locale: 'pt-BR' });
  await p.waitForSelector('a.desk');
  assert.equal(await p.textContent('[data-i18n="label.active"]'), 'Trabalho ativo');
  assert.equal(await p.textContent('button[data-decision="approved"]'), 'Aprovar');
  assert.equal(await p.getAttribute('html', 'lang'), 'pt-BR');
});
