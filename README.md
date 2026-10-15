# AgentUX Apps

AgentUX Apps contains the web experiences for the AgentUX platform.

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

Office MVP is available at [`apps/office`](apps/office): it renders a fake
Command event stream, an office-style 2D floor, executive metrics and filters
for area, mission and status. It is intentionally remote/read-only; the next
step is replacing the fixture adapter with the Command projection API.

```sh
npm test
npm run serve
# open http://127.0.0.1:4173
```

