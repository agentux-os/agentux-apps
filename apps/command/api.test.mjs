import assert from 'node:assert/strict';
import { agentsOf, commandMany, createCommandApi, createFixtureApi, limitsOf, nodeState, summarize } from './api.js';

// The real API: requests, auth header and the node's errors.
const calls = [];
const fetchImpl = async (url, options) => {
  calls.push({ url, options });
  if (url.endsWith('/v1/nodes/node-a/commands')) {
    const body = JSON.parse(options.body);
    if (body.method === 'preferences.set') {
      return { ok: false, status: 409, json: async () => ({ commandId: 'c2', error: { code: -32010, message: 'awaiting_local_confirmation' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ commandId: 'c1', result: { listed: true } }) };
  }
  if (url.endsWith('/v1/enrollments')) return { ok: true, status: 200, json: async () => ({ nodes: [{ nodeId: 'node-a', approved: false }] }) };
  return { ok: false, status: 503, json: async () => ({ error: 'the node is not connected' }) };
};
const api = createCommandApi({ baseUrl: 'https://command.acme.org/', token: 'leader', fetchImpl });

const listed = await api.command('node-a', 'harness.list');
assert.deepEqual(listed, { ok: true, nodeId: 'node-a', commandId: 'c1', result: { listed: true } });
assert.equal(calls[0].url, 'https://command.acme.org/v1/nodes/node-a/commands');
assert.equal(calls[0].options.headers.Authorization, 'Bearer leader');

const held = await api.command('node-a', 'preferences.set', { preferences: {} });
assert.equal(held.held, true);
assert.equal(held.ok, false);

const offline = await api.command('node-b', 'harness.list');
assert.equal(offline.ok, false);
assert.match(offline.error, /not connected/);
await assert.rejects(() => api.command('node-a', 'shell.exec'), /not a node command/);
assert.deepEqual(await api.enrollments(), [{ nodeId: 'node-a', approved: false }]);

// Several nodes, one outcome each.
const outcomes = await commandMany(api, ['node-a', 'node-b'], 'harness.list', {});
assert.equal(summarize(outcomes), '1 done, 1 failed');
assert.equal(summarize([{ ok: false, held: true }]), '1 waiting for someone at the node');

// What a node reported.
const fixture = createFixtureApi();
const [busy, limited] = await fixture.nodes();
assert.equal(agentsOf(busy).length, 3);
assert.equal(limitsOf(limited)[0].kind, 'weekly');
assert.equal(nodeState(busy), 'waiting');
assert.equal(nodeState(limited), 'online');
assert.equal(nodeState({ ...busy, lastSeenAt: new Date(Date.now() - 10 * 60_000).toISOString() }), 'offline');
assert.equal(nodeState({ status: 'pending_approval' }), 'pending_approval');

// Tokens with provision files.
const issued = await fixture.issueTokens({ organizationId: 'acme', count: 2, provision: { profile: 'node', user: 'dev' } });
assert.equal(issued.tokens.length, 2);
assert.equal(issued.tokens[1].provision.command.enrollmentToken, issued.tokens[1].token);

console.log('validated the Command console API adapter');
