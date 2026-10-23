import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandApi } from './api.js';
import { correlated, detailOf, href, parseRoute, relatedTo } from './detail.js';

const projection = {
  organizationId: 'acme', freshness: 'fresh',
  areas: [{ id: 'engineering', name: 'Engineering', owner_role_id: 'cto' }],
  missions: [{ id: 'ship', area_id: 'engineering', name: 'Ship a release' }, { id: 'idle', area_id: 'engineering', name: 'Nothing yet' }],
  agents: [{ id: 'dev-1', role_id: 'dev' }],
  nodes: [{ id: 'node-a', presence: 'online', status: 'online', connected: true, agentuxVersion: '0.6.5' }, { id: 'node-b', presence: 'offline' }],
  runs: [
    { id: 'run-1', kind: 'mission', missionId: 'ship', status: 'waiting', step: 'review', definitionVersion: 'definition-2' },
    { id: 'nr-9', title: 'Fix the build', status: 'completed', nodeId: 'node-a', costUsd: 0.4 }
  ],
  approvals: [{ id: 'run-1-review-1', runId: 'run-1', title: 'Ship a release: review', status: 'pending', gateId: 'release', policy: 'human-required' }],
  artifacts: [{ id: 'a1', runId: 'nr-9', name: 'report.md' }],
  events: [
    { eventId: 'e1', eventType: 'mission.run.started', runId: 'run-1', correlationId: 'run-1', actor: { kind: 'user', id: 'oidc:ana' }, data: { runId: 'run-1', missionId: 'ship' } },
    { eventId: 'e2', eventType: 'approval.requested', runId: 'run-1', correlationId: 'run-1', data: { id: 'run-1-review-1' } },
    { eventId: 'e3', eventType: 'run.completed', nodeId: 'node-a', runId: 'nr-9', actor: { kind: 'node', id: 'node-a' } },
    { eventId: 'e4', eventType: 'audit.exported', causationId: 'e3', correlationId: 'x' }
  ]
};

test('deep links name an entity, and only known kinds', () => {
  assert.deepEqual(parseRoute('#/run/run-1'), { kind: 'run', id: 'run-1' });
  assert.deepEqual(parseRoute(href('event', 'evt/107 ü')), { kind: 'event', id: 'evt/107 ü'});
  for (const bad of ['', '#', '#/', '#/secrets/x', '#/run/', '#/run/%E0%A4%A']) assert.equal(parseRoute(bad), null, bad);
});

test('a populated drill-down: what the projection knows, and nothing made up', () => {
  const run = detailOf(projection, 'run', 'run-1');
  assert.equal(run.title, 'Ship a release');
  assert.deepEqual(run.fields.slice(0, 4), [['Status', 'waiting'], ['Kind', 'mission run'], ['Step', 'review'], ['Definition', 'definition-2']]);
  assert.ok(!run.fields.some(([k]) => k === 'Cost (USD)'), 'no cost was reported: none is shown');
  assert.deepEqual(run.links.map((l) => [l.kind, l.id]), [['mission', 'ship'], ['approval', 'run-1-review-1']]);
  assert.ok(run.notes.includes('No artifacts recorded for this run.'), 'a missing artifact is said, not hidden');
  const nodeRun = detailOf(projection, 'run', 'nr-9');
  assert.ok(nodeRun.fields.some(([k, v]) => k === 'Artifact' && v === 'report.md'));
  assert.deepEqual(nodeRun.links.map((l) => l.kind), ['node']);
  assert.deepEqual(detailOf(projection, 'area', 'engineering').links.map((l) => l.id), ['ship', 'idle']);
  assert.ok(detailOf(projection, 'mission', 'idle').notes.includes('No runs of this mission yet.'));
  assert.match(detailOf(projection, 'node', 'node-b').notes[0], /offline/);
  const approval = detailOf(projection, 'approval', 'run-1-review-1');
  assert.deepEqual(approval.links, [{ kind: 'run', id: 'run-1', label: 'run-1' }]);
  const event = detailOf(projection, 'event', 'e3');
  assert.deepEqual(event.links.map((l) => l.kind), ['run', 'node']);
});

test('missing, empty, stale and degraded are said plainly', () => {
  const missing = detailOf(projection, 'run', 'gone');
  assert.equal(missing.found, false);
  assert.match(missing.notes[0], /no run gone/);
  assert.match(detailOf(projection, 'event', 'old').notes[0], /older than the latest/);
  const empty = detailOf({ organizationId: 'acme', freshness: 'fresh' }, 'node', 'node-a');
  assert.equal(empty.found, false);
  for (const freshness of ['stale', 'degraded']) {
    const d = detailOf({ ...projection, freshness }, 'run', 'run-1');
    assert.ok(d.notes.some((n) => n.includes(`is ${freshness}`)), freshness);
  }
});

test('events belong to what they are about; chains follow correlation', () => {
  const ids = (kind, id) => projection.events.filter((e) => relatedTo(e, kind, id, projection)).map((e) => e.eventId);
  assert.deepEqual(ids('run', 'run-1'), ['e1', 'e2']);
  assert.deepEqual(ids('mission', 'ship'), ['e1', 'e2']);
  assert.deepEqual(ids('area', 'engineering'), ['e1', 'e2']);
  assert.deepEqual(ids('node', 'node-a'), ['e3']);
  assert.deepEqual(ids('agent', 'oidc:ana'), ['e1']);
  assert.deepEqual(ids('approval', 'run-1-review-1'), ['e2']);
  assert.deepEqual(correlated(projection.events, projection.events[0]).map((e) => e.eventId), ['e2']);
  assert.deepEqual(correlated(projection.events, projection.events[2]).map((e) => e.eventId), ['e4'], 'caused by it');
  assert.deepEqual(correlated(projection.events, undefined), []);
});

test('the log is read page by page, at most 5,000 events', async () => {
  const urls = [];
  const page = (n, next) => new Response(JSON.stringify({ events: Array.from({ length: n }, (_, i) => ({ cursor: next - n + i + 1, event: { eventId: `e${next - n + i + 1}` } })), next }), { status: 200 });
  const api = createCommandApi({ organizationId: 'acme', fetchImpl: async (url) => { urls.push(url); return urls.length === 1 ? page(1000, 1000) : page(3, 1003); } });
  const result = await api.events({ days: 7 });
  assert.deepEqual([result.ok, result.events.length, result.truncated], [true, 1003, false]);
  assert.match(urls[0], /^\/v1\/organizations\/acme\/events\?since=.+&after=0&limit=1000$/);
  assert.match(urls[1], /after=1000/);
  const many = createCommandApi({ organizationId: 'acme', fetchImpl: async () => page(1000, 1000) });
  assert.equal((await many.events()).truncated, true);
  const denied = createCommandApi({ organizationId: 'acme', fetchImpl: async () => new Response('{"error":"organization.read capability required"}', { status: 403 }) });
  assert.deepEqual([(await denied.events()).ok, (await denied.events()).status], [false, 'denied']);
});
