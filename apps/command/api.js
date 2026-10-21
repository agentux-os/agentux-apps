// The AgentUX Command operator API, as the fleet console uses it: nodes and
// what they report, enrollment, and commands to one node or many.

async function readJSON(response) {
  try { return await response.json(); } catch { return null; }
}

/** The commands an operator may send a node (AUXP command → node). */
export const NODE_COMMANDS = ['run.snapshot', 'run.cancel', 'request.resolve', 'bus.post', 'harness.list', 'harness.test', 'limits.clear', 'preferences.set', 'run.start'];

export function createCommandApi({ baseUrl = '', token, fetchImpl = fetch }) {
  const request = async (path, options = {}) => {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
      ...options,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
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
  const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

  return {
    mode: 'command',
    instance: () => request('/v1/instance'),
    nodes: () => request('/v1/nodes'),
    enrollments: async () => (await request('/v1/enrollments')).nodes ?? [],
    issueTokens: (input) => post('/v1/enrollment-tokens', input),
    approveNode: (nodeId) => post(`/v1/nodes/${encodeURIComponent(nodeId)}/approve`),
    revokeNode: (nodeId) => post(`/v1/nodes/${encodeURIComponent(nodeId)}/revoke`),
    /** One command to one node; resolves to `{ ok, result }` or `{ ok: false, held, error }`. */
    async command(nodeId, method, params = {}, commandId) {
      if (!NODE_COMMANDS.includes(method)) throw new Error(`not a node command: ${method}`);
      try {
        const body = await post(`/v1/nodes/${encodeURIComponent(nodeId)}/commands`, { method, params, ...(commandId ? { commandId } : {}) });
        return { ok: true, nodeId, commandId: body.commandId, result: body.result };
      } catch (error) {
        const code = error.body?.error?.code;
        return { ok: false, nodeId, commandId: error.body?.commandId, held: code === -32010, denied: code === -32011, error: error.message };
      }
    }
  };
}

/** The same command to several nodes, one at a time; one outcome each. */
export async function commandMany(api, nodeIds, method, params) {
  const outcomes = [];
  for (const nodeId of nodeIds) outcomes.push(await api.command(nodeId, method, params));
  return outcomes;
}

/** "3 done, 1 waiting for the node, 1 failed". */
export function summarize(outcomes) {
  const done = outcomes.filter((o) => o.ok).length;
  const held = outcomes.filter((o) => o.held).length;
  const failed = outcomes.length - done - held;
  return [done && `${done} done`, held && `${held} waiting for someone at the node`, failed && `${failed} failed`].filter(Boolean).join(', ') || 'nothing sent';
}

/** A node's agents, as its last harness.status said. */
export function agentsOf(node) {
  return Array.isArray(node.harnesses) ? node.harnesses : [];
}

/** Usage limits in force on a node, from its last harness.limits_changed (or its agents). */
export function limitsOf(node) {
  if (Array.isArray(node.limits)) return node.limits;
  return agentsOf(node).flatMap((h) => h.limits || []);
}

/** online, waiting, offline, pending_approval or revoked. */
export function nodeState(node, now = Date.now()) {
  if (node.status === 'pending_approval') return 'pending_approval';
  const seen = node.lastSeenAt ? Date.parse(node.lastSeenAt) : 0;
  if (!seen || now - seen > 2 * 60_000) return 'offline';
  return node.capacity?.waitingForHuman ? 'waiting' : 'online';
}

/** Fixture data for a console with no Command server configured. */
export function createFixtureApi() {
  const now = new Date().toISOString();
  const nodes = [
    {
      nodeId: 'node-build-01', organizationId: 'acme', status: 'online', connected: true, agentuxVersion: '0.4.9', lastSeenAt: now, capacity: { activeRuns: 2, waitingForHuman: 1 },
      harnesses: [
        { id: 'claude-code', installed: true, signedIn: true, version: '2.1.30', usage: { todayUsd: 3.2, weekUsd: 21.4, weekSessions: 12 }, quota: [], limits: [] },
        { id: 'codex', installed: true, signedIn: true, version: '0.153.0', usage: { todayUsd: 0.4, weekUsd: 6.1, weekSessions: 4 }, quota: [{ label: 'weekly', usedPercent: 92 }], limits: [] },
        { id: 'opencode', installed: true, signedIn: true, version: '1.18.2', usage: { todayUsd: 0, weekUsd: 0, weekSessions: 0 }, quota: [], limits: [] }
      ],
      limits: [], runs: { r1: { runId: 'r1', title: 'Add rate limiting', state: 'running', step: 'implement' } }, pendingApprovals: { q1: { requestId: 'q1', runId: 'r2', title: 'Approve the plan for "Fix login"' } }
    },
    {
      nodeId: 'node-build-02', organizationId: 'acme', status: 'online', connected: true, agentuxVersion: '0.4.9', lastSeenAt: now, capacity: { activeRuns: 0, waitingForHuman: 0 },
      harnesses: [{ id: 'claude-code', installed: true, signedIn: true, version: '2.1.30', usage: { todayUsd: 9.8, weekUsd: 40, weekSessions: 20 }, quota: [], limits: [] }],
      limits: [{ harness: 'claude-code', kind: 'weekly', until: new Date(Date.now() + 3 * 86_400_000).toISOString(), untilKnown: true, message: 'Weekly limit reached' }],
      runs: {}, pendingApprovals: {}
    }
  ];
  const enrollments = [
    { nodeId: 'node-build-01', organizationId: 'acme', approved: true, enrolledAt: now },
    { nodeId: 'gpu-1', organizationId: 'acme', approved: false, enrolledAt: now }
  ];
  const sent = [];
  return {
    mode: 'fixture',
    sent,
    instance: async () => ({ instanceId: 'cmd-fixture000000000', product: 'agentux-command' }),
    nodes: async () => structuredClone(nodes),
    enrollments: async () => structuredClone(enrollments),
    issueTokens: async (input) => ({
      instanceId: 'cmd-fixture000000000',
      tokens: Array.from({ length: input.count || 1 }, (_, i) => {
        const token = `auxe1_cmd-fixture000000000_${String(i).padStart(64, '0')}`;
        return { token, expiresAt: now, ...(input.provision ? { provision: { version: 1, ...input.provision, command: { url: 'https://command.example.org', enrollmentToken: token } } } : {}) };
      })
    }),
    approveNode: async (nodeId) => { enrollments.find((e) => e.nodeId === nodeId).approved = true; return { nodeId, status: 'approved' }; },
    revokeNode: async (nodeId) => { const e = enrollments.find((x) => x.nodeId === nodeId); e.revokedAt = now; return { nodeId, status: 'revoked' }; },
    async command(nodeId, method, params = {}) {
      sent.push({ nodeId, method, params });
      if (method === 'preferences.set' || method === 'run.start') return { ok: false, nodeId, held: true, error: 'awaiting_local_confirmation' };
      return { ok: true, nodeId, result: { fixture: true } };
    }
  };
}
