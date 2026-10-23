// Drill-down: from a signal on the floor to what is behind it. Routes
// (`#/run/<id>`) name an entity; `detailOf` says what Office knows about it
// from the projection, never inventing what is missing; `relatedTo` picks the
// events of the organization's log that belong to it, and `correlated` those
// of one chain (correlationId / causationId).

export const KINDS = ['area', 'mission', 'agent', 'node', 'run', 'approval', 'event'];

/** `#/run/run-1` → `{ kind: 'run', id: 'run-1' }`; null for anything else. */
export function parseRoute(hash) {
  const match = /^#\/([a-z]+)\/(.+)$/.exec(hash || '');
  if (!match || !KINDS.includes(match[1])) return null;
  try { return { kind: match[1], id: decodeURIComponent(match[2]) }; } catch { return null; }
}

/** The link to an entity's detail. */
export const href = (kind, id) => `#/${kind}/${encodeURIComponent(id)}`;

const byId = (list, id) => (list || []).find((item) => item.id === id);
const value = (v) => (v === undefined || v === null || v === '' ? null : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * What the projection says about `kind`/`id`: `{ found, title, kind, fields:
 * [[label, value]], links: [{ kind, id, label }], notes }`. Fields the
 * projection does not have are left out, not guessed.
 */
export function detailOf(projection, kind, id) {
  const p = projection || {};
  const links = [];
  const notes = [];
  const fields = [];
  const add = (label, v) => { const shown = value(v); if (shown !== null) fields.push([label, shown]); };
  const link = (k, i, label) => { if (i) links.push({ kind: k, id: i, label: label || i }); };
  let title = id;
  let found = true;
  switch (kind) {
    case 'area': {
      const area = byId(p.areas, id);
      if (!area) { found = false; break; }
      title = area.name || id;
      add('Owner role', area.owner_role_id || area.ownerRoleId);
      for (const m of (p.missions || []).filter((m) => (m.area_id || m.areaId) === id)) link('mission', m.id, m.name);
      break;
    }
    case 'mission': {
      const mission = byId(p.missions, id);
      if (!mission) { found = false; break; }
      title = mission.name || id;
      add('Owner role', mission.owner_role_id || mission.ownerRoleId);
      add('Success criteria', mission.success_criteria);
      link('area', mission.area_id || mission.areaId);
      for (const r of (p.runs || []).filter((r) => r.missionId === id)) link('run', r.id, `${r.title || r.id} (${r.status})`);
      if (!(p.runs || []).some((r) => r.missionId === id)) notes.push('No runs of this mission yet.');
      break;
    }
    case 'agent': {
      const agent = byId(p.agents, id);
      if (!agent) { found = false; break; }
      title = agent.name || id;
      add('Role', agent.role_id || agent.roleId);
      add('Capabilities', agent.capabilities);
      add('Status', agent.status);
      break;
    }
    case 'node': {
      const node = byId(p.nodes, id);
      if (!node) { found = false; break; }
      add('Presence', node.presence);
      add('Status', node.status);
      add('Connected', node.connected === undefined ? null : node.connected ? 'yes' : 'no');
      add('Last heard', node.lastHeartbeatAt);
      add('AgentUX', node.agentuxVersion);
      for (const r of (p.runs || []).filter((r) => r.nodeId === id)) link('run', r.id, `${r.title || r.id} (${r.status})`);
      if (node.presence && node.presence !== 'online') notes.push(`This node is ${node.presence}: what it last reported may be out of date.`);
      break;
    }
    case 'run': {
      const run = byId(p.runs, id);
      if (!run) { found = false; break; }
      title = run.title || byId(p.missions, run.missionId)?.name || id;
      add('Status', run.status);
      add('Kind', run.kind === 'mission' ? 'mission run' : 'node run');
      add('Step', run.step);
      add('Definition', run.definitionVersion);
      add('Cost (USD)', run.costUsd);
      add('Branch', run.branch);
      add('Pull request', run.pullRequest);
      add('Error', run.error);
      add('Updated', run.updatedAt);
      link('mission', run.missionId, byId(p.missions, run.missionId)?.name);
      link('node', run.nodeId);
      for (const a of (p.approvals || []).filter((a) => a.runId === id)) link('approval', a.id, `${a.title || a.action || a.id} (${a.status})`);
      const artifacts = (p.artifacts || []).filter((a) => a.runId === id);
      for (const a of artifacts) fields.push(['Artifact', value(a.name || a.uri || a.id)]);
      if (!artifacts.length) notes.push('No artifacts recorded for this run.');
      break;
    }
    case 'approval': {
      const approval = byId(p.approvals, id);
      if (!approval) { found = false; break; }
      title = approval.title || approval.action || id;
      add('Status', approval.status);
      add('Policy', approval.policy);
      add('Gate', approval.gateId);
      add('Required permissions', approval.requiredPermissions);
      add('Expires', approval.expiresAt);
      add('Detail', approval.detail);
      link('run', approval.runId);
      break;
    }
    case 'event': {
      const event = (p.events || []).find((e) => e.eventId === id);
      if (!event) { found = false; break; }
      title = event.eventType;
      add('When', event.occurredAt);
      add('Received', event.receivedAt);
      add('Actor', event.actor ? `${event.actor.id} (${event.actor.kind})` : null);
      add('Node', event.nodeId);
      add('Sequence', event.sequence);
      add('Correlation', event.correlationId);
      add('Caused by', event.causationId);
      add('Definition', event.definitionVersion);
      link('run', event.runId || event.data?.runId);
      if (event.nodeId && !event.nodeId.startsWith('command')) link('node', event.nodeId);
      break;
    }
    default: found = false;
  }
  if (!found) notes.push(kind === 'event'
    ? 'This event is older than the latest the projection keeps; its chain is below if the log still has it.'
    : `The projection has no ${kind} ${id}. It may have been removed, or belong to another organization.`);
  if (p.freshness && p.freshness !== 'fresh') notes.push(`The projection is ${p.freshness}: this may not be current.`);
  return { found, kind, id, title, fields, links, notes };
}

/** Whether `event` (an Office event) belongs to `kind`/`id`. */
export function relatedTo(event, kind, id, projection) {
  const data = event.data || {};
  const runOf = event.runId || data.runId;
  switch (kind) {
    case 'run': return runOf === id;
    case 'node': return event.nodeId === id;
    case 'agent': return event.actor?.id === id;
    case 'approval': return data.id === id || data.approvalId === id || data.requestId === id;
    case 'mission': return data.missionId === id || (projection?.runs || []).some((r) => r.missionId === id && r.id === runOf);
    case 'area': {
      const missions = new Set((projection?.missions || []).filter((m) => (m.area_id || m.areaId) === id).map((m) => m.id));
      return missions.has(data.missionId) || (projection?.runs || []).some((r) => missions.has(r.missionId) && r.id === runOf);
    }
    case 'event': return event.eventId === id;
    default: return false;
  }
}

/** The events of one chain with `event`: same correlation, or caused by it. */
export function correlated(events, event) {
  if (!event) return [];
  const chain = new Set([event.correlationId, event.eventId].filter(Boolean));
  return events.filter((e) => e.eventId !== event.eventId && (chain.has(e.correlationId) || chain.has(e.causationId)));
}
