// What Office shows, from an Office projection (office-projection.v1, as
// AgentUX Command serves it): the floor's desks, the metrics, the timeline
// and the pending approvals, with the area and mission each belongs to.
// Pure functions: app.js renders them, model.test.mjs checks them.

/** Desk status: active, waiting, blocked, complete or idle. */
export function runStatus(status) {
  switch (status) {
    case 'running': case 'accepted': case 'active': return 'active';
    case 'waiting': case 'paused': case 'pending': return 'waiting';
    case 'failed': case 'blocked': return 'blocked';
    case 'completed': case 'done': case 'cancelled': case 'complete': return 'complete';
    default: return status || 'idle';
  }
}

function nodeStatus(node) {
  if (node.presence === 'online') return node.status === 'pending_approval' ? 'waiting' : 'active';
  if (node.presence === 'degraded') return 'waiting';
  if (node.presence === 'offline') return 'blocked';
  return runStatus(node.status);
}

const byId = (list) => new Map((list || []).map((item) => [item.id, item]));

/** Turns `run.updated` into "Run updated", `mission.run.gate_waiting` into "Mission run gate waiting". */
export function humanize(eventType = '') {
  const text = eventType.replace(/[._]/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : 'Event';
}

function actorName(actor) {
  if (!actor) return 'Command';
  if (typeof actor === 'string') return actor;
  const id = String(actor.id || '').replace(/^(oidc|service-token):/, '');
  return actor.kind ? `${id} · ${actor.kind}` : id;
}

/** Everything the page shows, from `projection`. */
export function officeModel(projection) {
  const missions = byId(projection.missions);
  const areas = byId(projection.areas);
  const runs = byId(projection.runs);
  const missionOf = (missionId) => missions.get(missionId);
  const placeOf = (missionId) => {
    const mission = missionOf(missionId);
    const area = mission ? areas.get(mission.area_id || mission.areaId) : null;
    return { mission: mission?.name || missionId || '', area: area?.name || '' };
  };

  const desks = [
    ...(projection.nodes || []).map((node) => ({
      id: `node:${node.id}`, name: node.name || node.id, kind: 'Node', status: nodeStatus(node),
      detail: [node.presence, node.connected === false ? 'not connected' : null, node.agentuxVersion].filter(Boolean).join(' · '),
      area: '', mission: ''
    })),
    ...(projection.agents || []).map((agent) => ({
      id: `agent:${agent.id}`, name: agent.name || agent.id, kind: 'Agent', status: runStatus(agent.status),
      detail: agent.role_id || agent.roleId || agent.kind || '', ...placeOf(agent.missionId || agent.mission_id)
    })),
    ...(projection.runs || []).map((run) => ({
      id: `run:${run.id}`, name: run.title || missionOf(run.missionId)?.name || run.id, kind: run.kind === 'mission' ? 'Mission run' : 'Run',
      status: runStatus(run.status), detail: [run.step, run.nodeId, run.error].filter(Boolean).join(' · '), ...placeOf(run.missionId)
    }))
  ];

  const timeline = [...(projection.events || [])].reverse().map((event) => {
    const run = runs.get(event.runId) || runs.get(event.data?.runId);
    const data = event.data || {};
    return {
      id: event.eventId,
      type: event.eventType,
      time: event.occurredAt || event.receivedAt || '',
      title: [humanize(event.eventType), data.title || run?.title || data.step || ''].filter(Boolean).join(': '),
      actor: actorName(event.actor),
      status: runStatus(data.status || data.state || (event.eventType?.includes('failed') ? 'failed' : event.eventType?.startsWith('approval') ? 'waiting' : '')),
      ...placeOf(run?.missionId || data.missionId)
    };
  });

  const now = Date.now();
  const approvals = (projection.approvals || [])
    .filter((approval) => approval.status === 'pending')
    .map((approval) => ({
      id: approval.id,
      title: approval.title || approval.action || 'Decision required',
      detail: [approval.runId, approval.gateId && `gate ${approval.gateId}`, approval.policy].filter(Boolean).join(' · '),
      expiresAt: approval.expiresAt || null,
      expired: Boolean(approval.expiresAt) && Date.parse(approval.expiresAt) < now
    }));

  const nodes = desks.filter((desk) => desk.kind === 'Node');
  const work = desks.filter((desk) => desk.kind.endsWith('Run'));
  return {
    organization: projection.organization?.name || projection.organizationId,
    definitionVersion: projection.definitionVersion,
    projectedAt: projection.projectedAt,
    freshness: projection.freshness,
    desks,
    timeline,
    approvals,
    filters: {
      areas: [...new Set(desks.map((d) => d.area).filter(Boolean))].sort(),
      missions: [...new Set(desks.map((d) => d.mission).filter(Boolean))].sort()
    },
    metrics: {
      active: work.filter((d) => d.status === 'active').length,
      blocked: desks.filter((d) => d.status === 'blocked').length,
      approvals: approvals.filter((a) => !a.expired).length,
      healthyNodes: `${nodes.filter((d) => d.status === 'active').length}/${nodes.length}`
    }
  };
}

/** Whether `item` passes the filters (`all` passes everything). */
export function matches(item, filters) {
  return (filters.area === 'all' || item.area === filters.area) &&
    (filters.mission === 'all' || item.mission === filters.mission) &&
    (filters.status === 'all' || item.status === filters.status);
}

/** What the banner says for a load or stream state; null when all is well. */
export function stateMessage(status, error) {
  switch (status) {
    case 'loading': return { tone: 'info', text: 'Loading the organization from Command…' };
    case 'empty': return { tone: 'info', text: error || 'Nothing here yet: publish a definition or connect a node.' };
    case 'stale': return { tone: 'warning', text: 'Stale: none of the organization’s nodes is reporting. What you see may be out of date.' };
    case 'degraded': return { tone: 'warning', text: 'Degraded: some of the organization’s nodes are not reporting.' };
    case 'denied': return { tone: 'error', text: error || 'You may not see this organization.' };
    case 'unavailable': return { tone: 'error', text: error || 'Command is unavailable; retrying.' };
    case 'error': return { tone: 'error', text: error || 'Something went wrong loading the organization.' };
    default: return null;
  }
}

/** What a decision's outcome tells the person who made it. */
export function decisionMessage(result) {
  if (result.ok) return `Decision recorded: ${result.decision?.decision ?? 'done'}`;
  const { code, message } = result.conflict || {};
  switch (code) {
    case 'denied': return `Not allowed: ${message}`;
    case 'unauthenticated': return message;
    case 'already_decided': return 'Someone already decided this approval.';
    case 'not_found': return 'This approval no longer exists.';
    case 'unavailable': return message;
    default: return `${code || 'error'}: ${message || 'the decision was not recorded'}`;
  }
}
