import assert from 'node:assert/strict';
import test from 'node:test';
import { decisionMessage, humanize, matches, officeModel, runStatus, stateMessage } from './model.js';

/** A projection as AgentUX Command serves it (node events, a mission run, a gate). */
const populated = {
  organizationId: 'acme', schemaVersion: 'office-projection.v1', definitionVersion: 'definition-2',
  projectedAt: '2026-10-22T12:00:00Z', source: 'command-postgres', freshness: 'degraded', lastEventId: 'e4',
  organization: { id: 'acme', name: 'Acme Robotics' },
  areas: [{ id: 'engineering', name: 'Engineering' }],
  missions: [{ id: 'ship', area_id: 'engineering', name: 'Ship a release' }],
  agents: [{ id: 'dev-1', role_id: 'dev' }],
  nodes: [
    { id: 'node-a', status: 'online', presence: 'online', connected: true, agentuxVersion: '0.6.5' },
    { id: 'node-b', status: 'online', presence: 'offline', connected: false }
  ],
  runs: [
    { id: 'run-1', kind: 'mission', missionId: 'ship', status: 'waiting', step: 'review' },
    { id: 'node-run-9', title: 'Fix the build', status: 'running', nodeId: 'node-a' },
    { id: 'node-run-8', title: 'Old', status: 'failed', nodeId: 'node-b', error: 'tests failed' }
  ],
  approvals: [
    { id: 'run-1-review-1', runId: 'run-1', gateId: 'release', title: 'Ship a release: review', policy: 'human-required', status: 'pending' },
    { id: 'old', runId: 'run-0', status: 'pending', action: 'push', expiresAt: '2000-01-01T00:00:00Z' },
    { id: 'done', status: 'approved' }
  ],
  artifacts: [],
  events: [
    { eventId: 'e1', eventType: 'run.started', occurredAt: '2026-10-22T11:50:00Z', runId: 'node-run-9', actor: { kind: 'node', id: 'node-a' }, data: { title: 'Fix the build', state: 'running' } },
    { eventId: 'e4', eventType: 'mission.run.gate_waiting', occurredAt: '2026-10-22T11:59:00Z', runId: 'run-1', actor: { kind: 'service', id: 'command.missions' }, data: { runId: 'run-1', missionId: 'ship', step: 'review', status: 'waiting' } }
  ]
};

test('a populated projection: floor, metrics, timeline and approvals', () => {
  const model = officeModel(populated);
  assert.equal(model.organization, 'Acme Robotics');
  assert.equal(model.desks.length, 2 + 1 + 3, 'nodes, agents and runs');
  const desk = (id) => model.desks.find((d) => d.id === id);
  assert.equal(desk('node:node-a').status, 'active');
  assert.equal(desk('node:node-b').status, 'blocked', 'offline');
  assert.equal(desk('run:run-1').name, 'Ship a release');
  assert.equal(desk('run:run-1').kind, 'Mission run');
  assert.deepEqual([desk('run:run-1').area, desk('run:run-1').mission], ['Engineering', 'Ship a release']);
  assert.equal(desk('run:node-run-8').status, 'blocked');
  assert.deepEqual(model.metrics, { active: 1, blocked: 2, approvals: 1, healthyNodes: '1/2' });
  assert.deepEqual(model.filters, { areas: ['Engineering'], missions: ['Ship a release'] });

  assert.equal(model.timeline[0].id, 'e4', 'newest first');
  assert.equal(model.timeline[0].title, 'Mission run gate waiting: review');
  assert.equal(model.timeline[0].mission, 'Ship a release');
  assert.equal(model.timeline[1].actor, 'node-a · node');

  assert.deepEqual(model.approvals.map((a) => [a.id, a.expired]), [['run-1-review-1', false], ['old', true]]);
  assert.match(model.approvals[0].detail, /human-required/);
});

test('an empty projection shows nothing, without failing', () => {
  const model = officeModel({ ...populated, freshness: 'fresh', organization: {}, areas: [], missions: [], agents: [], nodes: [], runs: [], approvals: [], events: [] });
  assert.equal(model.organization, 'acme', 'the id when there is no name yet');
  assert.deepEqual(model.desks, []);
  assert.deepEqual(model.timeline, []);
  assert.deepEqual(model.metrics, { active: 0, blocked: 0, approvals: 0, healthyNodes: '0/0' });
});

test('filters by area, mission and status', () => {
  const model = officeModel(populated);
  const visible = (filters) => model.desks.filter((d) => matches(d, { area: 'all', mission: 'all', status: 'all', ...filters })).map((d) => d.id);
  assert.deepEqual(visible({ mission: 'Ship a release' }), ['run:run-1']);
  assert.deepEqual(visible({ status: 'blocked' }), ['node:node-b', 'run:node-run-8']);
  assert.equal(visible({}).length, 6);
});

test('states and outcomes read as sentences', () => {
  assert.equal(stateMessage('ready'), null);
  for (const status of ['loading', 'empty', 'stale', 'degraded', 'denied', 'unavailable', 'error']) assert.ok(stateMessage(status)?.text, status);
  assert.equal(stateMessage('stale').tone, 'warning');
  assert.equal(stateMessage('denied', 'organization.read capability required').text, 'organization.read capability required');
  assert.equal(decisionMessage({ ok: true, decision: { decision: 'approved' } }), 'Decision recorded: approved');
  assert.match(decisionMessage({ ok: false, conflict: { code: 'denied', message: 'this gate is human-required' } }), /Not allowed: this gate is human-required/);
  assert.equal(decisionMessage({ ok: false, conflict: { code: 'already_decided' } }), 'Someone already decided this approval.');
  assert.equal(runStatus('completed'), 'complete');
  assert.equal(humanize('run.updated'), 'Run updated');
});
