import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefinitionsApi, createFixtureDefinitionsApi } from './editor-api.js';
import { blankDocument, canReview, capabilities, diff, readiness, splitList, validate } from './editor-model.js';

/** The contract's example, as Command's tests use it. */
const example = () => ({
  schema_version: '1.0',
  organization: { id: 'acme', name: 'Acme Robotics' },
  areas: [{ id: 'engineering', name: 'Engineering', owner_role_id: 'cto' }],
  roles: [
    { id: 'cto', name: 'CTO', principal_kind: 'human', permissions: ['organization.read', 'approval.decide'] },
    { id: 'reviewer', name: 'Reviewer', principal_kind: 'agent', permissions: ['run.read'] }
  ],
  missions: [{ id: 'ship-release', area_id: 'engineering', name: 'Ship a release', owner_role_id: 'cto' }],
  workflows: [{ id: 'release-v1', mission_id: 'ship-release', steps: [
    { id: 'implement', kind: 'agent', role_id: 'reviewer', next: ['review'] },
    { id: 'review', kind: 'gate', gate_id: 'human-release', next: [] }
  ] }],
  gates: [{ id: 'human-release', kind: 'approval', required_permissions: ['approval.decide'], policy: 'human-required' }],
  agents: [{ id: 'reviewer-1', role_id: 'reviewer' }],
  nodes: []
});

test('validation catches what Command refuses, as the leader types', () => {
  assert.deepEqual(validate(example(), 'acme'), []);
  const broken = example();
  broken.schema_version = '2.0';
  broken.organization.id = 'other';
  broken.areas.push({ id: 'engineering', name: 'Twice' });
  broken.missions[0].area_id = 'nowhere';
  broken.workflows[0].steps[0].next = ['ship'];
  broken.roles[0].permissions = ['organization.read', 'world.domination'];
  const problems = validate(broken, 'acme');
  for (const expected of [
    'schema_version must be 1.x',
    'organization.id must be "acme"',
    'areas: id "engineering" appears twice',
    'mission "ship-release": area_id "nowhere" is not in areas',
    'step "implement" goes to "ship", which is not a step of this workflow',
    'role "cto": unknown permission "world.domination"',
    'gate "human-release" is human-required, but no human role holds "approval.decide"'
  ]) assert.ok(problems.some((p) => p.includes(expected)), `${expected}\n${problems.join('\n')}`);
  assert.deepEqual(validate(blankDocument('acme'), 'acme'), ['organization.name is required']);
});

test('the diff says what is added, removed and changed, field by field', () => {
  const before = example();
  const after = example();
  after.organization.name = 'Acme';
  after.areas.push({ id: 'finance', name: 'Finance' });
  after.agents = [];
  after.roles[1].permissions = ['run.read', 'artifact.read'];
  const changes = diff(before, after);
  const find = (section, id) => changes.find((c) => c.section === section && c.id === id);
  assert.equal(find('organization', 'name').fields[0].after, 'Acme');
  assert.equal(find('areas', 'finance').change, 'added');
  assert.equal(find('agents', 'reviewer-1').change, 'removed');
  assert.deepEqual(find('roles', 'reviewer').fields, [{ key: 'permissions', before: ['run.read'], after: ['run.read', 'artifact.read'] }]);
  assert.equal(changes.length, 4);
  const flow = example();
  flow.workflows[0].steps[1].next = ['ship'];
  flow.workflows[0].steps.push({ id: 'ship', kind: 'action', next: [] });
  const steps = diff(before, flow).find((c) => c.section === 'workflows').fields;
  assert.deepEqual(steps.map((f) => f.key), ['step review: next', 'step ship']);
  assert.deepEqual(steps[0], { key: 'step review: next', before: [], after: ['ship'] });
  assert.deepEqual(diff(before, example()), []);
  assert.equal(diff(null, example()).filter((c) => c.change === 'added').length, 7, 'nothing published: all new');
});

test('what a person may do follows their grants in this organization', () => {
  const me = { subject: 'oidc:ana', organizations: { acme: ['organization.read', 'organization.edit'], '*': ['approval.decide'] } };
  assert.deepEqual(capabilities(me, 'acme'), { read: true, edit: true, review: true, publish: false, subject: 'oidc:ana' });
  assert.deepEqual(capabilities(me, 'beta'), { read: false, edit: false, review: true, publish: false, subject: 'oidc:ana' });
  const draft = { status: 'draft', revision: 2, document: { organization: { publication_policy: 'review-required' } }, created_by: { id: 'oidc:ana' }, updated_by: { id: 'oidc:ana' }, reviews: [] };
  const all = { read: true, edit: true, review: true, publish: true, subject: 'oidc:bob' };
  assert.equal(canReview(draft, all), true);
  assert.equal(canReview(draft, { ...all, subject: 'oidc:ana' }), false, 'not your own edits');
  assert.match(readiness(draft, all, []).reason, /someone else approved/);
  assert.match(readiness(draft, all, ['x']).reason, /1 problem/);
  const approved = { ...draft, reviews: [{ decision: 'approved', revision: 2, reviewer: { id: 'oidc:bob' } }] };
  assert.equal(readiness(approved, all, []).publish, true);
  assert.equal(readiness({ ...approved, revision: 3 }, all, []).publish, false, 'an older revision’s approval');
  assert.match(readiness(approved, { ...all, publish: false }, []).reason, /organization.publish/);
  assert.deepEqual(splitList(' a, b ,,c '), ['a', 'b', 'c']);
});

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

test('the Command API sends If-Match and says what each answer means', async () => {
  const seen = [];
  const api = createDefinitionsApi({ organizationId: 'acme', fetchImpl: async (url, options) => {
    seen.push([options.method, url, options.headers['If-Match']]);
    if (url.endsWith('/definitions/1') && options.method === 'PUT') return json({ error: 'stale_draft', message: 'the draft changed meanwhile: it is at revision 3', currentRevision: 3 }, 409);
    if (url.endsWith('/publish')) return json({ error: 'review_required', message: 'needs a review' }, 409);
    if (url.endsWith('/reviews')) return json({ error: 'nobody reviews their own changes' }, 403);
    if (url.includes('?from=')) return json({ definition_version: 2, revision: 1 }, 201, { etag: '"1"' });
    return json({ error: 'the definition does not validate', problems: ['organization.name is required'] }, 422);
  }});
  const stale = await api.save(1, example(), 2);
  assert.deepEqual([stale.error, stale.body.currentRevision], ['stale_draft', 3]);
  assert.equal((await api.publish(1, 3)).error, 'review_required');
  assert.equal((await api.review(1, 'approved', '', 3)).error, 'denied');
  const drafted = await api.draft({ from: 1 });
  assert.deepEqual([drafted.ok, drafted.etag], [true, '"1"']);
  const invalid = await api.draft({ document: blankDocument('acme') });
  assert.deepEqual([invalid.error, invalid.problems], ['invalid', ['organization.name is required']]);
  assert.deepEqual(seen.slice(0, 4), [
    ['PUT', '/v1/organizations/acme/definitions/1', '"2"'],
    ['POST', '/v1/organizations/acme/definitions/1/publish', '"3"'],
    ['POST', '/v1/organizations/acme/definitions/1/reviews', '"3"'],
    ['POST', '/v1/organizations/acme/definitions?from=1', undefined]
  ]);
  const offline = createDefinitionsApi({ organizationId: 'acme', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal((await offline.list()).error, 'unavailable');
  const signedOut = createDefinitionsApi({ organizationId: 'acme', fetchImpl: async () => json({ error: 'authentication required' }, 401) });
  assert.equal((await signedOut.me()).error, 'unauthenticated');
});

test('drafting, editing, reviewing and publishing keep Command’s rules', async () => {
  const api = createFixtureDefinitionsApi({ organizationId: 'acme', subject: 'oidc:ana' });
  const reviewed = { ...example(), organization: { ...example().organization, publication_policy: 'review-required' } };
  const draft = (await api.draft({ document: reviewed })).body;
  assert.deepEqual([draft.definition_version, draft.revision, draft.problems], [1, 1, []]);
  const saved = (await api.save(1, { ...reviewed, organization: { ...reviewed.organization, name: 'Acme One' } }, 1)).body;
  assert.equal(saved.revision, 2);
  assert.equal((await api.as('oidc:bob').save(1, reviewed, 1)).error, 'stale_draft', 'bob worked from revision 1');
  assert.equal((await api.publish(1, 2)).error, 'review_required');
  assert.equal((await api.as('oidc:ana').review(1, 'approved', '', 2)).error, 'denied', 'ana edited it');
  assert.equal((await api.as('oidc:bob').review(1, 'approved', 'ok', 2)).ok, true);
  const published = await api.as('oidc:ana').publish(1, 2);
  assert.equal(published.body.status, 'published');
  assert.equal((await api.save(1, reviewed, 2)).error, 'published', 'frozen');
  assert.equal((await api.publish(1)).error, 'published', 'once');
  const rollback = (await api.draft({ from: 1 })).body;
  assert.equal(rollback.definition_version, 2);
  assert.equal(rollback.document.organization.name, 'Acme One');
  const invalid = (await api.draft({ document: blankDocument('acme') })).body;
  assert.equal((await api.publish(invalid.definition_version)).error, 'invalid');
  const actions = (await api.audit()).body.entries.map((e) => e.action);
  assert.deepEqual(actions.slice(-4).reverse(), ['definition.drafted', 'definition.replaced', 'definition.reviewed', 'definition.published']);
});
