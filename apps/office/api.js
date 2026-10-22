// AgentUX Office's view of AgentUX Command: the organization's projection,
// its live event stream, and approval decisions. `createCommandApi` talks to
// Command (through serve-office's proxy, or Command's own origin with a
// signed-in session); `createFixtureApi` is the same surface over demo data.

const requiredProjectionFields = [
  'organizationId', 'schemaVersion', 'definitionVersion', 'projectedAt', 'source', 'freshness', 'lastEventId',
  'organization', 'areas', 'missions', 'agents', 'nodes', 'runs', 'approvals', 'artifacts', 'events'
];

export function validProjection(value) {
  return Boolean(value) && requiredProjectionFields.every((field) => value[field] !== undefined) &&
    ['fresh', 'stale', 'degraded'].includes(value.freshness) && Array.isArray(value.events);
}

/** ready, empty, stale (no node reports) or degraded (some do not). */
export function projectionStatus(projection) {
  if (projection.freshness === 'stale') return 'stale';
  if (projection.freshness === 'degraded') return 'degraded';
  const entityCollections = ['areas', 'missions', 'agents', 'nodes', 'runs', 'approvals', 'artifacts'];
  if (entityCollections.every((field) => Array.isArray(projection[field]) && projection[field].length === 0)) return 'empty';
  return 'ready';
}

async function readJSON(response) {
  try { return await response.json(); } catch { return null; }
}

/** What a failed answer means for the person looking at Office. */
function failure(status, body) {
  if (status === 401) return { status: 'denied', error: 'Sign in to Command to see this organization.' };
  if (status === 403) return { status: 'denied', error: body?.error || 'You may not see this organization.' };
  if (status === 404) return { status: 'empty', error: 'Command has nothing for this organization yet.' };
  if (status === 503 || status === 502 || status === 504) return { status: 'unavailable', error: body?.error || 'Command cannot reach its database.' };
  return { status: 'error', error: body?.error || `Command answered ${status}` };
}

export function createCommandApi({ baseUrl = '', token, organizationId = 'org-demo', fetchImpl = fetch, EventSourceImpl = globalThis.EventSource }) {
  const root = baseUrl.replace(/\/$/, '');
  const org = encodeURIComponent(organizationId);
  const request = async (path, options = {}) => fetchImpl(`${root}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });

  return {
    mode: 'command',
    organizationId,
    async loadProjection() {
      try {
        const response = await request(`/v1/office/projection?organizationId=${org}`);
        const body = await readJSON(response);
        if (!response.ok) return { projection: null, ...failure(response.status, body) };
        if (!validProjection(body)) return { status: 'error', projection: null, error: 'Command sent a projection Office does not understand.' };
        return { status: projectionStatus(body), projection: body, error: null };
      } catch (error) {
        return { status: 'unavailable', projection: null, error: `Command is unreachable: ${error.message}` };
      }
    },

    /**
     * Follows the organization's events from the projection on: calls
     * `onEvent(event)` for each, `onState('live' | 'reconnecting' |
     * 'unavailable')` as the stream goes. Returns a function that stops it.
     */
    async follow(projection, { onEvent, onState }) {
      if (!EventSourceImpl) { onState?.('unavailable'); return () => {}; }
      // The cursor of the projection's last event: the stream goes on from there.
      let after = 0;
      try {
        const since = encodeURIComponent(projection.projectedAt);
        const response = await request(`/v1/organizations/${org}/events?since=${since}&limit=1000`);
        const body = await readJSON(response);
        const events = response.ok ? body?.events || [] : [];
        const last = events.find((entry) => entry.event?.eventId === projection.lastEventId) || events.at(-1);
        after = last ? last.cursor : 0;
      } catch { /* from the start of what the stream has */ }
      const source = new EventSourceImpl(`${root}/v1/organizations/${org}/events/stream?after=${after}`, { withCredentials: true });
      source.addEventListener('open', () => onState?.('live'));
      source.addEventListener('error', () => onState?.('reconnecting'));
      source.addEventListener('unavailable', () => onState?.('unavailable'));
      source.addEventListener('office.event', (message) => {
        try { onEvent?.(JSON.parse(message.data)); } catch { /* not an event */ }
      });
      return () => source.close();
    },

    /**
     * Decides an approval. `{ ok: true, decision }`, or `{ ok: false,
     * conflict: { code, message } }` with code `denied`, `unauthenticated`,
     * `already_decided`, `not_found`, `unavailable` or `request_failed`.
     */
    async resolveApproval(approvalId, input) {
      try {
        const response = await request(`/v1/approvals/${encodeURIComponent(approvalId)}/resolve`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, organizationId: input.organizationId || organizationId })
        });
        const body = await readJSON(response);
        if (response.ok) return { ok: true, decision: body };
        if (response.status === 401) return { ok: false, conflict: { code: 'unauthenticated', message: 'Sign in to Command to decide.' } };
        if (response.status === 403) return { ok: false, conflict: { code: 'denied', message: body?.error || 'You may not decide this approval.' } };
        if ([502, 503, 504].includes(response.status)) return { ok: false, conflict: { code: 'unavailable', message: 'Command could not record the decision; try again.' } };
        return { ok: false, conflict: body?.conflict || { code: 'request_failed', message: body?.error || `Command answered ${response.status}` } };
      } catch (error) {
        return { ok: false, conflict: { code: 'unavailable', message: `Command is unreachable: ${error.message}` } };
      }
    }
  };
}

export function createFixtureApi({ projection } = {}) {
  const state = projection || {
    organizationId: 'org-demo', schemaVersion: 'office-projection.v1', definitionVersion: 'definition-3',
    projectedAt: new Date().toISOString(), source: 'fixture', freshness: 'fresh', lastEventId: 'evt-fixture',
    organization: { id: 'org-demo', name: 'Demo Organization' }, areas: [], missions: [], agents: [], nodes: [], runs: [], approvals: [], artifacts: [], events: []
  };
  return {
    mode: 'fixture',
    organizationId: state.organizationId,
    async loadProjection() { return { status: projectionStatus(state), projection: state, error: null }; },
    async follow(_projection, { onState } = {}) { onState?.('fixture'); return () => {}; },
    async resolveApproval() { return { ok: false, conflict: { code: 'not_found', message: 'approval not found in fixture mode' } }; }
  };
}
