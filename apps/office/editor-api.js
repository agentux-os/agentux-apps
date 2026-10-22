// The leadership editor's view of AgentUX Command's organization
// definitions: versions, drafts saved against a revision (If-Match), reviews
// and publication. Every call resolves to `{ ok, status, body }` (with `etag`
// on definitions); failures carry `error` (`stale_draft`, `review_required`,
// `denied`, `unauthenticated`, `invalid`, `unavailable`, ...) and `message`.
// `createFixtureDefinitionsApi` keeps the same rules in memory.

import { validate } from './editor-model.js';

async function readJSON(response) {
  try { return await response.json(); } catch { return null; }
}

function outcome(response, body) {
  if (response.ok) return { ok: true, status: response.status, body, etag: response.headers.get('etag') };
  const base = { ok: false, status: response.status, body };
  switch (response.status) {
    case 401: return { ...base, error: 'unauthenticated', message: 'Sign in to Command.' };
    case 403: return { ...base, error: 'denied', message: body?.error || 'You may not do this.' };
    case 404: return { ...base, error: 'not_found', message: body?.error || 'No such version.' };
    case 409: return { ...base, error: body?.error === 'stale_draft' || body?.error === 'review_required' ? body.error : 'published', message: body?.message || body?.error || 'The draft changed.' };
    case 422: return { ...base, error: 'invalid', message: body?.error || 'The definition does not validate.', problems: body?.problems || [] };
    default: return { ...base, error: response.status >= 500 ? 'unavailable' : 'failed', message: body?.error || `Command answered ${response.status}` };
  }
}

export function createDefinitionsApi({ baseUrl = '', organizationId, fetchImpl = fetch }) {
  const root = `${baseUrl.replace(/\/$/, '')}/v1/organizations/${encodeURIComponent(organizationId)}`;
  const call = async (url, { method = 'GET', body, revision } = {}) => {
    try {
      const response = await fetchImpl(url, {
        method,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(revision !== undefined ? { 'If-Match': `"${revision}"` } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return outcome(response, await readJSON(response));
    } catch (error) {
      return { ok: false, status: 0, error: 'unavailable', message: `Command is unreachable: ${error.message}` };
    }
  };
  return {
    mode: 'command',
    organizationId,
    me: () => call(`${baseUrl.replace(/\/$/, '')}/v1/auth/me`),
    list: () => call(`${root}/definitions`),
    get: (version) => call(`${root}/definitions/${version}`),
    /** A new draft: from `document`, or from version `from`. */
    draft: ({ document, from } = {}) => from ? call(`${root}/definitions?from=${from}`, { method: 'POST' }) : call(`${root}/definitions`, { method: 'POST', body: document }),
    save: (version, document, revision) => call(`${root}/definitions/${version}`, { method: 'PUT', body: document, revision }),
    review: (version, decision, comment, revision) => call(`${root}/definitions/${version}/reviews`, { method: 'POST', body: { decision, comment }, revision }),
    publish: (version, revision) => call(`${root}/definitions/${version}/publish`, { method: 'POST', revision }),
    audit: () => call(`${root}/audit`)
  };
}

/**
 * The same API over memory, with Command's rules: revisions and stale
 * saves, reviews (never one's own), review-required publication, frozen
 * published versions. `as(subject)` switches who is acting.
 */
export function createFixtureDefinitionsApi({ organizationId = 'org-demo', subject = 'oidc:leader', grants, versions = [] } = {}) {
  const state = { subject, versions: structuredClone(versions), audit: [] };
  const actor = () => ({ kind: state.subject.startsWith('oidc:') ? 'user' : 'operator', id: state.subject });
  const ok = (body, status = 200) => ({ ok: true, status, body: structuredClone(body), etag: body?.revision ? `"${body.revision}"` : null });
  const fail = (status, error, message, extra = {}) => ({ ok: false, status, error, message, ...extra });
  const find = (v) => state.versions.find((d) => d.definition_version === Number(v));
  const record = (action, v) => state.audit.unshift({ organization_id: organizationId, action, actor: actor(), definition_version: v, occurred_at: new Date().toISOString() });
  const editor = (d) => (d.updated_by || d.created_by)?.id;
  return {
    mode: 'fixture',
    organizationId,
    as(next) { state.subject = next; return this; },
    async me() { return ok({ subject: state.subject, organizations: grants || { [organizationId]: ['organization.read', 'organization.edit', 'organization.publish', 'approval.decide'] } }); },
    async list() { return ok({ definitions: [...state.versions].sort((a, b) => b.definition_version - a.definition_version).map((d) => ({ ...d, document: null })) }); },
    async get(v) { const d = find(v); return d ? ok(d) : fail(404, 'not_found', 'No such version.'); },
    async draft({ document, from } = {}) {
      const source = from ? find(from) : null;
      if (from && !source) return fail(404, 'not_found', 'No such version.');
      const doc = structuredClone(source ? source.document : document);
      const version = Math.max(0, ...state.versions.map((d) => d.definition_version)) + 1;
      const d = { organization_id: organizationId, definition_version: version, status: 'draft', document: doc, problems: validate(doc, organizationId), created_by: actor(), created_at: new Date().toISOString(), revision: 1, reviews: [] };
      state.versions.push(d);
      record('definition.drafted', version);
      return ok(d, 201);
    },
    async save(v, document, revision) {
      const d = find(v);
      if (!d) return fail(404, 'not_found', 'No such version.');
      if (d.status !== 'draft') return fail(409, 'published', 'A published definition never changes.');
      if (revision !== undefined && revision !== d.revision) return fail(409, 'stale_draft', `the draft changed meanwhile: it is at revision ${d.revision}`, { body: { currentRevision: d.revision } });
      Object.assign(d, { document: structuredClone(document), problems: validate(document, organizationId), revision: d.revision + 1, updated_by: actor() });
      record('definition.replaced', d.definition_version);
      return ok(d);
    },
    async review(v, decision, comment, revision) {
      const d = find(v);
      if (!d) return fail(404, 'not_found', 'No such version.');
      if (d.status !== 'draft') return fail(409, 'published', 'A published definition never changes.');
      if (revision !== undefined && revision !== d.revision) return fail(409, 'stale_draft', `the draft changed meanwhile: it is at revision ${d.revision}`, { body: { currentRevision: d.revision } });
      if (editor(d) === state.subject) return fail(403, 'denied', 'nobody reviews their own changes');
      d.reviews.push({ reviewer: actor(), decision, comment, revision: d.revision, reviewed_at: new Date().toISOString() });
      record('definition.reviewed', d.definition_version);
      return ok(d);
    },
    async publish(v, revision) {
      const d = find(v);
      if (!d) return fail(404, 'not_found', 'No such version.');
      if (d.status !== 'draft') return fail(409, 'published', 'A published definition never changes.');
      if (revision !== undefined && revision !== d.revision) return fail(409, 'stale_draft', `the draft changed meanwhile: it is at revision ${d.revision}`, { body: { currentRevision: d.revision } });
      const problems = validate(d.document, organizationId);
      if (problems.length) return fail(422, 'invalid', 'The definition does not validate.', { problems });
      const approved = d.reviews.some((r) => r.decision === 'approved' && r.revision === d.revision && r.reviewer.id !== editor(d));
      if (d.document.organization?.publication_policy === 'review-required' && !approved) return fail(409, 'review_required', 'this organization publishes only a revision someone other than its editor approved');
      Object.assign(d, { status: 'published', published_by: actor(), published_at: new Date().toISOString() });
      record('definition.published', d.definition_version);
      return ok(d);
    },
    async audit() { return ok({ entries: structuredClone(state.audit) }); }
  };
}
