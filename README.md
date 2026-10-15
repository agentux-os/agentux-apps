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

Architecture scaffold. The first implementation will validate read-only aggregation from multiple AgentUX nodes before adding remote dispatch or intervention.

