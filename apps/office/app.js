import { createCommandApi, createFixtureApi } from './api.js';

const $ = (id) => document.getElementById(id);
const filters = { area: 'all', mission: 'all', status: 'all' };
const config = globalThis.AGENTUX_OFFICE_CONFIG || {};
const fixtureProjection = {
  organizationId: 'org-demo', schemaVersion: 'office-projection.v1', definitionVersion: 'definition-3', projectedAt: new Date().toISOString(), source: 'fixture', freshness: 'fresh', lastEventId: 'evt-107',
  organization: { id: 'org-demo', name: 'Acme Robotics' },
  areas: [{ id: 'engineering', name: 'Engineering' }, { id: 'operations', name: 'Operations' }, { id: 'finance', name: 'Finance' }],
  missions: [{ id: 'release', name: 'Ship release' }, { id: 'fulfillment', name: 'Improve fulfillment' }, { id: 'close-month', name: 'Close month' }],
  agents: [
    { id: 'maya', name: 'Maya', kind: 'Human · CTO', area: 'Engineering', mission: 'Ship release', status: 'waiting' },
    { id: 'atlas', name: 'Atlas', kind: 'Agent · reviewer', area: 'Engineering', mission: 'Ship release', status: 'active' },
    { id: 'nova', name: 'Nova', kind: 'Agent · analyst', area: 'Finance', mission: 'Close month', status: 'active' },
    { id: 'lumen', name: 'Lumen', kind: 'Agent · planner', area: 'Finance', mission: 'Close month', status: 'complete' }
  ],
  nodes: [{ id: 'sp-01', name: 'SP-01', kind: 'Node · workstation', area: 'Operations', mission: 'Improve fulfillment', status: 'active' }, { id: 'sp-02', name: 'SP-02', kind: 'Node · workstation', area: 'Operations', mission: 'Improve fulfillment', status: 'blocked' }],
  runs: [], approvals: [], artifacts: [], events: [
    { eventId: 'evt-107', eventType: 'approval', occurredAt: '09:42', area: 'Engineering', mission: 'Ship release', status: 'waiting', actor: 'Maya · CTO', message: 'Release candidate is waiting for approval' },
    { eventId: 'evt-106', eventType: 'blocked', occurredAt: '09:39', area: 'Operations', mission: 'Improve fulfillment', status: 'blocked', actor: 'Node SP-02', message: 'Warehouse API gate timed out' }
  ]
};

let projection = fixtureProjection;
let people = [];
let runtimeApi;

function apiForRuntime() { return config.commandUrl ? createCommandApi({ baseUrl: config.commandUrl, token: config.token, organizationId: config.organizationId }) : createFixtureApi({ projection: fixtureProjection }); }
function normalizePeople(value) { return [...(value.agents || []), ...(value.nodes || [])].map((item, index) => ({ ...item, icon: item.icon || item.name?.slice(-2) || String(index + 1) })); }
function matches(item) { return (filters.area === 'all' || item.area === filters.area) && (filters.mission === 'all' || item.mission === filters.mission) && (filters.status === 'all' || item.status === filters.status); }

function setupFilters() {
  for (const area of [...new Set(people.map((item) => item.area))]) $('area-filter').insertAdjacentHTML('beforeend', `<option>${area}</option>`);
  for (const mission of [...new Set(people.map((item) => item.mission))]) $('mission-filter').insertAdjacentHTML('beforeend', `<option>${mission}</option>`);
  for (const [key, id] of Object.entries({ area: 'area-filter', mission: 'mission-filter', status: 'status-filter' })) $(id).addEventListener('change', (event) => { filters[key] = event.target.value; renderOffice(); });
  $('clear-filters').addEventListener('click', () => { for (const key of Object.keys(filters)) filters[key] = 'all'; for (const id of ['area-filter', 'mission-filter', 'status-filter']) $(id).value = 'all'; renderOffice(); });
}

function renderOffice() {
  const visible = people.filter(matches);
  $('office-grid').innerHTML = visible.length ? visible.map((item) => `<article class="desk ${item.status}"><div class="desk-icon">${item.icon}</div><div><strong>${item.name}</strong><span>${item.kind || 'Agent'}</span><small>${item.area} · ${item.mission}</small></div><b>${item.status}</b></article>`).join('') : '<p class="empty">No people, agents or nodes match these filters.</p>';
  $('metric-active').textContent = people.filter((item) => item.status === 'active').length;
  $('metric-blocked').textContent = people.filter((item) => item.status === 'blocked').length;
  $('metric-approvals').textContent = (projection.approvals || []).filter((item) => item.status === 'pending').length + people.filter((item) => item.status === 'waiting').length;
  const nodes = people.filter((item) => item.kind?.startsWith('Node')); $('metric-nodes').textContent = `${nodes.filter((item) => item.status !== 'blocked').length}/${nodes.length}`;
  $('event-list').innerHTML = (projection.events || []).filter(matches).map((event) => `<li class="event-item ${event.eventType || event.type}"><span class="event-time">${event.occurredAt || event.at || ''}</span><div><strong>${event.message || event.eventType}</strong><small>${event.actor || 'Command'} · ${event.area || 'Organization'}</small></div></li>`).join('') || '<li class="empty">No events match these filters.</li>';
  const approvals = (projection.approvals || []).filter((approval) => approval.status === 'pending');
  $('approval-list').innerHTML = approvals.length ? approvals.map((approval) => `<article class="approval-card"><div><strong>${approval.action || 'Decision required'}</strong><small>${approval.runId || 'Run'} · expires ${approval.expiresAt || 'not specified'}</small></div><div class="approval-actions"><button data-approval="${approval.id}" data-decision="approved">Approve</button><button data-approval="${approval.id}" data-decision="rejected">Reject</button></div></article>`).join('') : '<p class="empty">No pending approvals.</p>';
  for (const button of document.querySelectorAll('[data-approval]')) button.addEventListener('click', async () => {
    button.disabled = true;
    const result = await runtimeApi.resolveApproval(button.dataset.approval, { decision: button.dataset.decision, idempotencyKey: `office-${button.dataset.approval}-${button.dataset.decision}` });
    button.parentElement.previousElementSibling.querySelector('small').textContent = result.ok ? `Decision recorded: ${result.decision.decision}` : `${result.conflict.code}: ${result.conflict.message}`;
  });
  $('connection-status').textContent = `${projection.source} · ${projection.freshness} · ${projection.lastEventId}`;
}

async function boot() {
  runtimeApi = apiForRuntime();
  const result = await runtimeApi.loadProjection({ organizationId: config.organizationId || 'org-demo' });
  if (result.projection) projection = result.projection;
  if (!result.projection) $('connection-status').textContent = `Command unavailable · ${result.error || 'retry required'}`;
  people = normalizePeople(projection); setupFilters(); renderOffice();
}

boot();
