import { createCommandApi, createFixtureApi } from './api.js';
import { DESK_LIMIT, decisionMessage, matches, officeModel, retryDelay, stateMessage } from './model.js';
import { setLocale, t, translatePage } from './i18n.js';
import { correlated, detailOf, href, parseRoute, relatedTo } from './detail.js';

const $ = (id) => document.getElementById(id);
const filters = { area: 'all', mission: 'all', status: 'all' };
const config = globalThis.AGENTUX_OFFICE_CONFIG || {};
setLocale(config.locale || navigator.language);

/**
 * What this page measured, for whoever looks (`agentuxOffice.metrics` in the
 * console, or a test). Nothing leaves the browser.
 */
const metrics = { loads: 0, loadFailures: 0, lastLoadMs: 0, renders: 0, lastRenderMs: 0, reconnects: 0, decisions: 0, decisionFailures: 0 };
globalThis.agentuxOffice = { metrics };

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
let projection = fixtureProjection;
let model = officeModel(fixtureProjection);
let stopFollowing = () => {};
let reloadTimer = null;

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clock = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? '' : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
const ago = (iso) => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); return Number.isNaN(s) ? '?' : s < 60 ? t('time.now') : s < 3600 ? t('time.minutes', { n: Math.round(s / 60) }) : t('time.hours', { n: Math.round(s / 3600) }); };

function apiForRuntime() {
  // Behind serve-office (COMMAND_URL) or on Command's own origin: same-origin calls.
  return config.command ? createCommandApi({ baseUrl: config.commandUrl || '', organizationId: config.organizationId || 'org-demo' }) : createFixtureApi({ projection: fixtureProjection });
}

function showState(status, error) {
  const message = stateMessage(status, error);
  const banner = $('state-banner');
  banner.hidden = !message;
  if (message) {
    banner.className = `state-banner ${message.tone}`;
    // Errors interrupt a screen reader; the rest wait their turn.
    banner.setAttribute('role', message.tone === 'error' ? 'alert' : 'status');
    banner.textContent = message.text;
  }
}

function setConnection(text) { $('connection-status').textContent = text; }

function fillSelect(id, values, label) {
  const select = $(id);
  const current = select.value;
  select.innerHTML = `<option value="all">${escape(t(label))}</option>` + values.map((v) => `<option>${escape(v)}</option>`).join('');
  select.value = values.includes(current) ? current : 'all';
}

function render() {
  const started = performance.now();
  $('organization-name').textContent = model.organization;
  $('projection-meta').textContent = t('meta', { source: t(api.mode === 'fixture' ? 'meta.demo' : 'meta.command'), definition: model.definitionVersion, ago: ago(model.projectedAt) });
  fillSelect('area-filter', model.filters.areas, 'label.allAreas');
  fillSelect('mission-filter', model.filters.missions, 'label.allMissions');
  const matching = model.desks.filter((desk) => matches(desk, filters));
  // A large organization draws its first desks; filters reach the rest.
  const desks = matching.slice(0, DESK_LIMIT);
  $('floor-more').hidden = matching.length <= DESK_LIMIT;
  $('floor-more').textContent = t('floor.more', { shown: desks.length, total: matching.length });
  $('office-grid').innerHTML = desks.length
    ? desks.map((desk) => { const [kind, ...rest] = desk.id.split(':'); return `<a class="desk ${escape(desk.status)}" href="${escape(href(kind, rest.join(':')))}"><div class="desk-icon" aria-hidden="true">${escape(desk.kind.slice(0, 1))}</div><div><strong>${escape(desk.name)}</strong><span>${escape(desk.kind)}${desk.detail ? ` · ${escape(desk.detail)}` : ''}</span><small>${escape([desk.area, desk.mission].filter(Boolean).join(' · ') || 'Organization')}</small></div><b>${escape(desk.status)}</b></a>`; }).join('')
    : `<p class="empty">${escape(t(model.desks.length ? 'floor.filtered' : 'floor.none'))}</p>`;
  $('metric-active').textContent = model.metrics.active;
  $('metric-blocked').textContent = model.metrics.blocked;
  $('metric-approvals').textContent = model.metrics.approvals;
  $('metric-nodes').textContent = model.metrics.healthyNodes;
  const timeline = model.timeline.filter((event) => matches(event, filters));
  $('event-list').innerHTML = timeline.map((event) => `<li class="event-item ${escape(event.status)}"><span class="event-time">${escape(clock(event.time))}</span><div><strong><a href="${escape(href('event', event.id))}">${escape(event.title)}</a></strong><small>${escape(event.actor)} · ${escape([event.area, event.mission].filter(Boolean).join(' · ') || 'Organization')}</small></div></li>`).join('') || `<li class="empty">${escape(t('events.none'))}</li>`;
  $('approval-list').innerHTML = model.approvals.length
    ? model.approvals.map((a) => `<article class="approval-card${a.expired ? ' expired' : ''}"><div><strong><a href="${escape(href('approval', a.id))}">${escape(a.title)}</a></strong><small data-outcome="${escape(a.id)}">${escape(a.detail || 'Run')} · ${escape(a.expired ? t('approvals.expired') : t('approvals.expires', { when: a.expiresAt ? clock(a.expiresAt) : t('approvals.unspecified') }))}</small></div><div class="approval-actions" role="group" aria-label="${escape(a.title)}"><button type="button" data-approval="${escape(a.id)}" data-decision="approved" ${a.expired || deciding.has(a.id) ? 'disabled' : ''}>${escape(t('approve'))}</button><button type="button" data-approval="${escape(a.id)}" data-decision="rejected" ${a.expired || deciding.has(a.id) ? 'disabled' : ''}>${escape(t('reject'))}</button></div></article>`).join('')
    : `<p class="empty">${escape(t('approvals.none'))}</p>`;
  for (const button of document.querySelectorAll('[data-approval]')) button.addEventListener('click', () => decide(button));
  metrics.renders += 1;
  metrics.lastRenderMs = Math.round(performance.now() - started);
}

/** Approvals with a decision on its way: one at a time, never resent by itself. */
const deciding = new Set();

async function decide(button) {
  const id = button.dataset.approval;
  if (deciding.has(id)) return;
  deciding.add(id);
  for (const b of document.querySelectorAll(`[data-approval="${CSS.escape(id)}"]`)) b.disabled = true;
  const pending = document.querySelector(`[data-outcome="${CSS.escape(id)}"]`);
  if (pending) pending.textContent = t('decision.pending');
  // The same key for the same decision: a retry by hand is replayed by Command, not decided twice.
  const result = await api.resolveApproval(id, { decision: button.dataset.decision, idempotencyKey: `office-${id}-${button.dataset.decision}` });
  deciding.delete(id);
  metrics.decisions += 1;
  if (!result.ok) metrics.decisionFailures += 1;
  const outcome = document.querySelector(`[data-outcome="${CSS.escape(id)}"]`);
  if (outcome) outcome.textContent = decisionMessage(result);
  // Retryable failures leave the buttons usable.
  if (!result.ok && ['unavailable', 'request_failed'].includes(result.conflict?.code)) {
    for (const b of document.querySelectorAll(`[data-approval="${CSS.escape(id)}"]`)) b.disabled = false;
  }
  if (result.ok) scheduleReload(500);
}

const clockLong = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? '' : new Date(t).toLocaleString(); };
const eventRow = (e) => `<li><a href="${escape(href('event', e.eventId))}">${escape(e.eventType)}</a> <small>${escape(clockLong(e.occurredAt || e.receivedAt))}${e.actor ? ` · ${escape(e.actor.id)}` : ''}</small></li>`;
let detailRequest = 0;

/** Shows the entity the address names (`#/run/<id>`), or hides the panel. */
async function showDetail(focus = true) {
  const route = parseRoute(location.hash);
  const panel = $('detail');
  if (!route) { panel.hidden = true; return; }
  const detail = detailOf(projection, route.kind, route.id);
  panel.hidden = false;
  panel.innerHTML = `<div class="panel-heading"><div><p class="eyebrow">${escape(route.kind.toUpperCase())}</p><h2 id="detail-title">${escape(detail.title)}</h2></div><button type="button" id="detail-close" aria-label="Close the detail">Close</button></div>
    ${detail.notes.map((n) => `<p class="detail-note" role="note">${escape(n)}</p>`).join('')}
    ${detail.fields.length ? `<dl class="detail-fields">${detail.fields.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>` : ''}
    ${detail.links.length ? `<h3>Related</h3><ul class="plain">${detail.links.map((l) => `<li><a href="${escape(href(l.kind, l.id))}">${escape(l.kind)} · ${escape(l.label)}</a></li>`).join('')}</ul>` : ''}
    <h3>Events</h3><ul class="plain" id="detail-events" aria-live="polite"><li class="subtle">Loading the organization's log…</li></ul>`;
  $('detail-close').addEventListener('click', closeDetail);
  if (focus) panel.focus();
  const request = ++detailRequest;
  const log = await api.events({ days: 7 });
  if (request !== detailRequest) return;
  const list = $('detail-events');
  if (!log.ok) { list.innerHTML = `<li class="detail-note">The event log is unavailable: ${escape(log.error || 'try again')}.</li>`; return; }
  const own = log.events.filter((e) => relatedTo(e, route.kind, route.id, projection));
  const event = route.kind === 'event' ? own[0] || (projection.events || []).find((e) => e.eventId === route.id) : null;
  const chain = event ? correlated(log.events, event) : [];
  const shown = route.kind === 'event' ? chain : own;
  list.innerHTML = shown.length
    ? [...shown].reverse().slice(0, 200).map(eventRow).join('')
    : `<li class="subtle">${route.kind === 'event' ? 'No other event in this chain' : 'No events'} in the last 7 days${log.truncated ? ' (the log was cut at its first 5,000 events)' : ''}.</li>`;
}

function closeDetail() {
  history.pushState('', document.title, location.pathname + location.search);
  showDetail();
}

async function load() {
  const started = performance.now();
  const result = await api.loadProjection();
  metrics.loads += 1;
  metrics.lastLoadMs = Math.round(performance.now() - started);
  if (!result.projection) metrics.loadFailures += 1;
  if (result.projection) {
    projection = result.projection;
    model = officeModel(result.projection);
    render();
    if (parseRoute(location.hash)) showDetail(false);
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
  translatePage(document);
  showState('loading');
  setConnection(t(api.mode === 'fixture' ? 'connection.demo' : 'connection.connecting'));
  let result = await load();
  // Until Command answers: try again, waiting longer each time, and say so.
  for (let attempt = 0; !result.projection && ['unavailable', 'error'].includes(result.status); attempt++) {
    const delay = retryDelay(attempt);
    setConnection(t('connection.retrying', { seconds: Math.round(delay / 1000) }));
    await new Promise((resolve) => setTimeout(resolve, delay));
    result = await load();
  }
  if (!result.projection) { setConnection(t('connection.signedOut')); return; }
  stopFollowing = await api.follow(result.projection, {
    onEvent: () => scheduleReload(),
    onState: (state) => {
      if (state === 'reconnecting') metrics.reconnects += 1;
      setConnection({ live: t('connection.live', { freshness: model.freshness }), reconnecting: t('connection.reconnecting'), unavailable: t('connection.logUnavailable'), fixture: t('connection.demo') }[state] || state);
      if (state === 'live') scheduleReload(0);
    }
  });
}

addEventListener('pagehide', () => stopFollowing());
addEventListener('hashchange', () => showDetail());
addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('detail').hidden) closeDetail(); });
boot();
