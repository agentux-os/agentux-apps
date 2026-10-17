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

## Status

Office MVP is available at [`apps/office`](apps/office). It uses a typed
`CommandApi` adapter for the remote projection and keeps a deterministic
`FixtureApi` for demos without a server. Runtime configuration is supplied by
`window.AGENTUX_OFFICE_CONFIG` (for example `{ commandUrl, token,
organizationId }`); credentials are never embedded in the source.

The adapter preserves the distributed contract's `organizationId`,
`definitionVersion`, `projectedAt`, `freshness`, `source` and `lastEventId`.
It distinguishes ready, stale, empty, degraded and error states, and keeps
approval conflicts typed instead of converting a failed mutation into success.
Approval submissions include the configured `organizationId`, so Command can
scope idempotent retries to the organization and approval. Keep this identifier
aligned with the authenticated session when production sessions are enabled.
Operational drill-down is tracked in [#5](https://github.com/agentux-os/agentux-apps/issues/5);
accessibility and reliability hardening in [#6](https://github.com/agentux-os/agentux-apps/issues/6).

```sh
npm test
npm run serve
# open http://127.0.0.1:4173
```

