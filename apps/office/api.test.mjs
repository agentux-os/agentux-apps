import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandApi, createFixtureApi } from './api.js';

const projection = {
  organizationId: 'org-demo', schemaVersion: 'office-projection.v1', definitionVersion: 'definition-3',
  projectedAt: '2026-10-17T12:00:00Z', source: 'command-postgres', freshness: 'fresh', lastEventId: 'evt-107',
  organization: { id: 'org-demo', name: 'Acme Robotics' }, areas: [], missions: [], agents: [{ id: 'agent-01' }], nodes: [], runs: [], approvals: [], artifacts: [], events: []
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const answering = (status, body) => createCommandApi({ baseUrl: 'http://command.test', fetchImpl: async () => json(body, status) });

test('loads a ready projection, same-origin, with a token only when one is given', async () => {
  const api = createCommandApi({ baseUrl: 'http://command.test', token: 'secret', fetchImpl: async (url, options) => {
    assert.equal(url, 'http://command.test/v1/office/projection?organizationId=org-demo');
    assert.equal(options.headers.Authorization, 'Bearer secret');
    assert.equal(options.credentials, 'same-origin');
    return json(projection);
  }});
  const result = await api.loadProjection();
  assert.equal(result.status, 'ready');
  assert.equal(result.projection.lastEventId, 'evt-107');
  const proxied = createCommandApi({ fetchImpl: async (url, options) => {
    assert.equal(url, '/v1/office/projection?organizationId=org-demo');
    assert.equal(options.headers.Authorization, undefined);
    return json(projection);
  }});
  assert.equal((await proxied.loadProjection()).status, 'ready');
});

test('says what each failure means: loading states', async () => {
  for (const [status, body, expected] of [
    [401, { error: 'authentication required' }, 'denied'],
    [403, { error: 'organization.read capability required in org-demo' }, 'denied'],
    [404, { error: 'projection_not_found' }, 'empty'],
    [503, { error: 'projection_unavailable' }, 'unavailable'],
    [500, {}, 'error'],
    [200, { nonsense: true }, 'error']
  ]) {
    const result = await answering(status, body).loadProjection();
    assert.equal(result.status, expected, `${status}`);
    assert.equal(result.projection, null);
    assert.ok(result.error, `${status} explains itself`);
  }
  const offline = createCommandApi({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal((await offline.loadProjection()).status, 'unavailable');
  assert.equal((await answering(401, {}).loadProjection()).signIn, true, 'signed out: signing in helps');
  assert.equal((await answering(403, {}).loadProjection()).signIn, undefined, 'not allowed: signing in again does not');
  assert.equal((await answering(200, { ...projection, freshness: 'stale' }).loadProjection()).status, 'stale');
  assert.equal((await answering(200, { ...projection, freshness: 'degraded' }).loadProjection()).status, 'degraded');
  assert.equal((await answering(200, { ...projection, agents: [] }).loadProjection()).status, 'empty');
});

test('approval decisions: recorded, denied, conflicting, unavailable', async () => {
  const api = createCommandApi({ organizationId: 'org-tenant-1', baseUrl: 'http://command.test', fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(url, 'http://command.test/v1/approvals/approval-01/resolve');
    assert.equal(request.organizationId, 'org-tenant-1', 'scoped to the organization');
    return json({ ok: true, organizationId: 'org-tenant-1', approvalId: 'approval-01', decision: request.decision, idempotencyKey: request.idempotencyKey });
  }});
  const ok = await api.resolveApproval('approval-01', { decision: 'approved', idempotencyKey: 'idem-1' });
  assert.equal(ok.ok, true);
  assert.equal(ok.decision.decision, 'approved');
  for (const [status, body, code] of [
    [401, { error: 'authentication required' }, 'unauthenticated'],
    [403, { error: 'this gate is human-required' }, 'denied'],
    [409, { ok: false, conflict: { code: 'already_decided', message: 'approval already decided' } }, 'already_decided'],
    [409, { ok: false, conflict: { code: 'not_found', message: 'approval not found' } }, 'not_found'],
    [503, { error: 'approval_store_unavailable' }, 'unavailable'],
    [400, { error: 'invalid JSON' }, 'request_failed']
  ]) {
    const result = await answering(status, body).resolveApproval('approval-01', { decision: 'approved', idempotencyKey: 'k' });
    assert.equal(result.ok, false);
    assert.equal(result.conflict.code, code, `${status}`);
  }
  const denied = await answering(403, { error: 'this gate is human-required' }).resolveApproval('a', { decision: 'approved', idempotencyKey: 'k' });
  assert.match(denied.conflict.message, /human-required/);
  const offline = createCommandApi({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal((await offline.resolveApproval('a', { decision: 'approved', idempotencyKey: 'k' })).conflict.code, 'unavailable');
});

/** An EventSource that records its URL and lets the test fire events. */
class FakeEventSource {
  static last;
  constructor(url, options) { this.url = url; this.options = options; this.listeners = {}; this.closed = false; FakeEventSource.last = this; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  fire(type, data) { for (const listener of this.listeners[type] || []) listener({ data }); }
  close() { this.closed = true; }
}

test('follows the live stream from the projection’s last event', async () => {
  const api = createCommandApi({
    baseUrl: '', organizationId: 'acme', EventSourceImpl: FakeEventSource,
    fetchImpl: async (url) => {
      assert.equal(url, `/v1/organizations/acme/events?since=${encodeURIComponent(projection.projectedAt)}&limit=1000`);
      return json({ events: [{ cursor: 41, event: { eventId: 'evt-106' } }, { cursor: 42, event: { eventId: 'evt-107' } }], next: 42 });
    }
  });
  const events = []; const states = [];
  const stop = await api.follow(projection, { onEvent: (e) => events.push(e), onState: (s) => states.push(s) });
  const source = FakeEventSource.last;
  assert.equal(source.url, '/v1/organizations/acme/events/stream?after=42');
  assert.equal(source.options.withCredentials, true);
  source.fire('open');
  source.fire('office.event', JSON.stringify({ eventId: 'evt-108', eventType: 'run.started' }));
  source.fire('office.event', 'not json');
  source.fire('error');
  source.fire('unavailable', 'the event log is unavailable');
  assert.deepEqual(events.map((e) => e.eventId), ['evt-108']);
  assert.deepEqual(states, ['live', 'reconnecting', 'unavailable']);
  stop();
  assert.equal(source.closed, true);
});

test('the fixture API has the same surface and explicit states', async () => {
  const api = createFixtureApi({ projection: { ...projection, freshness: 'stale' } });
  assert.equal(api.mode, 'fixture');
  assert.equal((await api.loadProjection()).status, 'stale');
  const states = [];
  const stop = await api.follow(projection, { onState: (s) => states.push(s) });
  stop();
  assert.deepEqual(states, ['fixture']);
  const result = await api.resolveApproval('approval-01', { decision: 'approved', idempotencyKey: 'idem-1' });
  assert.equal(result.ok, false);
  assert.equal(result.conflict.code, 'not_found');
});
