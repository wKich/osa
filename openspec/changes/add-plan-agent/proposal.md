# Proposal

## Why

`agent-switch-state` was recorded `degraded`/pin on the grounds that the
pinned Maki wire has no `set_agent`, so the bridge listed one agent and
never re-tasked the child. Scripting `switch-agent` showed the reference's
two primary agents, `build` and `plan`, against the bridge's one. Reading
Maki v0.6.4 again: its SDK's `set_permission_mode` accepts `plan`
(`src/sdk_mode.rs` L77–L111, L846–L860), and each user message runs in
`AgentMode::Plan` or `AgentMode::Build` from the mode at that moment
(L688–L696). Maki's plan mode lets file writes reach only the plan file
(Maki docs `commands/_index.md` L52, `permissions/_index.md` L52). That is
the counterpart of OpenCode's `plan` agent; the pin was wrong.

## What Changes

- `/api/agent` lists `build` and `plan` with Maki's own descriptions.
- A selection sends `set_permission_mode` (`plan`, or for `build` the mode
  the child reported on `system.init`, so a yolo configuration stays
  bypassed); it emits the durable `session.agent.selected` and an
  `agent-switched` history row (core `session/message-updater.ts` v2.0.32
  L91–L103); a refused mode restores the previous agent. A session created
  as `plan` starts in plan mode. An agent with no Maki mode is refused.
- The create response reports the session's agent.
- The scripted child acks `set_permission_mode` and reports its mode on
  `system.init`, as the pinned child does.
- `agent-switch-state`: `verified`, `blockedBy: "none"`. `switch-agent`:
  recorded, `parity` offline and live.
- The boot-surface spec's server-info scenario is corrected: since
  `add-sandbox-terminals` it reports `persistentPty: true` with a sandbox.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: boot surface (agent list, server info scenario);
  the agent-selection requirement renamed and rewritten.

## Impact

`bridge/src/{bridge,history,maki,spec-answers,translator}.ts`, tests, the
fake child, statuses and journeys.
