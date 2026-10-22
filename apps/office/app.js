import { createCommandApi, createFixtureApi } from './api.js';
import { decisionMessage, matches, officeModel, stateMessage } from './model.js';

const $ = (id) => document.getElementById(id);
const filters = { area: 'all', mission: 'all', status: 'all' };
const config = globalThis.AGENTUX_OFFICE_CONFIG || {};

/** Demo data in the shape Command serves, for Office without a server. */
const now = Date.now();
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
const fixtureProjection = {
  organizationId: 'org-demo', schemaVersion: 'office-projection.v1', definitionVersion: 'definition-3', projectedAt: at(1), source: 'fixture', freshness: 'fresh', lastEventId: 'evt-107',
  organization: { id: 'org-demo', name: 'Acme Robotics' },
  areas: [{ id: 'engineering', name: 'Engineering' }, { id: 'operations', name: 'Operations' }, { id: 'finance', name: 'Finance' }],
  missions: [{ id: 'release', area_id: 'engineering', name: 'Ship release' }, { id: 'fulfillment', area_id: 'operations', name: 'Improve fulfillment' }, { id: 'close-month', area_id: 'finance', name: 'Close month' }],
  agents: [{ id: 'atlas', role_id: 'reviewer' }, { id: 'nova', role_id: 'analyst' }],
  nodes: [
    { id: 'sp-01', status: 'online', presence: 'online', connected: true, agentuxVersion: '0.6.5' },
    { id: 'sp-02', status: 'online', presence: 'offline', connected: false, agentuxVersion: '0.6.5' }
  ],
  runs: [
    { id: 'run-release', kind: 'mission', missionId: 'release', status: 'waiting', step: 'review' },
    { id: 'run-fulfillment', missionId: 'fulfillment', title: 'Warehouse API retries', status: 'failed', nodeId: 'sp-02', error: 'gate timed out' },
    { id: 'run-close', kind: 'mission', missionId: 'close-month', status: 'running', step: 'reconcile', nodeId: 'sp-01' }
  ],
  approvals: [{ id: 'approval-release', runId: 'run-release', gateId: 'release', title: 'Ship release: review', policy: 'human-required', status: 'pending' }],
  artifacts: [],
  events: [
    { eventId: 'evt-105', eventType: 'run.failed', occurredAt: at(9), runId: 'run-fulfillment', actor: { kind: 'node', id: 'sp-02' }, data: { error: 'gate timed out' } },
    { eventId: 'evt-106', eventType: 'mission.run.step_started', occurredAt: at(6), runId: 'run-close', actor: { kind: 'service', id: 'command.missions' }, data: { runId: 'run-close', missionId: 'close-month', step: 'reconcile', status: 'running' } },
    { eventId: 'evt-107', eventType: 'mission.run.gate_waiting', occurredAt: at(3), runId: 'run-release', actor: { kind: 'service', id: 'command.missions' }, data: { runId: 'run-release', missionId: 'release', step: 'review', status: 'waiting' } }
  ]
};

let api;
let model = officeModel(fixtureProjection);
let stopFollowing = () => {};
let reloadTimer = null;

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clock = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? '' : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
const ago = (iso) => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); return Number.isNaN(s) ? 'unknown' : s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

function apiForRuntime() {
  // Behind serve-office (COMMAND_URL) or on Command's own origin: same-origin calls.
  return config.command ? createCommandApi({ baseUrl: config.commandUrl || '', organizationId: config.organizationId || 'org-demo' }) : createFixtureApi({ projection: fixtureProjection });
}

function showState(status, error) {
  const message = stateMessage(status, error);
  const banner = $('state-banner');
  banner.hidden = !message;
  if (message) { banner.className = `state-banner ${message.tone}`; banner.textContent = message.text; }
}

function setConnection(text) { $('connection-status').textContent = text; }

function fillSelect(id, values, label) {
  const select = $(id);
  const current = select.value;
  select.innerHTML = `<option value="all">${label}</option>` + values.map((v) => `<option>${escape(v)}</option>`).join('');
  select.value = values.includes(current) ? current : 'all';
}

function render() {
  $('organization-name').textContent = model.organization;
  $('projection-meta').textContent = `${api.mode === 'fixture' ? 'Demo data' : 'From AgentUX Command'} · ${model.definitionVersion} · updated ${ago(model.projectedAt)}`;
  fillSelect('area-filter', model.filters.areas, 'All areas');
  fillSelect('mission-filter', model.filters.missions, 'All missions');
  const desks = model.desks.filter((desk) => matches(desk, filters));
  $('office-grid').innerHTML = desks.length
    ? desks.map((desk) => `<article class="desk ${escape(desk.status)}"><div class="desk-icon">${escape(desk.kind.slice(0, 1))}</div><div><strong>${escape(desk.name)}</strong><span>${escape(desk.kind)}${desk.detail ? ` · ${escape(desk.detail)}` : ''}</span><small>${escape([desk.area, desk.mission].filter(Boolean).join(' · ') || 'Organization')}</small></div><b>${escape(desk.status)}</b></article>`).join('')
    : `<p class="empty">${model.desks.length ? 'Nothing matches these filters.' : 'No nodes, agents or runs yet.'}</p>`;
  $('metric-active').textContent = model.metrics.active;
  $('metric-blocked').textContent = model.metrics.blocked;
  $('metric-approvals').textContent = model.metrics.approvals;
  $('metric-nodes').textContent = model.metrics.healthyNodes;
  const timeline = model.timeline.filter((event) => matches(event, filters));
  $('event-list').innerHTML = timeline.map((event) => `<li class="event-item ${escape(event.status)}"><span class="event-time">${escape(clock(event.time))}</span><div><strong>${escape(event.title)}</strong><small>${escape(event.actor)} · ${escape([event.area, event.mission].filter(Boolean).join(' · ') || 'Organization')}</small></div></li>`).join('') || '<li class="empty">No events match these filters.</li>';
  $('approval-list').innerHTML = model.approvals.length
    ? model.approvals.map((a) => `<article class="approval-card${a.expired ? ' expired' : ''}"><div><strong>${escape(a.title)}</strong><small data-outcome="${escape(a.id)}">${escape(a.detail || 'Run')} · ${a.expired ? 'expired' : `expires ${escape(a.expiresAt ? clock(a.expiresAt) : 'not specified')}`}</small></div><div class="approval-actions"><button data-approval="${escape(a.id)}" data-decision="approved" ${a.expired ? 'disabled' : ''}>Approve</button><button data-approval="${escape(a.id)}" data-decision="rejected" ${a.expired ? 'disabled' : ''}>Reject</button></div></article>`).join('')
    : '<p class="empty">No pending approvals.</p>';
  for (const button of document.querySelectorAll('[data-approval]')) button.addEventListener('click', () => decide(button));
}

async function decide(button) {
  const id = button.dataset.approval;
  for (const b of document.querySelectorAll(`[data-approval="${CSS.escape(id)}"]`)) b.disabled = true;
  const result = await api.resolveApproval(id, { decision: button.dataset.decision, idempotencyKey: `office-${id}-${button.dataset.decision}` });
  const outcome = document.querySelector(`[data-outcome="${CSS.escape(id)}"]`);
  if (outcome) outcome.textContent = decisionMessage(result);
  // Retryable failures leave the buttons usable.
  if (!result.ok && ['unavailable', 'request_failed'].includes(result.conflict?.code)) {
    for (const b of document.querySelectorAll(`[data-approval="${CSS.escape(id)}"]`)) b.disabled = false;
  }
  if (result.ok) scheduleReload(500);
}

async function load() {
  const result = await api.loadProjection();
  if (result.projection) {
    model = officeModel(result.projection);
    render();
  }
  showState(result.status === 'ready' ? null : result.status, result.error);
  return result;
}

function scheduleReload(delay = 300) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(load, delay);
}

async function boot() {
  api = apiForRuntime();
  for (const [key, id] of Object.entries({ area: 'area-filter', mission: 'mission-filter', status: 'status-filter' })) $(id).addEventListener('change', (event) => { filters[key] = event.target.value; render(); });
  $('clear-filters').addEventListener('click', () => { for (const key of Object.keys(filters)) filters[key] = 'all'; for (const id of ['area-filter', 'mission-filter', 'status-filter']) $(id).value = 'all'; render(); });
  showState('loading');
  setConnection(api.mode === 'fixture' ? 'demo data' : 'connecting');
  let result = await load();
  // Until Command answers: try again, and keep saying why.
  while (!result.projection && ['unavailable', 'error'].includes(result.status)) {
    setConnection('Command unavailable · retrying');
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    result = await load();
  }
  if (!result.projection) { setConnection('not signed in'); return; }
  stopFollowing = await api.follow(result.projection, {
    onEvent: () => scheduleReload(),
    onState: (state) => {
      setConnection({ live: `live · ${model.freshness}`, reconnecting: 'reconnecting…', unavailable: 'event log unavailable', fixture: 'demo data' }[state] || state);
      if (state === 'live') scheduleReload(0);
    }
  });
}

addEventListener('pagehide', () => stopFollowing());
boot();
