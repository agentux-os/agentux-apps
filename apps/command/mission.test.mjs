import assert from 'node:assert/strict';
import { createMissionApi, activityForEvent, orderedActivity, runConnectionState, canDecideApproval, canCancelRun, replayRunActivity } from './mission.js';

const event = (eventId, cursor, eventType = 'mission.run.step_started') => ({
  cursor,
  event: { eventId, eventType, runId: 'run-1', occurredAt: '2026-11-04T10:00:00Z', nodeId: 'node-a', data: { step: 'build' } }
});

assert.deepEqual(orderedActivity([event('e2', 2), event('e1', 1), event('e2', 2)]).map((item) => item.event.eventId), ['e1', 'e2']);
assert.equal(activityForEvent({ eventType: 'mission.run.gate_waiting' }).title, 'Approval requested');
assert.equal(activityForEvent({ eventType: 'mission.run.step_failed' }).tone, 'error');
assert.equal(activityForEvent({ eventType: 'future.typed.tool' }).title, 'Future typed tool');
assert.equal(runConnectionState({ connected: true, freshness: 'fresh' }), 'live');
assert.equal(runConnectionState({ connected: true, freshness: 'stale' }), 'stale');
assert.equal(runConnectionState({ connected: false, freshness: 'fresh' }), 'offline');
assert.equal(runConnectionState({ connected: true, freshness: 'fresh' }), 'live', 'recovered nodes report live again');
assert.equal(canDecideApproval({ acme: ['approval.decide'] }, 'acme', 'fresh'), true);
assert.equal(canDecideApproval({ acme: ['approval.decide'] }, 'acme', 'stale'), false);
assert.equal(canDecideApproval({ other: ['approval.decide'] }, 'acme', 'fresh'), false);
assert.equal(canCancelRun({ acme: ['node.command'] }, 'acme', 'running', 'fresh'), true);
assert.equal(canCancelRun({ acme: ['node.command'] }, 'acme', 'running', 'stale'), false);
assert.equal(canCancelRun({ acme: ['node.command'] }, 'acme', 'completed', 'fresh'), false);
assert.equal(canCancelRun({ other: ['node.command'] }, 'acme', 'running', 'fresh'), false);

const replayCalls = [];
const replayPages = [
  { events: Array.from({ length: 1000 }, (_, i) => event(`p1-${i}`, i + 1)), next: 1000 },
  { events: Array.from({ length: 1000 }, (_, i) => event(`p2-${i}`, i + 1001)), next: 2000 },
  { events: [event('p3-1', 2001)], next: 2001 }
];
const replayed = await replayRunActivity({ replay: async (_org, after) => { replayCalls.push(after); return replayPages[replayCalls.length - 1]; } }, 'acme', { createdAt: '2026-11-04T09:00:00Z' });
assert.deepEqual(replayCalls, [0, 1000, 2000]);
assert.equal(replayed.events.length, 2001);
assert.equal(replayed.cursor, 2001);
assert.equal(replayed.truncated, false);

const calls = [];
const fetchImpl = async (url, options = {}) => {
  calls.push({ url, options });
  const body = url.includes('/events?') ? { events: [event('e1', 8)], next: 8 } : { runs: [{ runId: 'run-1' }] };
  return { ok: true, status: 200, json: async () => body };
};
class FakeEventSource {
  static instance;
  constructor(url, options) { this.url = url; this.options = options; this.listeners = {}; FakeEventSource.instance = this; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  close() { this.closed = true; }
}
const api = createMissionApi({ fetchImpl, EventSourceImpl: FakeEventSource });
assert.deepEqual(await api.runs('acme'), [{ runId: 'run-1' }]);
assert.deepEqual(await api.replay('acme', 4), { events: [event('e1', 8)], next: 8 });
let state;
let streamed;
const close = await api.follow('acme', 8, { onState: (value) => { state = value; }, onEvent: (value) => { streamed = value; } });
assert.match(FakeEventSource.instance.url, /after=8/);
FakeEventSource.instance.listeners.open();
FakeEventSource.instance.listeners['office.event']({ data: JSON.stringify({ eventId: 'e2', eventType: 'mission.run.completed' }), lastEventId: '9' });
assert.equal(state, 'live');
assert.equal(streamed.cursor, 9);
close();
assert.equal(FakeEventSource.instance.closed, true);

await api.resolveApproval('acme', 'approval-1', 'approved', 'reviewed', 'stable-key');
const decision = calls.at(-1);
assert.equal(decision.url, '/v1/approvals/approval-1/resolve');
assert.equal(decision.options.credentials, 'same-origin');
assert.deepEqual(JSON.parse(decision.options.body), { organizationId: 'acme', decision: 'approved', reason: 'reviewed', idempotencyKey: 'stable-key' });
await api.resolveApproval('acme', 'approval-1', 'denied', '', 'deny-key');
assert.equal(JSON.parse(calls.at(-1).options.body).decision, 'rejected', 'Command accepts rejected, not denied, as the approval decision');
await api.cancel('acme', 'run-1');
assert.equal(calls.at(-1).url, '/v1/organizations/acme/runs/run-1/cancel');
assert.equal(calls.at(-1).options.method, 'POST');

console.log('validated mission activity ordering, stream cursor, approvals, and connectivity');
