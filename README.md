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

Operational drill-down is tracked in [#5](https://github.com/agentux-os/agentux-apps/issues/5);
accessibility and reliability hardening in [#6](https://github.com/agentux-os/agentux-apps/issues/6).
