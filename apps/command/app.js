import { agentsOf, commandMany, createCommandApi, createFixtureApi, limitsOf, nodeState, summarize } from './api.js';

const $ = (id) => document.getElementById(id);
const config = globalThis.AGENTUX_COMMAND_CONFIG || {};
const api = config.commandUrl !== undefined || config.token ? createCommandApi({ baseUrl: config.commandUrl || '', token: config.token }) : createFixtureApi();
const selected = new Set();
const open = new Set();
let nodes = [];

const AGENT_NAMES = { 'claude-code': 'Claude Code', codex: 'Codex', opencode: 'OpenCode', antigravity: 'Antigravity' };
const STATE_LABEL = { online: 'online', waiting: 'waiting for people', offline: 'offline', pending_approval: 'waiting for approval' };

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function log(message) {
  const item = document.createElement('li');
  item.className = 'event-item';
  item.innerHTML = `<span class="event-time">${new Date().toLocaleTimeString()}</span><div><strong>${escape(message)}</strong></div>`;
  $('log').prepend(item);
}

function money(n) { return `$${(n || 0).toFixed(2)}`; }

function until(limit) {
  if (!limit.until) return 'until lifted';
  const at = new Date(limit.until);
  return `${limit.untilKnown ? 'until' : 'retry'} ${at.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
}

function agentBadges(node) {
  const limits = limitsOf(node);
  return agentsOf(node).map((h) => {
    const limit = limits.find((l) => l.harness === h.id && !l.model);
    const cls = !h.installed ? 'off' : limit ? 'limited' : h.signedIn === false ? 'off' : 'ok';
    const note = !h.installed ? 'not installed' : limit ? `${limit.kind} limit ${until(limit)}` : h.signedIn === false ? 'not signed in' : (h.quota || []).map((q) => `${q.label} ${Math.round(q.usedPercent)}%`).join(' · ');
    return `<span class="agent ${cls}" title="${escape(note)}">${escape(AGENT_NAMES[h.id] || h.id)}${note ? ` <small>${escape(note)}</small>` : ''}</span>`;
  }).join('') || '<small>no report yet</small>';
}

function details(node) {
  const runs = Object.values(node.runs || {});
  const approvals = Object.values(node.pendingApprovals || {});
  const agentRows = agentsOf(node).map((h) => `<li>${escape(AGENT_NAMES[h.id] || h.id)} <small>${escape(h.version || '')}</small>
      <button type="button" data-node="${escape(node.nodeId)}" data-act="test" data-agent="${escape(h.id)}">Test</button>
      ${limitsOf(node).some((l) => l.harness === h.id) ? `<button type="button" data-node="${escape(node.nodeId)}" data-act="lift" data-agent="${escape(h.id)}">Limit lifted</button>` : ''}</li>`).join('');
  const runRows = runs.map((r) => `<li>${escape(r.title || r.runId)} <small>${escape(r.state)} · ${escape(r.step || '')}</small>
      ${['done', 'failed', 'cancelled'].includes(r.state) ? '' : `<button type="button" data-node="${escape(node.nodeId)}" data-act="cancel" data-run="${escape(r.runId)}">Cancel</button>`}</li>`).join('');
  const approvalRows = approvals.map((a) => `<li>${escape(a.title || a.requestId)}
      <button type="button" data-node="${escape(node.nodeId)}" data-act="approve" data-request="${escape(a.requestId)}">Approve</button>
      <button type="button" data-node="${escape(node.nodeId)}" data-act="deny" data-request="${escape(a.requestId)}">Deny</button></li>`).join('');
  return `<div class="details">
    <div><h4>Agents</h4><ul>${agentRows || '<li><small>none reported</small></li>'}</ul></div>
    <div><h4>Runs</h4><ul>${runRows || '<li><small>none</small></li>'}</ul></div>
    <div><h4>Waiting for people</h4><ul>${approvalRows || '<li><small>nothing</small></li>'}</ul></div>
  </div>`;
}

function render() {
  const now = Date.now();
  const states = nodes.map((n) => nodeState(n, now));
  $('metric-online').textContent = `${states.filter((s) => s === 'online' || s === 'waiting').length}/${nodes.length}`;
  $('metric-limits').textContent = String(nodes.reduce((sum, n) => sum + limitsOf(n).length, 0));
  $('metric-approvals').textContent = String(nodes.reduce((sum, n) => sum + Object.keys(n.pendingApprovals || {}).length, 0));
  $('metric-runs').textContent = String(nodes.reduce((sum, n) => sum + Object.values(n.runs || {}).filter((r) => !['done', 'failed', 'cancelled'].includes(r.state)).length, 0));
  $('nodes-empty').hidden = nodes.length > 0;
  $('node-rows').innerHTML = nodes.map((node, i) => {
    const spend = agentsOf(node).reduce((acc, h) => ({ today: acc.today + (h.usage?.todayUsd || 0), week: acc.week + (h.usage?.weekUsd || 0) }), { today: 0, week: 0 });
    const runs = Object.values(node.runs || {}).filter((r) => !['done', 'failed', 'cancelled'].includes(r.state)).length;
    const row = `<tr class="state-${states[i]}">
      <td><input type="checkbox" data-select="${escape(node.nodeId)}" ${selected.has(node.nodeId) ? 'checked' : ''} aria-label="Select ${escape(node.nodeId)}" /></td>
      <td><strong>${escape(node.nodeId)}</strong><small>${escape(node.organizationId)} · ${escape(node.agentuxVersion || '?')}${node.connected ? ' · commands' : ''}</small></td>
      <td><span class="state">${escape(STATE_LABEL[states[i]])}</span></td>
      <td class="agents">${agentBadges(node)}</td>
      <td>${money(spend.today)} · ${money(spend.week)}</td>
      <td>${runs}</td>
      <td><button type="button" data-open="${escape(node.nodeId)}">${open.has(node.nodeId) ? 'Hide' : 'Details'}</button></td>
    </tr>`;
    return open.has(node.nodeId) ? `${row}<tr class="detail-row"><td colspan="7">${details(node)}</td></tr>` : row;
  }).join('');
  $('batch').hidden = selected.size === 0;
  $('batch-count').textContent = `${selected.size} selected`;
}

async function refresh() {
  try {
    const [instance, list, enrolled] = await Promise.all([api.instance(), api.nodes(), api.enrollments().catch(() => [])]);
    nodes = list;
    $('instance').textContent = `Command server ${instance.instanceId}${api.mode === 'fixture' ? ' · demo data' : ''}`;
    $('connection-status').textContent = api.mode === 'fixture' ? 'fixture' : 'connected';
    renderEnrollments(enrolled);
    render();
  } catch (error) {
    $('connection-status').textContent = `unavailable: ${error.message}`;
  }
}

function renderEnrollments(list) {
  $('enrollments').innerHTML = list.map((e) => `<li><strong>${escape(e.nodeId)}</strong> <small>${escape(e.organizationId)} · ${e.revokedAt ? 'revoked' : e.approved ? 'approved' : 'waiting for approval'}</small>
    ${!e.revokedAt && !e.approved ? `<button type="button" data-enroll="approve" data-node="${escape(e.nodeId)}">Approve</button>` : ''}
    ${!e.revokedAt ? `<button type="button" data-enroll="revoke" data-node="${escape(e.nodeId)}">Revoke</button>` : ''}</li>`).join('') || '<li><small>none yet</small></li>';
}

async function one(nodeId, method, params, what) {
  const outcome = await api.command(nodeId, method, params);
  log(`${nodeId}: ${what} — ${outcome.ok ? 'done' : outcome.held ? 'waiting for someone at the node' : outcome.error}`);
  await refresh();
}

async function many(method, params, what) {
  const ids = [...selected];
  const outcomes = await commandMany(api, ids, method, params);
  log(`${what} on ${ids.length} node(s): ${summarize(outcomes)}`);
  for (const o of outcomes.filter((x) => !x.ok && !x.held)) log(`${o.nodeId}: ${o.error}`);
  await refresh();
}

document.addEventListener('click', (event) => {
  const el = event.target.closest('button, input[type=checkbox]');
  if (!el) return;
  if (el.dataset.select) {
    if (el.checked) selected.add(el.dataset.select); else selected.delete(el.dataset.select);
    render();
  } else if (el.id === 'select-all') {
    for (const n of nodes) { if (el.checked) selected.add(n.nodeId); else selected.delete(n.nodeId); }
    render();
  } else if (el.dataset.open) {
    if (open.has(el.dataset.open)) open.delete(el.dataset.open); else open.add(el.dataset.open);
    render();
  } else if (el.dataset.act) {
    const { node, act, agent, run, request } = el.dataset;
    if (act === 'test') void one(node, 'harness.test', { harness: agent }, `test ${AGENT_NAMES[agent] || agent}`);
    if (act === 'lift') void one(node, 'limits.clear', { harness: agent }, `lift ${AGENT_NAMES[agent] || agent}'s limit`);
    if (act === 'cancel') void one(node, 'run.cancel', { runId: run }, `cancel run ${run}`);
    if (act === 'approve' || act === 'deny') void one(node, 'request.resolve', { requestId: request, resolution: act }, `${act} ${request}`);
  } else if (el.dataset.enroll) {
    const call = el.dataset.enroll === 'approve' ? api.approveNode : api.revokeNode;
    void call(el.dataset.node).then(() => { log(`${el.dataset.node}: ${el.dataset.enroll}d`); return refresh(); }, (e) => log(e.message));
  } else if (el.id === 'batch-test') {
    void many('harness.test', { harness: $('batch-agent').value }, `test ${$('batch-agent').value}`);
  } else if (el.id === 'batch-lift') {
    void many('limits.clear', { harness: $('batch-agent').value }, `lift ${$('batch-agent').value}'s limit`);
  } else if (el.id === 'batch-prefs') {
    $('prefs-editor').hidden = false;
  } else if (el.id === 'prefs-cancel') {
    $('prefs-editor').hidden = true;
  } else if (el.id === 'prefs-send') {
    let preferences;
    try { preferences = JSON.parse($('prefs-json').value); } catch (e) { log(`preferences are not JSON: ${e.message}`); return; }
    $('prefs-editor').hidden = true;
    void many('preferences.set', { preferences }, 'push agent preferences');
  } else if (el.id === 'refresh') {
    void refresh();
  }
});

$('token-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const input = {
    organizationId: form.get('organizationId'),
    count: Number(form.get('count')) || 1,
    nodeName: form.get('nodeName') || undefined,
    ttlMinutes: (Number(form.get('ttlHours')) || 24) * 60,
    requireApproval: form.get('requireApproval') === 'on',
    ...(form.get('profile') ? { provision: { profile: form.get('profile'), user: form.get('user') || 'dev' } } : {})
  };
  try {
    const issued = await api.issueTokens(input);
    $('issued').innerHTML = issued.tokens.map((t, i) => `<div class="token"><code>${escape(t.token)}</code>
      ${t.provision ? `<button type="button" data-download="${i}">Download provision file</button>` : ''}
      <small>valid until ${escape(new Date(t.expiresAt).toLocaleString())}; shown once</small></div>`).join('');
    $('issued').onclick = (e) => {
      const i = e.target.dataset?.download;
      if (i === undefined) return;
      const t = issued.tokens[Number(i)];
      const blob = new Blob([JSON.stringify(t.provision, null, 2) + '\n'], { type: 'application/yaml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${t.provision.hostname || `agentux-node-${Number(i) + 1}`}.provision.yaml`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
    log(`issued ${issued.tokens.length} enrollment token(s) for ${input.organizationId}`);
  } catch (error) {
    log(`tokens: ${error.message}`);
  }
});

void refresh();
setInterval(() => void refresh(), 15_000);
