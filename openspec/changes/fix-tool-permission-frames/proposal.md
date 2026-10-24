# Proposal

## Why

The `allow-permission-once` pilot journey diverges offline and breaks live.
Offline, the TUI's permission dialog shows a generic `⚙ Call tool allow` /
`Tool: allow` body where the reference shows the command (`$ rm -f probe.txt`):
the bridge sends `permission.asked` with `action: "allow"`, while the pinned
TUI picks the dialog body from the action (`tui/src/util/permission.ts`
v2.0.32 L24–L144, `shell` → `$ <command>`). Live, the failed tool never
settles: the bridge's tool frames omit the `executed` boolean every pinned
tool event requires (`schema/src/session-event.ts` v2.0.32 L508–L566).

The offline side also hides real Maki's ordering: the scripted child asks for
permission before it shows the tool call, while the pinned child emits the
buffered `assistant` tool_use and the streamed tool_use block before
`can_use_tool` (`maki-agent/src/agent/run.rs` v0.6.4 L605–L608,
`src/sdk_mode.rs` v0.6.4 L1037–L1052, L1115–L1149), and answers a silent
command with `Exit code: 0` (`plugins/bash/init.lua` v0.6.4 L412).

## What Changes

- `permission.asked` (and the pending list) names the OpenCode permission
  action for the Maki tool (`Bash` → `shell`, `Task` → `subagent`, other tools
  lower-cased), lists the shell command as the resource, and lists Maki's
  generalized session scope (`<word> *`, `permissions.rs` v0.6.4 L1047–L1059)
  under `save` for a shell call.
- Tool frames carry `executed: false` (the tool runs in the Maki child, not at
  the provider) on `session.tool.called`, `session.tool.success`, and
  `session.tool.failed`.
- The scripted child's journey tool turn follows the pinned order and bash
  result text.
- Defects `permission-asked-generic-action` and `tool-events-omit-executed`
  close; `allow-permission-once` is re-recorded offline and live.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: the permission round-trip requirement names the
  permission action, resource and save pattern the TUI renders.

## Impact

- `bridge/src/bridge.ts`, `bridge/src/translator.ts`, `bridge/test/fake-maki.ts`,
  bridge tests, `bridge/defects.json`, `bridge/compat/statuses.json`,
  `bridge/compat/journeys.json`, the journey evidence, `docs/compatibility.md`.
- No sandbox, egress, credential, or image change. The `/dev/null` policy
  denial seen on the live run is a separate change.
