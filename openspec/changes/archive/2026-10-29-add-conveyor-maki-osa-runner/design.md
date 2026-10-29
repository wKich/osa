# Design

## Context

See `proposal.md` for motivation and `specs/conveyor-maki-osa-runner/spec.md` for the contract. Conveyor's current runner architecture:

- `RunnerWorker.ExecuteAgentRunAsync` chooses an `IAgentHost` by `AgentModes` (`RunnerWorker.cs:135`). Each host prepares a `ProcessStartInfo`, and `AgentCliRunner` writes the prompt to stdin and feeds stdout lines to an `IAgentStreamParser`.
- `ClaudeCodeAgentHost` runs `claude` directly in the task worktree. `AgentDockerLauncher` and `AgentGeofrontLauncher` wrap the same CLI in an isolated environment.
- `RunnerAccessPolicy` blocks modes for which `AgentModes.IsSafe` is false unless `UnsafeMode` is on.
- `AgentKinds` (`PipelineRoute.cs:5`) is the routing/accounting dimension; `AgentSettings` carries only Mode, Model, WSL, GeoFront, and Effort fields, all supplied by the server profile.
- `GitWorkspace` owns the host worktree, and Conveyor commits and pushes only on a human action.
- The osa caller contract (`add-maki-conveyor-caller`) is: `maki-oss up`, `sync-in`, `maki-oss run - -- ...`, `collect-patch`, `rm`; prompt on stdin; stream-json; `--disallowed-tools` and `--fork-session` only; `--permission-mode` and `--allowedTools` refused.

## Goals / Non-Goals

**Goals:**

- One vertically working developer pass on a `maki-osa` runner, selectable from a runner profile, with the same task/worktree lifecycle Conveyor uses for other agents.
- The host worktree is changed only by a patch that applied cleanly; Conveyor's commit/push buttons keep working unchanged.
- Cancellation and failure are explicit and leave no live sandbox.

**Non-Goals:**

- Reviewer, planner, analyst, and other roles; M2 owns those.
- A warm sandbox reused across rework iterations; M1 creates one sandbox per run.
- Self-check inside the sandbox (M3).
- Full Maki first-class routing: model catalog, route optimizer, limits poller, analytics, conversations.
- Windows/WSL; the mode is macOS/Linux only.
- Any change in the osa repository.

## Decisions

### A separate host that orchestrates the helper, not a launcher that wraps one process

`MakiOsaAgentHost` runs the sequence itself: prepare the host worktree, `up`, `sync-in`, start `maki-oss run -`, parse with `AgentCliRunner`, `collect-patch`, check and apply, clean up. `AgentCliRunner` still owns the prompt-on-stdin and line-parser loop, so Maki uses the same failure/usage logic as Claude, Codex, and Cursor.

- **Alternative: extend `ClaudeCodeAgentHost` with a mode branch.** It would mix a different process lifecycle into a host built around one CLI process and make the role mapping harder to reason about.
- **Alternative: `AgentOsaLauncher` only.** A launcher cannot own `sync-in` or `collect-patch`, which are separate helper invocations.
- The old M1 design used a thin `AgentOsaLauncher` for `claude-osa`; Maki needs one extra layer because the helper owns the workspace transport rather than the CLI alone.

### `maki-osa` is one new safe mode, not a variant of `claude-osa`

The mode classifies as safe because the agent runs in OpenShell, like `claude-docker` and `claude-geofront`. It is a distinct mode because Maki, not Claude, is the agent and its argv and permissions differ.

- Add `AgentModes.MakiOsa`, `IsMakiOsa`, and include it in `IsKnown`, `IsIsolated`, and `IsSafe`.
- Add `AgentKinds.Maki`, `AgentKinds.IsMaki`, and the `Of`/`ModeFor`/`All` mappings so routes, cost records, and the runner card can name the agent. `SupportsEffort` stays false for Maki.
- Refuse the mode on Windows in the host before any helper call; Conveyor's other isolated modes use WSL, but OpenShell is a host-level macOS/Linux runtime.

- **Alternative: reuse `AgentKinds.Claude`.** It would misattribute cost and show Claude in the UI.
- **Alternative: a general isolation dimension now.** That is C1.1's broader change; this slice classifies one mode and leaves the model intact.

### Runner-local configuration, not profile fields

`RunnerOptions` gains `MakiOssExecutable`, `MakiImage`, `MakiProvider`, `MakiGateway`, `MakiEngine`, and `MakiSandboxPrefix`. The server profile carries only the existing `Mode` and `Model`; sandbox transport is a property of the machine, like `ClaudeExecutable` and `ClaudeDockerRoot`.

- Sandbox name is `<prefix>-<runId[..8]>` and the workdir is `/sandbox/tasks/<runId[..8]>`, both literal because caller mode refuses pattern names.
- The helper environment is `MAKI_OSS_WORKSPACE=caller`, `MAKI_OSS_IDLE_STOP=0`, `MAKI_OSS_SANDBOX_NAME`, `MAKI_OSS_WORKDIR`, `MAKI_OSS_RUN_TAG`, and the optional executable path. The provider is passed to `up` with `--provider`; no credential value is passed.
- `AgentSettings` stays unchanged, so the runner/server contract does not grow for M1.

- **Alternative: put sandbox fields in `AgentSettings`.** That would let the server choose a gateway/image per task before the runner's environment is known, and it expands the SignalR contract for one mode.

### Developer role mapping is deliberately narrow

The Maki developer command is fixed as `maki --print --yolo --trust --output-format stream-json --verbose`, plus `--model`, the resume/fork flags, and optionally `--disallowed-tools`. `--permission-mode`, `--allowedTools`, `--add-dir`, and `--effort` are never emitted.

- Maki's one-shot path has no `--permission-mode`, and YOLO makes an allow list non-restrictive. Deny rules are the only effective tool control, and they take tool names, not bash command patterns.
- The developer role's "no commit/push/reset" rule is enforced by Conveyor's host-side patch workflow, not by an in-sandbox git deny. The sandbox workdir has no repository and `collect-patch` ignores any `.git` the agent creates.
- **Alternative: generate a project `permissions.toml` for command-scoped denies.** That is an M2 concern when read-only roles need it; generating config into every developer snapshot adds a file that can leak into the patch.

### Reuse `ClaudeStreamParser`, prove it with a Maki fixture

Maki's one-shot events use the same top-level types and result fields. The parser already ignores unknown event types and content blocks (for example `stream_event` and `thinking`). The change adds a captured Maki stream to `ClaudeStreamParserTests` and only forks the parser if that test shows a mismatch.

- **Alternative: a `MakiStreamParser` now.** It duplicates the Claude parser before there is evidence of a difference.
- **Alternative: SDK mode (`--input-format stream-json`).** Conveyor's host is one-shot and writes one prompt; Maki's bidirectional SDK mode would add a control channel Conveyor does not need.

### Cancellation always goes through the wrapper

Every run passes `--timeout` and `MAKI_OSS_RUN_TAG`. On cancellation the host creates `/tmp/maki-oss-stop/<tag>` inside the sandbox, then kills the local helper, then removes the sandbox. OpenShell 0.1.5 does not stop a remote process when the local `sandbox exec` client dies, so killing the helper alone is not cancellation.

- The timeout is a safety net even when the user never presses stop.
- Cleanup is best-effort `rm`; a failed removal leaves an orphan that the next run's unique name does not collide with.
- **Alternative: `openshell sandbox exec pkill`.** The helper documents that another exec cannot read the run's environment to identify its processes; the stop file is the supported path.

### Patch application is fail-closed

`collect-patch` writes a mode-600 temporary file. The host runs `git apply --check`, then `git apply`, and deletes the file. An empty patch is a normal completion with no apply. A failed check fails the run and leaves the worktree untouched.

- **Alternative: download the whole worktree.** It would delete ignored host files such as `bin/` and `node_modules`.
- **Alternative: commit inside the sandbox.** It breaks Conveyor's human-commit model and would require pulling a git repository into the sandbox.

## Risks / Trade-offs

- **Maki's stream shape differs from the captured fixture in a future version** → Pin the image version, keep the fixture test, and add a version note to the runner docs.
- **Per-run sandbox creation and full upload are slow on large repositories** → Measure time-to-first-event; M1 accepts it. A warm sandbox and incremental sync are M2/M4 work.
- **A `maki-osa` runner appears as an unknown agent in parts of the UI** → Add the minimal Maki kind and labels now; analytics, conversation, limits, and route optimization can remain Claude/Codex-only and must fail explicitly rather than silently.
- **Command-scoped git denies are not available in Maki's CLI deny list** → Keep the host-side patch/commit boundary and document that the sandbox has no repository; do not claim an in-sandbox git rule.
- **A killed helper leaves a live sandbox** → Always use the run tag/stop-file path and best-effort `rm`; orphan sandboxes have unique names.
- **The runner host lacks osa prerequisites** → Fail with the missing stage (helper, gateway, image, provider) before starting the agent; do not fall back to a local Maki process.
- **Two runs exhaust the gateway or the image pull** → Unique sandbox names and the existing `MaxConcurrentRuns` limit; a warm pool is later work.

## Migration Plan

1. Land the Conveyor slice after `add-maki-conveyor-caller` is applied in osa; the host can be written against the contract in parallel, but the live demo needs the osa change.
2. Add the mode and kind first, then the host and argv mapping, then cancellation and patch application; keep the simulator and Claude paths unchanged.
3. Verify with `dotnet build Conveyor.slnx`, `dotnet test`, and `npm --prefix web run build`; run a live developer task on macOS with a provider-bound `maki-agent:local`.
4. Rollback is the previous Conveyor commit; osa and existing sandboxes are unaffected. Removing the mode from profiles is a server-side data change only.

## Open Questions

- Whether the first demo pins one runner and one task template, avoiding route-optimizer and model-catalog work. If it does, the minimal `AgentKinds.Maki` entry is enough; full Maki routing stays a later slice.
- Whether the sandbox should be reused for the developer/rework pair. M1 creates one per run; the answer changes sandbox naming and cleanup, not the helper contract.
