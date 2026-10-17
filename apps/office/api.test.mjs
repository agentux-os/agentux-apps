import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandApi, createFixtureApi } from './api.js';

const projection = {
  organizationId: 'org-demo', schemaVersion: 'office-projection.v1', definitionVersion: 'definition-3',
  projectedAt: '2026-10-17T12:00:00Z', source: 'command-memory', freshness: 'fresh', lastEventId: 'evt-107',
  organization: { id: 'org-demo', name: 'Acme Robotics' }, areas: [], missions: [], agents: [{ id: 'agent-01' }], nodes: [], runs: [], approvals: [], artifacts: [], events: []
};

test('CommandApi loads a ready projection and sends authorization', async () => {
  const api = createCommandApi({ baseUrl: 'http://command.test', token: 'secret', fetchImpl: async (url, options) => {
    assert.equal(url, 'http://command.test/v1/office/projection?organizationId=org-demo');
    assert.equal(options.headers.Authorization, 'Bearer secret');
    return new Response(JSON.stringify(projection), { status: 200, headers: { 'content-type': 'application/json' } });
  }});
  const result = await api.loadProjection({ organizationId: 'org-demo' });
  assert.equal(result.status, 'ready');
  assert.equal(result.projection.lastEventId, 'evt-107');
});

test('CommandApi preserves typed authorization and approval conflicts', async () => {
  const api = createCommandApi({ baseUrl: 'http://command.test', token: 'secret', fetchImpl: async (url) => {
    if (url.includes('/projection')) return new Response(JSON.stringify({ error: 'invalid credentials' }), { status: 401 });
    return new Response(JSON.stringify({ ok: false, conflict: { code: 'already_decided', message: 'approval already decided' } }), { status: 409 });
  }});
  assert.equal((await api.loadProjection({ organizationId: 'org-demo' })).status, 'error');
  const result = await api.resolveApproval('approval-01', { decision: 'approved', reason: 'reviewed', idempotencyKey: 'idem-1' });
  assert.equal(result.ok, false);
  assert.equal(result.conflict.code, 'already_decided');
});

test('CommandApi scopes approval idempotency to the configured organization', async () => {
  const api = createCommandApi({ organizationId: 'org-tenant-1', baseUrl: 'http://command.test', token: 'secret', fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.organizationId, 'org-tenant-1');
    return new Response(JSON.stringify({ ok: true, organizationId: 'org-tenant-1', approvalId: 'approval-01', decision: request.decision, idempotencyKey: request.idempotencyKey }), { status: 200 });
  }});
  const result = await api.resolveApproval('approval-01', { decision: 'approved', idempotencyKey: 'idem-tenant-1' });
  assert.equal(result.ok, true);
  assert.equal(result.decision.organizationId, 'org-tenant-1');
});

test('FixtureApi has the same adapter surface and explicit empty state', async () => {
  const api = createFixtureApi({ projection: { ...projection, freshness: 'stale', areas: [], missions: [], agents: [], nodes: [], runs: [], approvals: [], artifacts: [] } });
  assert.equal((await api.loadProjection({})).status, 'stale');
  const result = await api.resolveApproval('approval-01', { decision: 'approved', idempotencyKey: 'idem-1' });
  assert.equal(result.ok, false);
  assert.equal(result.conflict.code, 'not_found');
});
