# Tasks

Implementation target: `/Users/ki/Projects/kontur/conveyor.ai`. This osa change records the cross-repository work; no osa helper, image, policy, provider, or sandbox behavior changes.

## 1. Domain and mode plumbing

- [ ] 1.1 Add `AgentModes.Maki = "maki"` and `AgentModes.OpenCode = "opencode"` in `src/Conveyor.Domain/RunnerProfile.cs`, include both in `IsKnown`, keep them out of `IsSafe`/`IsIsolated`, and add `IsMakiLocal`/`IsOpenCodeLocal` helpers. Verify `dotnet test --filter FullyQualifiedName~RunnersTests` covers known/unsafe/near-miss cases.
- [ ] 1.2 Add `AgentKinds.OpenCode`, include it in `AgentKinds.All`, map `maki`→Maki and `opencode`→OpenCode in `Of` and `ModeFor`, and keep `SupportsEffort` false for both. Verify the `AgentKinds` tests and a new near-miss case.
- [ ] 1.3 Confirm `RunnerAccessPolicy` hides both new modes while `UnsafeMode` is off and exposes them when it is on. Verify the existing policy tests with `maki` and `opencode` profiles.

## 2. Local Maki host

- [ ] 2.1 Add `MakiAgentHost` in `src/Conveyor.Runner/Agents/` using `AgentCliRunner` and `ClaudeStreamParser`; build argv as `--print --yolo --trust --output-format stream-json --verbose`, then `--model`, `--resume`, `--fork-session`; write the prompt only to stdin. Verify a fake-executable test asserts the exact argv, stdin prompt, session id, result text, and tokens.
- [ ] 2.2 Add `RunnerOptions.MakiExecutable` (default `maki`) and missing-executable failure handling. Verify the host fails before starting with an error naming the executable.
- [ ] 2.3 Add cancellation coverage: stop the run while the fake CLI is sleeping and verify the run finishes `stopped`, not `completed`, and no sandbox or patch path is touched. Verify with `dotnet test --filter FullyQualifiedName~MakiLocalAgentHostTests`.

## 3. Local OpenCode parser and host

- [ ] 3.1 Add `OpenCodeStreamParser` for `opencode run --format json`: `sessionID`, `step_start`, `text`, `tool_use`, `step_finish` tokens/cost, `error`, and `HasResult` on the final step. Verify fixtures for a successful run, a tool run, an error event, and a stream with no text.
- [ ] 3.2 Add `OpenCodeAgentHost` in `src/Conveyor.Runner/Agents/` using `AgentCliRunner`; argv `run --standalone --auto --format json`, then `--model` and `--session` when resuming, prompt only on stdin. Verify a fake-executable test asserts the exact argv and that no fork flag exists.
- [ ] 3.3 Add `RunnerOptions.OpenCodeExecutable` (default `opencode`) and missing-executable failure handling. Verify the host fails before starting with an error naming the executable.
- [ ] 3.4 Add cancellation coverage for OpenCode. Verify the run finishes `stopped` and the worktree is not modified by Conveyor beyond what the fake CLI wrote.

## 4. Runner integration

- [ ] 4.1 Register `MakiAgentHost` and `OpenCodeAgentHost` in `src/Conveyor.Runner/Program.cs`; select them in `RunnerWorker.ExecuteAgentRunAsync` only for their local modes. Verify a worker-level test or host-selection test reaches the expected host.
- [ ] 4.2 Add `LocalCli` version-detection cases for `maki` and `opencode`; ensure `_agentVersion` is populated or logged as missing without affecting `maki-osa`. Verify with the existing runner startup tests/log capture.
- [ ] 4.3 Keep local Maki/OpenCode out of the analytics allowlist (`AgentModes.SupportsAnalytics`) and out of `ExecuteAnalyticsRunAsync` host selection. Verify an analytics run on either mode is rejected before any host starts.
- [ ] 4.4 Ensure self-check for local Maki/OpenCode uses the existing host self-check path, not the OpenShell M3 refusal. Verify `SelfCheckExecutor` tests cover `maki`/`opencode` as non-isolated modes.
- [ ] 4.5 Ensure `RunnerWorker` does not create an OpenShell workspace lock or binding for local modes. Verify a local run with a workspace path does not write `Runner:MakiStateRoot` files.

## 5. UI and routing

- [ ] 5.1 Extend `web/src/lib/api.ts` `AgentMode` and `AgentKind` with `maki`/`opencode` (and `OpenCode` kind) and add labels in `RouteEditor.tsx`/`AGENT_LABEL` and `agentOfMode`.
- [ ] 5.2 Extend `RunnersPage.tsx` `AGENT_MODES` with “Maki локально” and “OpenCode локально”, add the local places for Maki/OpenCode, keep Maki’s OpenShell place, and do not add an OpenCode OpenShell place. Verify `npm --prefix web run build`.
- [ ] 5.3 Do not add either mode to `web/src/lib/safety.ts`; verify the unsafe warning and `RunnerAccessPolicy` behavior remain consistent.
- [ ] 5.4 Verify route resolution for a local Maki/OpenCode runner selects the matching agent kind and does not treat the mode as OpenShell.

## 6. Documentation and full verification

- [ ] 6.1 Document the two modes, their prerequisites (`maki`/`opencode` in `PATH`, host auth), the `--yolo`/`--auto` risk, the global `UnsafeMode` consequence, and the fact that sessions do not transfer between local and `maki-osa`/`opencode-osa`. Add the entry to `docs/progress.md` and the runner documentation/AGENTS.md.
- [ ] 6.2 Run `dotnet build Conveyor.slnx`, `dotnet test Conveyor.slnx`, and `npm --prefix web run build`; record the counts in this change before archive.
- [ ] 6.3 Perform a manual smoke test on a host with `maki` and `opencode` installed: save an unsafe runner profile, run a small task, verify the worktree diff, stop a run, and confirm `maki-osa` remains unaffected.
