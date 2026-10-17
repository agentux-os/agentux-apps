const requiredProjectionFields = [
  'organizationId', 'schemaVersion', 'definitionVersion', 'projectedAt', 'source', 'freshness', 'lastEventId',
  'organization', 'areas', 'missions', 'agents', 'nodes', 'runs', 'approvals', 'artifacts', 'events'
];

function validProjection(value) {
  return value && requiredProjectionFields.every((field) => value[field] !== undefined) &&
    ['fresh', 'stale', 'degraded'].includes(value.freshness) && Array.isArray(value.events);
}

function projectionStatus(projection) {
  if (projection.freshness === 'stale') return 'stale';
  const entityCollections = ['areas', 'missions', 'agents', 'nodes', 'runs', 'approvals', 'artifacts'];
  if (entityCollections.every((field) => Array.isArray(projection[field]) && projection[field].length === 0)) return 'empty';
  return 'ready';
}

async function readJSON(response) {
  try { return await response.json(); } catch { return null; }
}

export function createCommandApi({ baseUrl, token, fetchImpl = fetch }) {
  const request = async (path, options = {}) => fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  });

  return {
    async loadProjection({ organizationId = 'org-demo' } = {}) {
      try {
        const response = await request(`/v1/office/projection?organizationId=${encodeURIComponent(organizationId)}`);
        const body = await readJSON(response);
        if (!response.ok || !validProjection(body)) {
          return { status: response.status === 503 ? 'degraded' : 'error', projection: null, error: body?.error || 'invalid projection response' };
        }
        return { status: projectionStatus(body), projection: body, error: null };
      } catch (error) {
        return { status: 'error', projection: null, error: error.message };
      }
    },
    async resolveApproval(approvalId, input) {
      try {
        const response = await request(`/v1/approvals/${encodeURIComponent(approvalId)}/resolve`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input)
        });
        const body = await readJSON(response);
        return response.ok ? { ok: true, decision: body } : { ok: false, conflict: body?.conflict || { code: 'request_failed', message: body?.error || 'approval request failed' } };
      } catch (error) {
        return { ok: false, conflict: { code: 'unavailable', message: error.message } };
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
    async loadProjection() { return { status: projectionStatus(state), projection: state, error: null }; },
    async resolveApproval() { return { ok: false, conflict: { code: 'not_found', message: 'approval not found in fixture mode' } }; }
  };
}
