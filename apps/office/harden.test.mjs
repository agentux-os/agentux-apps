import assert from 'node:assert/strict';
import test from 'node:test';
import { keys, pickLocale, setLocale, t } from './i18n.js';
import { DESK_LIMIT, decisionMessage, matches, officeModel, retryDelay, stateMessage } from './model.js';

test('both languages say everything, and the locale follows the browser', () => {
  assert.deepEqual(keys('pt-BR').sort(), keys('en').sort(), 'no message missing in Portuguese');
  assert.equal(pickLocale('pt-BR'), 'pt-BR');
  assert.equal(pickLocale('pt'), 'pt-BR');
  assert.equal(pickLocale('en-GB'), 'en');
  assert.equal(pickLocale(undefined), 'en');
  try {
    setLocale('pt-BR');
    assert.equal(stateMessage('stale').text.startsWith('Desatualizado'), true);
    assert.equal(decisionMessage({ ok: false, conflict: { code: 'already_decided' } }), 'Alguém já decidiu esta aprovação.');
    assert.equal(t('floor.more', { shown: 300, total: 5000 }), 'Mostrando 300 de 5000. Filtre por área, missão ou status para ver o resto.');
  } finally {
    setLocale('en');
  }
  assert.equal(t('time.minutes', { n: 3 }), '3 min ago');
  assert.equal(t('no.such.key'), 'no.such.key');
});

test('retries back off from 2 s to a minute, spread so Offices do not retry together', () => {
  const steady = () => 0.5;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map((n) => retryDelay(n, steady)), [2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  assert.equal(retryDelay(0, () => 0), 1600);
  assert.equal(retryDelay(0, () => 0.999999), 2400);
  assert.ok(retryDelay(-3, steady) >= 2000);
});

test('errors interrupt; the rest are polite', () => {
  assert.equal(stateMessage('unavailable').tone, 'error');
  assert.equal(stateMessage('degraded').tone, 'warning');
  assert.equal(stateMessage('unavailable', 'Command is unreachable: fetch failed').text, 'Command is unreachable: fetch failed', 'Command’s reason first');
});

/** An organization with `n` runs and `n / 5` nodes, and a full timeline. */
function large(n) {
  return {
    organizationId: 'big', freshness: 'fresh', definitionVersion: 'definition-9', projectedAt: new Date().toISOString(),
    organization: { id: 'big', name: 'Big Co' },
    areas: Array.from({ length: 20 }, (_, i) => ({ id: `area-${i}`, name: `Area ${i}` })),
    missions: Array.from({ length: 200 }, (_, i) => ({ id: `m-${i}`, area_id: `area-${i % 20}`, name: `Mission ${i}` })),
    agents: Array.from({ length: 500 }, (_, i) => ({ id: `agent-${i}`, role_id: 'dev' })),
    nodes: Array.from({ length: n / 5 }, (_, i) => ({ id: `node-${i}`, presence: i % 10 ? 'online' : 'offline' })),
    runs: Array.from({ length: n }, (_, i) => ({ id: `run-${i}`, missionId: `m-${i % 200}`, status: ['running', 'waiting', 'failed', 'completed'][i % 4] })),
    approvals: Array.from({ length: 300 }, (_, i) => ({ id: `ap-${i}`, runId: `run-${i}`, status: 'pending' })),
    artifacts: [],
    events: Array.from({ length: 100 }, (_, i) => ({ eventId: `e-${i}`, eventType: 'run.updated', runId: `run-${i}`, occurredAt: new Date().toISOString(), data: { state: 'running' } }))
  };
}

test('a large organization stays within budget', () => {
  const projection = large(10_000);
  let started = performance.now();
  const model = officeModel(projection);
  const modelMs = performance.now() - started;
  assert.equal(model.desks.length, 10_000 + 2_000 + 500);
  started = performance.now();
  const visible = model.desks.filter((d) => matches(d, { area: 'Area 3', mission: 'all', status: 'complete' }));
  const filterMs = performance.now() - started;
  assert.ok(visible.length > 0 && visible.length < model.desks.length);
  assert.ok(modelMs < 1000, `the model took ${modelMs.toFixed(0)} ms for 12,500 desks`);
  assert.ok(filterMs < 100, `filtering took ${filterMs.toFixed(0)} ms`);
  assert.equal(DESK_LIMIT, 300, 'the floor draws at most 300 desks at once');
  assert.deepEqual(model.metrics.healthyNodes, '1800/2000');
});
