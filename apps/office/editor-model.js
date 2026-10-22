// The leadership editor's rules, as pure functions: what each section of an
// organization definition (agentux docs/contracts/organization-definition-v1.md)
// holds, the checks AgentUX Command makes before publishing (mirrored here so
// leaders see problems as they type; Command stays the judge), the diff
// against the published version, and what the signed-in person may do.

/** ADR 0015's permission vocabulary (a role's `permissions`). */
export const PERMISSIONS = [
  'organization.read', 'organization.edit', 'organization.publish', 'run.read', 'run.start',
  'run.pause', 'run.cancel', 'approval.decide', 'artifact.read', 'node.manage'
];

/**
 * The sections the editor shows as tables, and their fields. `ref` names the
 * section a field points at (a select of its ids); `list` fields are
 * comma-separated; `options` are fixed choices.
 */
export const SECTIONS = {
  areas: { title: 'Areas', fields: [{ key: 'id' }, { key: 'name' }, { key: 'owner_role_id', label: 'owner role', ref: 'roles' }] },
  roles: { title: 'Roles', fields: [{ key: 'id' }, { key: 'name' }, { key: 'principal_kind', label: 'kind', options: ['human', 'agent'] }, { key: 'permissions', list: true, options: PERMISSIONS }] },
  agents: { title: 'Agents', fields: [{ key: 'id' }, { key: 'role_id', label: 'role', ref: 'roles' }, { key: 'capabilities', list: true }] },
  missions: { title: 'Missions', fields: [{ key: 'id' }, { key: 'name' }, { key: 'area_id', label: 'area', ref: 'areas' }, { key: 'owner_role_id', label: 'owner role', ref: 'roles' }] },
  gates: { title: 'Approval gates', fields: [{ key: 'id' }, { key: 'kind', options: ['approval'] }, { key: 'policy', options: ['human-required', 'any'] }, { key: 'required_permissions', label: 'required permissions', list: true, options: PERMISSIONS }] }
};

/** A workflow step's fields. */
export const STEP_FIELDS = [
  { key: 'id' }, { key: 'kind', options: ['agent', 'gate', 'action'] },
  { key: 'role_id', label: 'role', ref: 'roles' }, { key: 'gate_id', label: 'gate', ref: 'gates' },
  { key: 'next', list: true }
];

const arr = (value) => (Array.isArray(value) ? value : []);
const str = (value) => (typeof value === 'string' ? value : '');

/** The problems that keep `document` from being published (Command's rules). */
export function validate(document, organizationId) {
  const problems = [];
  if (!document || typeof document !== 'object' || Array.isArray(document)) return ['a definition is a JSON object'];
  const schema = str(document.schema_version);
  if (schema.split('.')[0] !== '1' || !schema.includes('.')) problems.push(`schema_version must be 1.x (found ${JSON.stringify(schema)})`);
  const org = document.organization;
  if (!org || typeof org !== 'object') problems.push('organization is required');
  else {
    if (str(org.id) !== organizationId) problems.push(`organization.id must be ${JSON.stringify(organizationId)}`);
    if (!str(org.name).trim()) problems.push('organization.name is required');
  }
  const ids = {};
  for (const kind of ['areas', 'roles', 'missions', 'workflows', 'gates', 'agents', 'nodes']) {
    const seen = new Set();
    arr(document[kind]).forEach((item, i) => {
      const id = str(item?.id);
      if (!id) problems.push(`${kind}[${i}] has no id`);
      else if (seen.has(id)) problems.push(`${kind}: id ${JSON.stringify(id)} appears twice`);
      else seen.add(id);
    });
    ids[kind] = seen;
  }
  const refers = (kind, owner, field, target, value) => {
    if (value && !ids[target].has(value)) problems.push(`${kind} ${JSON.stringify(owner)}: ${field} ${JSON.stringify(value)} is not in ${target}`);
  };
  for (const area of arr(document.areas)) refers('area', area.id, 'owner_role_id', 'roles', str(area.owner_role_id));
  for (const mission of arr(document.missions)) {
    refers('mission', mission.id, 'area_id', 'areas', str(mission.area_id));
    refers('mission', mission.id, 'owner_role_id', 'roles', str(mission.owner_role_id));
  }
  for (const agent of arr(document.agents)) refers('agent', agent.id, 'role_id', 'roles', str(agent.role_id));
  for (const workflow of arr(document.workflows)) {
    refers('workflow', workflow.id, 'mission_id', 'missions', str(workflow.mission_id));
    const steps = new Set(arr(workflow.steps).map((s) => str(s?.id)));
    for (const step of arr(workflow.steps)) {
      refers('step', step.id, 'role_id', 'roles', str(step.role_id));
      refers('step', step.id, 'gate_id', 'gates', str(step.gate_id));
      for (const next of arr(step.next)) {
        if (!steps.has(next)) problems.push(`workflow ${JSON.stringify(workflow.id)}: step ${JSON.stringify(step.id)} goes to ${JSON.stringify(next)}, which is not a step of this workflow`);
      }
    }
  }
  for (const gate of arr(document.gates)) {
    for (const p of arr(gate.required_permissions)) if (!PERMISSIONS.includes(p)) problems.push(`gate ${JSON.stringify(gate.id)}: unknown permission ${JSON.stringify(p)}`);
  }
  for (const role of arr(document.roles)) {
    for (const p of arr(role.permissions)) if (!PERMISSIONS.includes(p)) problems.push(`role ${JSON.stringify(role.id)}: unknown permission ${JSON.stringify(p)}`);
  }
  const human = new Set(arr(document.roles).filter((r) => r.principal_kind === 'human').flatMap((r) => arr(r.permissions)));
  for (const gate of arr(document.gates).filter((g) => g.policy === 'human-required')) {
    for (const p of arr(gate.required_permissions)) if (!human.has(p)) problems.push(`gate ${JSON.stringify(gate.id)} is human-required, but no human role holds ${JSON.stringify(p)}`);
  }
  return problems;
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A workflow's step changes, step by step and field by field. */
function stepChanges(before, after) {
  const old = new Map(arr(before).map((s) => [s.id, s]));
  const now = new Map(arr(after).map((s) => [s.id, s]));
  const out = [];
  for (const [id, step] of now) {
    if (!old.has(id)) out.push({ key: `step ${id}`, before: undefined, after: step });
    else for (const key of new Set([...Object.keys(old.get(id)), ...Object.keys(step)])) {
      if (!same(old.get(id)[key], step[key])) out.push({ key: `step ${id}: ${key}`, before: old.get(id)[key], after: step[key] });
    }
  }
  for (const [id, step] of old) if (!now.has(id)) out.push({ key: `step ${id}`, before: step, after: undefined });
  if (!same(arr(before).map((s) => s.id), arr(after).map((s) => s.id)) && !out.length) out.push({ key: 'step order', before: arr(before).map((s) => s.id), after: arr(after).map((s) => s.id) });
  return out;
}

/**
 * What changed from `before` (the published version; null for none) to
 * `after`: per section, the ids added and removed and, for changed items,
 * their changed fields.
 */
export function diff(before, after) {
  const changes = [];
  const org = (d) => d?.organization || {};
  for (const key of new Set([...Object.keys(org(before)), ...Object.keys(org(after))])) {
    if (!same(org(before)[key], org(after)[key])) changes.push({ section: 'organization', id: key, change: 'changed', fields: [{ key, before: org(before)[key], after: org(after)[key] }] });
  }
  for (const section of ['areas', 'roles', 'agents', 'missions', 'gates', 'workflows', 'nodes']) {
    const old = new Map(arr(before?.[section]).map((i) => [i.id, i]));
    const now = new Map(arr(after?.[section]).map((i) => [i.id, i]));
    for (const [id, item] of now) {
      if (!old.has(id)) changes.push({ section, id, change: 'added', item });
      else if (!same(old.get(id), item)) {
        const fields = [...new Set([...Object.keys(old.get(id)), ...Object.keys(item)])]
          .filter((key) => !same(old.get(id)[key], item[key]))
          .flatMap((key) => (key === 'steps' ? stepChanges(old.get(id).steps, item.steps) : [{ key, before: old.get(id)[key], after: item[key] }]));
        changes.push({ section, id, change: 'changed', fields });
      }
    }
    for (const [id, item] of old) if (!now.has(id)) changes.push({ section, id, change: 'removed', item });
  }
  return changes;
}

/** What the signed-in person may do in `organizationId` (`/v1/auth/me`). */
export function capabilities(me, organizationId) {
  const grants = me?.organizations || {};
  const held = new Set([...(grants[organizationId] || []), ...(grants['*'] || [])]);
  return {
    read: held.has('organization.read'),
    edit: held.has('organization.edit'),
    review: held.has('approval.decide'),
    publish: held.has('organization.publish'),
    subject: me?.subject || ''
  };
}

/** Who a Command actor is, as Command names them for `subject`. */
const actorId = (actor) => actor?.id || '';

/**
 * Whether `definition` (a draft) can be published by someone with `caps`,
 * and if not, why.
 */
export function readiness(definition, caps, problems) {
  if (!definition) return { publish: false, reason: 'No draft.' };
  if (definition.status !== 'draft') return { publish: false, reason: 'Published versions never change; start a new draft.' };
  if (problems.length) return { publish: false, reason: `${problems.length} problem${problems.length === 1 ? '' : 's'} to fix first.` };
  const reviewRequired = definition.document?.organization?.publication_policy === 'review-required';
  const editor = actorId(definition.updated_by || definition.created_by);
  const approved = (definition.reviews || []).some((r) => r.decision === 'approved' && r.revision === definition.revision && actorId(r.reviewer) !== editor);
  if (reviewRequired && !approved) return { publish: false, reason: 'This organization publishes only a revision someone else approved.' };
  if (!caps.publish) return { publish: false, reason: 'Publishing needs organization.publish.' };
  return { publish: true, reason: '' };
}

/** Whether `caps` may review `definition` (not their own edits). */
export function canReview(definition, caps) {
  if (!definition || definition.status !== 'draft' || !caps.review) return false;
  return actorId(definition.updated_by || definition.created_by) !== caps.subject;
}

/** `a, b ,c` → `['a', 'b', 'c']`. */
export const splitList = (text) => String(text || '').split(',').map((s) => s.trim()).filter(Boolean);

/** A blank document for `organizationId`. */
export function blankDocument(organizationId, name = '') {
  return { schema_version: '1.0', organization: { id: organizationId, name }, areas: [], roles: [], missions: [], workflows: [], gates: [], agents: [], nodes: [] };
}
