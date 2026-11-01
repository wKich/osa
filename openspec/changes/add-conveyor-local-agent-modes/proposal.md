# Proposal

## Why

Conveyor can already run Claude Code, Codex, and Cursor as local CLI agents, but Maki and OpenCode are only available through the OpenShell `*-osa` modes. Users who already have a host `maki` or `opencode` installation and do not want to run an OpenShell gateway need a local runner path for them. Conveyor already has an explicit `UnsafeMode` gate for exactly this case: a local agent runs with the user's files, credentials, and network, so it must be opt-in and hidden by default.

## What Changes

- Add two Conveyor runner modes: `maki` (local Maki CLI) and `opencode` (local OpenCode CLI).
- Add `MakiAgentHost` and `OpenCodeAgentHost` that run the CLI headless in the task worktree, with the prompt on stdin, and reuse Conveyor's existing `AgentCliRunner` loop.
- Reuse `ClaudeStreamParser` for Maki. Add `OpenCodeStreamParser` for `opencode run --format json`.
- Mark both modes unsafe: they are not isolated, require `DeveloperSettings.UnsafeMode`, and are hidden by `RunnerAccessPolicy` while it is off.
- Add the local place for Maki and OpenCode to the runner-profile UI, routing agent kinds, and labels. `maki-osa` remains unchanged; `opencode-osa` is out of scope.
- Do not change osa helpers, sandbox policy, provider profiles, or the OpenShell path. This change deliberately uses the host CLI instead of OpenShell.

## Capabilities

### New Capabilities

- `conveyor-local-agent-runner`: local Maki and OpenCode execution in Conveyor, gated by `UnsafeMode`, with host CLI arguments, stream parsing, cancellation, and the existing worktree/diff boundary.

### Modified Capabilities

None. The existing `conveyor-maki-osa-runner` behavior is unchanged.

## Impact

- Conveyor repository:
  - `src/Conveyor.Domain/RunnerProfile.cs` (modes, `IsKnown`, `IsSafe`)
  - `src/Conveyor.Domain/PipelineRoute.cs` (`AgentKinds.OpenCode`, `Of`, `ModeFor`)
  - `src/Conveyor.Runner/RunnerOptions.cs` (`MakiExecutable`, `OpenCodeExecutable`)
  - `src/Conveyor.Runner/RunnerWorker.cs` and `src/Conveyor.Runner/Program.cs` (host selection, version detection, analytics dispatch)
  - new `MakiAgentHost`, `OpenCodeAgentHost`, `OpenCodeStreamParser`
  - `web/src/lib/api.ts`, `web/src/lib/safety.ts`, `web/src/pages/RunnersPage.tsx`, `web/src/components/RouteEditor.tsx`
  - tests and `docs/progress.md`
- osa: no code, helper, image, policy, or provider change. The existing `maki-oss`/`opencode-oss` OpenShell paths stay the recommended isolated option.
- Security: local Maki runs with `--yolo` and local OpenCode with `--auto`; neither is a security boundary. The change is accepted only behind Conveyor's global unsafe-mode gate. Credentials live in the host CLI configuration, not in OpenShell provider profiles.
