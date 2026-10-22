import { createDefinitionsApi, createFixtureDefinitionsApi } from './editor-api.js';
import { SECTIONS, STEP_FIELDS, blankDocument, canReview, capabilities, diff, readiness, splitList, validate } from './editor-model.js';

const $ = (id) => document.getElementById(id);
const config = globalThis.AGENTUX_OFFICE_CONFIG || {};
const organizationId = config.organizationId || 'org-demo';
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Demo: a published version 1 of an organization that requires reviews. */
function demoApi() {
  const document = {
    schema_version: '1.0',
    organization: { id: organizationId, name: 'Acme Robotics', publication_policy: 'review-required' },
    areas: [{ id: 'engineering', name: 'Engineering', owner_role_id: 'cto' }],
    roles: [
      { id: 'cto', name: 'CTO', principal_kind: 'human', permissions: ['organization.read', 'approval.decide'] },
      { id: 'reviewer', name: 'Reviewer', principal_kind: 'agent', permissions: ['run.read'] }
    ],
    missions: [{ id: 'ship', area_id: 'engineering', name: 'Ship a release', owner_role_id: 'cto' }],
    workflows: [{ id: 'ship-v1', mission_id: 'ship', steps: [
      { id: 'implement', kind: 'agent', role_id: 'reviewer', next: ['review'] },
      { id: 'review', kind: 'gate', gate_id: 'release', next: [] }
    ] }],
    gates: [{ id: 'release', kind: 'approval', policy: 'human-required', required_permissions: ['approval.decide'] }],
    agents: [{ id: 'atlas', role_id: 'reviewer' }],
    nodes: []
  };
  const leader = { kind: 'user', id: 'oidc:maya' };
  return createFixtureDefinitionsApi({
    organizationId,
    versions: [{ organization_id: organizationId, definition_version: 1, status: 'published', document, problems: [], created_by: leader, created_at: '2026-10-20T12:00:00Z', published_by: leader, published_at: '2026-10-20T12:30:00Z', revision: 1, reviews: [] }]
  });
}

const api = config.command ? createDefinitionsApi({ baseUrl: config.commandUrl || '', organizationId }) : demoApi();
const state = { caps: capabilities(null, organizationId), versions: [], current: null, published: null, doc: null, dirty: false };

function banner(text, tone = 'info', action) {
  const el = $('state-banner');
  el.hidden = !text;
  el.className = `state-banner ${tone}`;
  el.innerHTML = text ? `${escape(text)}${action ? ` <button type="button" id="banner-action">${escape(action.label)}</button>` : ''}` : '';
  if (action) $('banner-action').addEventListener('click', action.run);
}

const editable = () => Boolean(state.current && state.current.status === 'draft' && state.caps.edit);
const ids = (section) => (state.doc?.[section] || []).map((item) => item.id).filter(Boolean);

function field(path, def, value) {
  const disabled = editable() ? '' : 'disabled';
  const name = `${path}.${def.key}`;
  const label = escape(def.label || def.key);
  if (def.ref || (def.options && !def.list)) {
    const options = def.ref ? ids(def.ref) : def.options;
    const known = options.includes(value) || !value;
    return `<label>${label}<select data-path="${escape(name)}" ${disabled}><option value="">—</option>${options.map((o) => `<option ${o === value ? 'selected' : ''}>${escape(o)}</option>`).join('')}${known ? '' : `<option selected>${escape(value)}</option>`}</select></label>`;
  }
  const shown = def.list ? (value || []).join(', ') : value ?? '';
  const hint = def.list && def.options ? ` title="${escape(def.options.join(', '))}"` : '';
  return `<label>${label}<input data-path="${escape(name)}" data-list="${def.list ? 1 : ''}" value="${escape(shown)}" ${disabled}${hint} /></label>`;
}

function renderSections() {
  const doc = state.doc;
  if (!doc) { $('sections').innerHTML = '<p class="empty">Nothing to edit yet.</p>'; return; }
  const disabled = editable() ? '' : 'disabled';
  const org = doc.organization || {};
  let html = `<section class="editor-section"><h2>Organization</h2><div class="row">
    <label>name<input data-path="organization.name" value="${escape(org.name)}" ${disabled} /></label>
    <label>publication<select data-path="organization.publication_policy" ${disabled}><option value="">whoever may publish</option><option value="review-required" ${org.publication_policy === 'review-required' ? 'selected' : ''}>reviewed by someone else first</option></select></label>
  </div></section>`;
  for (const [section, spec] of Object.entries(SECTIONS)) {
    const rows = (doc[section] || []).map((item, i) => `<div class="row">${spec.fields.map((f) => field(`${section}.${i}`, f, item[f.key])).join('')}<button type="button" class="remove" data-remove="${section}.${i}" ${disabled} aria-label="Remove ${escape(item.id || 'row')}">×</button></div>`).join('');
    html += `<section class="editor-section"><h2>${spec.title}</h2>${rows || '<p class="empty">None.</p>'}<button type="button" data-add="${section}" ${disabled}>Add</button></section>`;
  }
  const workflows = (doc.workflows || []).map((w, i) => {
    const steps = (w.steps || []).map((s, j) => `<div class="row step">${STEP_FIELDS.map((f) => field(`workflows.${i}.steps.${j}`, f, s[f.key])).join('')}<button type="button" class="remove" data-remove="workflows.${i}.steps.${j}" ${disabled} aria-label="Remove step ${escape(s.id || '')}">×</button></div>`).join('');
    return `<div class="workflow"><div class="row">${field(`workflows.${i}`, { key: 'id' }, w.id)}${field(`workflows.${i}`, { key: 'mission_id', label: 'mission', ref: 'missions' }, w.mission_id)}<button type="button" class="remove" data-remove="workflows.${i}" ${disabled} aria-label="Remove workflow ${escape(w.id || '')}">×</button></div>${steps || '<p class="empty">No steps.</p>'}<button type="button" data-add="workflows.${i}.steps" ${disabled}>Add step</button></div>`;
  }).join('');
  html += `<section class="editor-section"><h2>Workflows</h2><p class="subtle">Steps run in order from the first; <code>next</code> names the step after. Agent steps go to a node, gates ask for an approval.</p>${workflows || '<p class="empty">None.</p>'}<button type="button" data-add="workflows" ${disabled}>Add workflow</button></section>`;
  $('sections').innerHTML = html;
}

function renderSide() {
  const d = state.current;
  const problems = state.doc ? validate(state.doc, organizationId) : [];
  $('problems').innerHTML = problems.length ? problems.map((p) => `<li>${escape(p)}</li>`).join('') : `<li class="ok">${d?.status === 'published' ? 'Published: it passed these checks.' : 'No problems.'}</li>`;
  const changes = state.doc && d?.status === 'draft' ? diff(state.published?.document || null, state.doc) : [];
  const fmt = (v) => escape(Array.isArray(v) ? v.join(', ') : typeof v === 'object' && v !== null ? JSON.stringify(v) : v ?? '—');
  $('changes').innerHTML = changes.length
    ? changes.map((c) => `<li class="${c.change}"><strong>${escape(c.change)}</strong> ${escape(c.section)} <code>${escape(c.id)}</code>${c.fields ? `<ul>${c.fields.map((f) => `<li>${escape(f.key)}: ${fmt(f.before)} → ${fmt(f.after)}</li>`).join('')}</ul>` : ''}</li>`).join('')
    : `<li class="subtle">${d?.status === 'draft' ? (state.published ? 'Same as the published version.' : 'Nothing published yet: everything is new.') : 'Open a draft to see its changes.'}</li>`;
  const reviews = d?.reviews || [];
  $('reviews').innerHTML = reviews.length
    ? reviews.map((r) => `<li><strong>${escape(r.decision === 'approved' ? 'Approved' : 'Changes requested')}</strong> by ${escape(r.reviewer?.id)} · revision ${escape(r.revision)}${r.revision !== d.revision ? ' (older)' : ''}${r.comment ? `<br><small>${escape(r.comment)}</small>` : ''}</li>`).join('')
    : '<li class="subtle">No reviews yet.</li>';
  const reviewable = canReview(d, state.caps) && !state.dirty;
  for (const id of ['approve', 'request-changes']) $(id).disabled = !reviewable;
  $('review-note').textContent = !d || d.status !== 'draft' ? '' : state.dirty ? 'Save before reviewing.' : !state.caps.review ? 'Reviewing needs approval.decide.' : !canReview(d, state.caps) ? 'You edited this revision: someone else reviews it.' : '';
  const ready = readiness(d, state.caps, problems);
  $('publish').disabled = state.dirty || !ready.publish;
  $('publish-note').textContent = state.dirty ? 'Save first.' : ready.reason;
  $('save').disabled = !editable() || !state.dirty;
  $('history').innerHTML = state.versions.map((v) => `<li><button type="button" data-open="${v.definition_version}" class="link">v${v.definition_version}</button> ${escape(v.status)}${v.status === 'draft' ? ` · revision ${v.revision}` : ` by ${escape(v.published_by?.id)}`}${state.caps.edit && v.status === 'published' ? ` <button type="button" data-from="${v.definition_version}" class="link">draft from this</button>` : ''}</li>`).join('') || '<li class="subtle">No versions yet.</li>';
  $('version').textContent = d ? `v${d.definition_version} · ${d.status}${d.status === 'draft' ? ` · revision ${d.revision}` : ''}${state.dirty ? ' · unsaved' : ''}` : 'no version';
  $('organization-name').textContent = state.doc?.organization?.name || organizationId;
  $('new-draft').disabled = !state.caps.edit;
}

function render() { renderSections(); renderSide(); }

/** Follows `path` (`roles.1.permissions`) into the document. */
function setPath(path, value) {
  const keys = path.split('.');
  let node = state.doc;
  for (const key of keys.slice(0, -1)) node = node[/^\d+$/.test(key) ? Number(key) : key] ??= {};
  const last = keys.at(-1);
  if (value === '' && last !== 'name' && last !== 'id') delete node[last]; else node[last] = value;
}

function getPath(path) {
  return path.split('.').reduce((node, key) => node?.[/^\d+$/.test(key) ? Number(key) : key], state.doc);
}

async function refreshVersions() {
  const listed = await api.list();
  if (!listed.ok) { banner(listed.message, listed.error === 'unavailable' ? 'error' : 'warning'); return false; }
  state.versions = listed.body.definitions || [];
  const latestPublished = state.versions.find((v) => v.status === 'published');
  state.published = latestPublished ? (await api.get(latestPublished.definition_version)).body : null;
  return true;
}

async function open(version) {
  if (state.dirty && !confirmLeave()) return;
  const got = await api.get(version);
  if (!got.ok) return banner(got.message, 'error');
  state.current = got.body;
  state.doc = structuredClone(got.body.document);
  state.dirty = false;
  banner(state.current.status === 'published' ? 'Published versions never change. Start a draft from it to change the organization.' : '');
  render();
}

// Unsaved changes are never dropped silently.
function confirmLeave() { return globalThis.confirm ? globalThis.confirm('Discard your unsaved changes?') : true; }

async function startDraft(from) {
  const made = from ? await api.draft({ from }) : await api.draft({ document: state.published?.document || blankDocument(organizationId) });
  if (!made.ok) return banner(made.message, 'error');
  await refreshVersions();
  await open(made.body.definition_version);
  banner(`Draft v${made.body.definition_version} started${from ? ` from v${from}` : ''}.`, 'info');
}

async function save() {
  const d = state.current;
  const saved = await api.save(d.definition_version, state.doc, d.revision);
  if (saved.ok) {
    state.current = saved.body; state.doc = structuredClone(saved.body.document); state.dirty = false;
    await refreshVersions();
    banner(saved.body.problems?.length ? `Saved revision ${saved.body.revision}, with ${saved.body.problems.length} problem(s) to fix before publishing.` : `Saved revision ${saved.body.revision}.`, saved.body.problems?.length ? 'warning' : 'info');
    return render();
  }
  if (saved.error === 'stale_draft') {
    return banner(`Someone saved this draft meanwhile (now revision ${saved.body?.currentRevision ?? '?'}). Your changes are still here; load theirs to merge by hand.`, 'warning', { label: 'Load their revision', run: () => { state.dirty = false; open(d.definition_version); } });
  }
  banner(saved.message, 'error');
}

async function review(decision) {
  const d = state.current;
  const comment = $('review-comment').value.trim();
  const done = await api.review(d.definition_version, decision, comment, d.revision);
  if (!done.ok) return banner(done.error === 'stale_draft' ? 'The draft changed before your review; reload and review the new revision.' : done.message, 'warning');
  state.current = done.body; $('review-comment').value = '';
  banner(decision === 'approved' ? `You approved revision ${d.revision}.` : 'You asked for changes.', 'info');
  renderSide();
}

async function publish() {
  const d = state.current;
  const done = await api.publish(d.definition_version, d.revision);
  if (!done.ok) {
    const text = done.error === 'invalid' ? `Command found problems: ${(done.problems || []).join('; ')}` : done.message;
    return banner(text, done.error === 'review_required' || done.error === 'stale_draft' ? 'warning' : 'error');
  }
  await refreshVersions();
  await open(d.definition_version);
  banner(`Version ${d.definition_version} is published: Command and Office use it now.`, 'info');
}

$('sections').addEventListener('input', (event) => {
  const path = event.target.dataset.path;
  if (!path || !editable()) return;
  const value = event.target.dataset.list ? splitList(event.target.value) : event.target.value;
  setPath(path, value);
  state.dirty = true;
  renderSide();
});
$('sections').addEventListener('change', (event) => { if (event.target.dataset.path?.endsWith('.id')) renderSections(); });
$('sections').addEventListener('click', (event) => {
  const { add, remove } = event.target.dataset;
  if (!editable() || (!add && !remove)) return;
  if (add) {
    const list = getPath(add) || [];
    list.push(add.endsWith('steps') ? { id: '', kind: 'agent', next: [] } : add === 'workflows' ? { id: '', mission_id: '', steps: [] } : { id: '' });
    setPath(add, list);
  } else {
    const keys = remove.split('.');
    getPath(keys.slice(0, -1).join('.')).splice(Number(keys.at(-1)), 1);
  }
  state.dirty = true;
  render();
});
$('history').addEventListener('click', (event) => {
  if (event.target.dataset.open) open(Number(event.target.dataset.open));
  if (event.target.dataset.from) startDraft(Number(event.target.dataset.from));
});
$('save').addEventListener('click', save);
$('publish').addEventListener('click', publish);
$('approve').addEventListener('click', () => review('approved'));
$('request-changes').addEventListener('click', () => review('changes_requested'));
$('new-draft').addEventListener('click', () => startDraft(state.published?.definition_version));
addEventListener('beforeunload', (event) => { if (state.dirty) event.preventDefault(); });

async function boot() {
  $('mode').textContent = api.mode === 'fixture' ? 'demo data' : 'AgentUX Command';
  const me = await api.me();
  if (!me.ok) return banner(me.error === 'unauthenticated' ? 'Sign in to AgentUX Command to edit the organization.' : me.message, 'error');
  state.caps = capabilities(me.body, organizationId);
  if (!state.caps.read) return banner('You may not see this organization (organization.read).', 'error');
  if (!(await refreshVersions())) return;
  const draft = state.versions.find((v) => v.status === 'draft');
  const target = draft || state.versions[0];
  if (target) await open(target.definition_version); else render();
  if (!state.caps.edit) banner('Read-only: editing needs organization.edit.', 'warning');
  else if (!draft) banner(state.versions.length ? 'No draft open. Start one to change the organization.' : 'No definition yet. Start a draft.', 'info');
}

boot();
