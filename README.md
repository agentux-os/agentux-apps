# AgentUX Apps

<p align="center">
  <a href="https://agentuxos.org">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/agentux-os/agentux/main/brand/svg/lockup-dark.svg">
      <img alt="AgentUX" src="https://raw.githubusercontent.com/agentux-os/agentux/main/brand/svg/lockup-light.svg" width="320">
    </picture>
  </a>
</p>

<p>
  <a href="https://github.com/agentux-os/agentux-apps/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/agentux-os/agentux-apps?label=updated&labelColor=0b0d10&color=4f7d0b"></a>
  <a href="https://github.com/agentux-os/agentux-apps"><img alt="Top language" src="https://img.shields.io/github/languages/top/agentux-os/agentux-apps?label=language&labelColor=0b0d10&color=4f7d0b"></a>
  <a href="https://agentuxos.org"><img alt="Website" src="https://img.shields.io/badge/website-agentuxos.org-c6f36b?labelColor=0b0d10"></a>
</p>

AgentUX Apps contains the web experiences for the AgentUX platform.

The repository is continuously checked by its package scripts. It is not a release artifact: the current web experience follows the `main` branch and consumes the versioned contracts exposed by [AgentUX Command](https://github.com/agentux-os/agentux-command) and [AgentUX Protocol](https://github.com/agentux-os/agentux-protocol).

The first application is the remote AgentUX Command experience. It includes AgentUX Office: a visual 2D command center that projects real organizational state, missions, agents, runs and incidents for leadership.

## Command console

`apps/command` is the fleet console for operators: every node with its state, agents (signed in, versions, plan usage, usage limits), spending and runs; per node, test an agent, lift a limit, cancel a run or answer an approval; for several nodes at once, test an agent, lift a limit or push agent preferences (held at each node for someone there unless its policy allows it). It issues enrollment tokens, with ready provision files for new VMs, and approves or revokes enrolled nodes. `npm run serve:command` serves it on port 4174 with demo data, or against a Command server with `COMMAND_URL` and `COMMAND_TOKEN` (an operator token with `node.command` and `node.enroll`).

## Releases and CI, per app

Each app has its own version (`apps/<app>/VERSION`), CI and release:

| App | Workflow | Tag | Release |
|---|---|---|---|
| Office (`apps/office`: floor and editor) | `office.yml`: unit and browser tests, bundle, image | `office-v<version>` | `agentux-office-<version>.tar.gz` (+ `.sha256`) on a GitHub release; `ghcr.io/agentux-os/agentux-office:<version>` |
| Command console (`apps/command`) | `console.yml`: tests, bundle | `console-v<version>` | `agentux-console-<version>.tar.gz` (+ `.sha256`) on a GitHub release |

A pull request runs only the workflows of the apps it touches. `npm run bundle -- office` (or `command`) builds a bundle locally into `dist/`: the app's static files without tests, reproducible (sorted, fixed owner and time). The Office image serves the app and passes `/v1/` to Command (`COMMAND_URL`, `COMMAND_ORGANIZATION`, `COMMAND_TOKEN` from a secret), as `npm run serve` does:

```sh
podman run -p 4173:4173 -e COMMAND_URL=http://command:8080 -e COMMAND_ORGANIZATION=acme   --secret office-token,type=env,target=COMMAND_TOKEN ghcr.io/agentux-os/agentux-office:0.1.0
```

## Planned layout

```text
apps/
  command/       remote control plane UI
  office/        2D organization and operations view
packages/
  ui/            shared AgentUX components and tokens
  protocol/      generated client types when the contract stabilizes
```

Office is a visualization and interaction surface, not an execution engine. The source of truth remains AgentUX Command for organizational state and AgentUX Core for local technical execution.

## Product boundaries

- `agentux-command` owns the remote server and product state.
- `agentux-apps` owns browser interfaces and shared UI.
- `agentux-desktop` remains the local Tauri cockpit.
- `agentux-core` remains the local runtime and node execution layer.

## Office

`apps/office` is AgentUX Office: an organization as AgentUX Command sees it,
for its leaders.

- **Floor**: the organization's nodes (reporting or not), agents and runs (a
  node's runs and mission runs), filtered by area, mission and status.
- **Metrics**: work in motion, what is blocked, approvals waiting, and nodes
  reporting.
- **Timeline**: what happened, newest first, and who did it.
- **Decision queue**: pending approvals, decided through Command. A gate a
  person must pass refuses service tokens, expired approvals cannot be
  decided, and every outcome is said plainly (recorded, not allowed, already
  decided, gone, Command unavailable).
- **Live**: after loading the projection, Office follows the organization's
  event stream (`/v1/organizations/<org>/events/stream`) from its last event
  and reloads the projection as events arrive. The header says whether the
  stream is live or reconnecting, and a banner says when the projection is
  stale (no node reports), degraded (some do not), empty, denied or
  unavailable. Office retries on its own while Command is unavailable.

```sh
npm test
npm run serve            # demo data, http://127.0.0.1:4173
COMMAND_URL=https://command.example COMMAND_TOKEN=auxs1_... COMMAND_ORGANIZATION=acme npm run serve
```

With `COMMAND_URL`, `serve-office` passes `/v1/` requests to Command and adds
`COMMAND_TOKEN` (`organization.read`, plus `approval.decide` to decide), so the
token never reaches the browser and the event stream works. On Command's own
origin, Office uses the operator's session instead. `apps/office/model.js`
turns a projection into what the page shows, and `apps/office/api.js` talks
to Command. Both are tested (`api.test.mjs`, `model.test.mjs`): loading,
empty, stale, degraded, denied, unavailable and populated states, approval
outcomes, and the live stream.

### Organization editor

`apps/office/editor.html` (linked from the floor) is where leaders change the
organization: its name and publication policy, areas, roles and their
permissions, agents and their roles, missions, approval gates, and workflows
step by step. It edits drafts in AgentUX Command
([organization definitions](https://github.com/agentux-os/agentux-command#organization-definitions)):

- **Problems** are shown as you type: missing or duplicate ids, references to
  roles, areas, missions or gates that do not exist, a step going outside its
  workflow, unknown permissions, a human-required gate no human role can pass.
  These are Command's checks, and Command checks again on save and publish.
- **Changes** from the published version: added, removed and changed areas,
  roles, agents, missions, gates and workflow steps, field by field.
- **Saving** sends the revision you edited (`If-Match`). If someone saved the
  draft in between, the editor says so, keeps your changes on screen, and
  offers to load theirs. Nothing is silently overwritten.
- **Review**: someone else (with `approval.decide`) approves a revision or asks
  for changes. When the organization's publication policy is
  `review-required`, only an approved revision can be published, and a later
  save needs a new approval.
- **Publishing** freezes the version: Command runs missions from it and Office
  shows it. **History** lists every version. A new draft starts from the
  published version, or from any earlier one, which is how a rollback is
  done.
- Without `organization.edit` the editor is read-only, and every refusal from
  Command is explained.

With `serve-office` it uses the same proxy as the floor. The proxy forwards
`If-Match` and `ETag`, and `scripts/serve-office.test.mjs` checks that it does.
Without `COMMAND_URL` it works on demo data with the same rules
(`createFixtureDefinitionsApi`).

**Drill-down**: every desk, event and approval opens its detail in a modal, and the
address (`#/run/<id>`, `#/node/<id>`, `#/mission/<id>`, ...) links straight to
it. A detail shows what the projection knows (never a guessed value), links to
related areas, missions, runs, nodes and approvals, and the entity's events
from the organization's log (last 7 days). For an event, it shows the events
of its chain (same `correlationId`, or caused by it). Missing artifacts, a
stale projection, an offline node and an unavailable log are each said. Desks
are links (Tab, Enter). The modal keeps focus inside, and Escape, Close or
a click outside closes it and leaves its address. **Deciding** an approval
asks first, in a modal: what is decided, and an optional reason recorded with
the decision. **Publishing** in the editor first shows the changes from the
published version in a modal.

**Dependable**:
- **Accessible**: errors are announced as alerts and other states as status.
  Desks, events and approvals work from the keyboard, focus moves to what
  opens, and axe finds no serious or critical problem on the floor, a detail
  or the editor (checked in CI).
- **Decisions**: a decision is sent once, however often it is pressed, and
  never retried by itself. The same decision always carries the same
  idempotency key, so retrying by hand is safe. 401, 403, 409 and 503 each say
  what happened.
- **Large organizations**: the floor draws 300 desks at a time and says how
  many more there are. Filters reach the rest. The model handles 12,500 desks
  within a test budget.
- **Command unavailable**: Office retries after 2 s, doubling up to a minute
  with jitter, and says when it will try again.
- **Languages**: English and Brazilian Portuguese, following the browser
  (`config.locale` overrides).
- **Metrics**: `agentuxOffice.metrics` in the console: loads, failures, load
  and render times, reconnects, decisions. Nothing leaves the browser.

```sh
npx playwright install chromium   # once
npm run test:browser              # Office in Chromium against a fake Command
```
