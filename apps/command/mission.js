// Mission workspace adapter for Command's current durable run and Office
// event APIs. Event labels can be extended as later typed activity arrives.

async function readJSON(response) {
  try { return await response.json(); } catch { return null; }
}

export function createMissionApi({ fetchImpl = fetch, EventSourceImpl = globalThis.EventSource } = {}) {
  const request = async (path, options = {}) => {
    const response = await fetchImpl(path, {
      credentials: 'same-origin',
      ...options,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
    });
    const body = await readJSON(response);
    if (!response.ok) {
      const error = new Error(body?.error?.message || body?.error || `Command answered ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  };
  const orgPath = (organizationId) => `/v1/organizations/${encodeURIComponent(organizationId)}`;

  return {
    mode: 'command',
    runs: async (organizationId) => (await request(`${orgPath(organizationId)}/runs`)).runs ?? [],
    run: (organizationId, runId) => request(`${orgPath(organizationId)}/runs/${encodeURIComponent(runId)}`),
    projection: (organizationId) => request(`/v1/office/projection?organizationId=${encodeURIComponent(organizationId)}`),
    replay: async (organizationId, after = 0, since = '') => {
      const start = since ? `&since=${encodeURIComponent(since)}` : '';
      const body = await request(`${orgPath(organizationId)}/events?after=${Math.max(0, Number(after) || 0)}&limit=1000${start}`);
      return { events: body.events ?? [], next: Number(body.next) || 0, ...(body.prunedThrough !== undefined ? { prunedThrough: body.prunedThrough } : {}) };
    },
    async follow(organizationId, after, { onEvent, onState } = {}) {
      if (!EventSourceImpl) { onState?.('unavailable'); return () => {}; }
      const source = new EventSourceImpl(`${orgPath(organizationId)}/events/stream?after=${Math.max(0, Number(after) || 0)}`, { withCredentials: true });
      source.addEventListener('open', () => onState?.('live'));
      source.addEventListener('error', () => onState?.('reconnecting'));
      source.addEventListener('unavailable', () => onState?.('unavailable'));
      source.addEventListener('office.event', (message) => {
        try {
          const value = JSON.parse(message.data);
          onEvent?.({ cursor: Number(message.lastEventId) || Number(value.sequence) || 0, event: value });
        } catch { /* Ignore malformed stream frames; EventSource resumes by cursor. */ }
      });
      return () => source.close();
    },
    cancel: (organizationId, runId) => request(`${orgPath(organizationId)}/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' }),
    resolveApproval: (organizationId, approvalId, decision, reason, idempotencyKey) => request(`/v1/approvals/${encodeURIComponent(approvalId)}/resolve`, {
      method: 'POST', body: JSON.stringify({ organizationId, decision: decision === 'denied' ? 'rejected' : decision, reason, idempotencyKey })
    })
  };
}

const ACTIVITY = new Map([
  ['mission.run.started', ['Run started', 'info']],
  ['mission.run.waiting', ['Waiting for a node', 'warning']],
  ['mission.run.step_started', ['Step started', 'info']],
  ['mission.run.dispatched', ['Step sent to node', 'info']],
  ['mission.run.held', ['Held for approval at node', 'warning']],
  ['mission.run.gate_waiting', ['Approval requested', 'warning']],
  ['approval.requested', ['Approval requested', 'warning']],
  ['approval.resolved', ['Approval decided', 'info']],
  ['mission.run.gate_decided', ['Approval decided', 'info']],
  ['mission.run.step_completed', ['Step completed', 'success']],
  ['mission.run.step_failed', ['Step failed', 'error']],
  ['mission.run.failed', ['Run failed', 'error']],
  ['mission.run.completed', ['Run completed', 'success']],
  ['mission.run.cancelled', ['Run cancelled', 'muted']]
]);

const humanize = (value = '') => {
  const words = String(value).replace(/[._-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Activity';
};

/** An extension point for future typed Command activity without fabricating payloads. */
export function activityForEvent(event = {}) {
  const [title, tone] = ACTIVITY.get(event.eventType) || [humanize(event.eventType), 'muted'];
  const data = event.data || {};
  return {
    title,
    tone,
    time: event.occurredAt || event.receivedAt || '',
    nodeId: event.nodeId || '',
    detail: [data.step, data.error, data.action, data.decision].filter((part) => typeof part === 'string' && part).join(' · '),
    eventType: event.eventType || 'unknown'
  };
}

/** Deduplicate at-least-once delivery and retain the durable log's order. */
export function orderedActivity(entries = []) {
  const unique = new Map();
  for (const entry of entries) {
    const wrapped = entry?.event ? entry : { cursor: entry?.sequence || 0, event: entry };
    const id = wrapped.event?.eventId;
    const key = id || `${wrapped.cursor}:${wrapped.event?.eventType}:${wrapped.event?.occurredAt}`;
    if (!unique.has(key)) unique.set(key, { ...wrapped, cursor: Number(wrapped.cursor) || Number(wrapped.event?.sequence) || 0 });
  }
  return [...unique.values()].sort((a, b) => a.cursor - b.cursor || String(a.event?.occurredAt || '').localeCompare(String(b.event?.occurredAt || '')));
}

/** Replays a run's organization log from its creation time, following durable cursors. */
export async function replayRunActivity(api, organizationId, run, { maxPages = 50 } = {}) {
  const since = run.createdAt || '';
  let page = await api.replay(organizationId, 0, since);
  const entries = [...page.events];
  let cursor = Number(page.next) || 0;
  let pageCount = 1;
  while (page.events.length === 1000 && pageCount < maxPages) {
    const previous = cursor;
    page = await api.replay(organizationId, cursor, since);
    if (!page.events.length) break;
    entries.push(...page.events);
    cursor = Number(page.next) || previous;
    pageCount += 1;
    if (cursor <= previous) return { events: orderedActivity(entries), cursor, truncated: true };
  }
  return { events: orderedActivity(entries), cursor, truncated: page.events.length === 1000 };
}

export function canDecideApproval(grants, organizationId, freshness) {
  return freshness !== 'stale' && (grants?.[organizationId] || grants?.['*'] || []).includes('approval.decide');
}

const TERMINAL_RUN_STATES = new Set(['completed', 'done', 'failed', 'cancelled']);

export function canCancelRun(grants, organizationId, status, freshness) {
  return freshness !== 'stale' && !TERMINAL_RUN_STATES.has(status) &&
    (grants?.[organizationId] || grants?.['*'] || []).includes('node.command');
}

export function runConnectionState({ connected, freshness } = {}) {
  if (connected === false) return 'offline';
  if (freshness === 'stale') return 'stale';
  return 'live';
}
