# Design

## Context

See `proposal.md` for motivation and `specs/conveyor-local-agent-runner/spec.md` for the contract.

Conveyor already has a local-CLI pattern: `ClaudeCodeAgentHost`, `CodexAgentHost`, and `CursorAgentHost` start a host process, write the prompt to stdin, parse line-delimited output, and let the agent edit the task worktree directly. The OpenShell `maki-osa` path is deliberately different: it syncs a worktree into a retained sandbox and applies a patch.

osa is OpenShell-only. Its helpers rely on `openshell sandbox upload/download/exec`; there is no “managed local” mode in the front-end helpers. A local Conveyor mode therefore cannot reuse `maki-oss`/`opencode-oss`; it must start the host CLI directly.

## Goals / Non-Goals

**Goals:**

- Add local Maki and OpenCode as first-class Conveyor runner modes.
- Reuse the existing local-host runner loop, worktree, diff, and unsafe-mode policy.
- Keep `maki-osa` and every osa helper unchanged.
- Make the safety difference visible: local modes are unsafe and opt-in.

**Non-Goals:**

- Adding `opencode-osa`, `claude-osa`, `codex-osa`, or `pi-osa`.
- Building a local sandbox, container, or GeoFront path for Maki/OpenCode.
- Supporting `maki`/`opencode` analytics tasks in this change. The existing analytics allowlist stays as it is; a later change can add local analytics if needed.
- Adding per-mode unsafe allowlists. `UnsafeMode` stays global for this change.
- Changing osa provider/profile, image, policy, or caller-contract behavior.

## Decisions

### D1. New local modes, not a flag on `maki-osa`

Use `AgentModes.Maki = "maki"` and `AgentModes.OpenCode = "opencode"`. `maki-osa` remains the OpenShell mode. This preserves the existing rule that the mode string identifies both the agent and the execution place; `AgentKinds.Of`, routing, metrics, and the UI keep working without passing a profile object through every call.

Alternative rejected: one `maki` mode with a “use OpenShell” flag. It would make `AgentKinds.Of(mode)` insufficient and require profile-aware changes across routing, metrics, and UI.

### D2. Local hosts follow the existing Claude/Codex host pattern

`MakiAgentHost` and `OpenCodeAgentHost` implement `IAgentHost`, use `AgentCliRunner` for stdin/stream/error handling, and start the process in the Conveyor worktree. They do not use `MakiOsaWorkspaceStore`, `sync-in`, `collect-patch`, `git apply`, or OpenShell.

- Maki args: `--print --yolo --trust --output-format stream-json --verbose`, `--model`, `--resume`, `--fork-session`.
- OpenCode args: `run --standalone --auto --format json`, `--model`, `--session` when resuming.
- Both use `ProcessRunner.CreateStartInfo` with the configured executable.
- Cancellation uses the existing `AgentCliRunner` kill path. No stop-file protocol is needed because there is no retained remote process.

### D3. Maki reuses the Claude parser; OpenCode gets its own

Maki’s stream-json is already parsed by `ClaudeStreamParser` and is covered by the existing Maki fixture. Keep that parser.

OpenCode’s `--format json` stream is different: events are `step_start`, `text`, `tool_use`, `step_finish`, and `error`, with a top-level `sessionID`; `step_finish.part` carries `tokens` and `cost`. Add `OpenCodeStreamParser` with:
- session id from the first event;
- final text from the last completed `text` event;
- tool events from `tool_use.part`;
- token/cost accumulation from `step_finish.part`;
- `HasResult` on the final `step_finish`, with `error` setting `IsError`.

Alternative rejected: treating non-JSON as opaque output. Conveyor needs the session id and result text for plan/review parsing and session continuation.

### D4. Unsafe mode stays the existing global gate

Both modes return false from `AgentModes.IsSafe` because they are neither isolated nor simulated. `RunnerAccessPolicy` already hides unsafe runners, and `RunnersPage` already shows the warning. No new setting is introduced.

Consequence to document: enabling `UnsafeMode` also permits the other local modes (Claude, Codex, Cursor). A per-mode allowlist is a separate product decision.

### D5. Worktree and diff boundary stays the same

Local agents edit the Conveyor worktree directly. After a completed run, `RunnerWorker` collects the diff through the existing path. The runner does not commit or push; the human does. There is no patch application and therefore no “agent edits only arrive as a patch” guarantee for these modes.

### D6. Session semantics follow the host CLI

- Maki: `--resume <id>` and `--fork-session` as in the existing Maki arguments.
- OpenCode: `--session <id>` for resume; no continue-latest flag because Conveyor always supplies an exact session id; no fork flag.
- If Conveyor requests a fork for OpenCode, start fresh rather than pretending the session was forked. This matches `CodexAgentHost`’s handling of an unsupported fork.

### D7. Credentials are the host CLI’s responsibility

Conveyor passes only the model and session selection. It does not inject API keys or provider tokens. Local Maki uses the host’s Maki configuration/auth; local OpenCode uses the host’s OpenCode config/auth. `Runner:MakiImage`, `MakiProvider`, `MakiGateway`, `MakiOssExecutable`, and the osa provider settings are not consulted by local modes.

Proxy handling: do not add a Maki/OpenCode endpoint to `AgentProxy` in this change. The CLIs inherit the host environment (`HTTPS_PROXY`, system configuration) and their own provider settings. A later change can add explicit proxy selection if a real need appears.

### D8. UI uses the existing agent × place model

Add local places for Maki and OpenCode; keep Maki’s existing OpenShell place. Do not add an OpenCode OpenShell place until `opencode-osa` exists. Add `OpenCode` to `AgentKinds` and labels; Maki already exists.

### D9. Analytics and self-check stay conservative

Local modes are unsafe, so self-check commands run on the host exactly as they do for local Claude/Codex/Cursor. This is existing unsafe-mode behavior, not a new boundary.

Analytics remains limited to the modes already supported by `RunnerWorker.ExecuteAnalyticsRunAsync`. Local Maki/OpenCode are not added to that allowlist in this change. A local analytics run would otherwise need a separate decision about the task folder and product-code workspace.

## Risks / Trade-offs

- **Host compromise** — `--yolo` / `--auto` give the agent broad access. Mitigation: the existing global `UnsafeMode` gate, explicit UI warning, and documentation. This is the accepted cost of the feature.
- **Global unsafe gate is broader than these two modes** — enabling it also allows local Claude/Codex/Cursor. Mitigation: document it; per-mode allowlists are a separate change.
- **OpenCode background service** — without `--standalone`, OpenCode starts a long-lived service and writes `service.json`. Mitigation: always pass `--standalone`.
- **Cancellation leaves descendants** — `AgentCliRunner` kills the direct process; tool subprocesses may survive. Mitigation: reuse the existing local-host cancellation behavior; a process-group kill is a separate improvement.
- **OpenCode event schema drift** — the parser is pinned to the installed CLI. Mitigation: parser fixture tests and an explicit version in the task notes; unknown events fall back to output rather than crashing.
- **Maki local auth/model drift** — local Maki may not be authenticated or may use a different provider than the model. Mitigation: fail with the CLI’s stderr, as the existing local hosts do.
- **Session storage differs from OpenShell** — local sessions live in the host CLI’s state, not the retained sandbox. Mitigation: document that moving a task between local and `maki-osa` does not carry the conversation.
- **Windows** — not explicitly restricted. Maki/OpenCode availability and behavior on Windows must be verified during implementation; if unsupported, the host should fail with the CLI error rather than adding a new platform gate.

## Migration Plan

1. Add modes and hosts behind the existing unsafe gate; no data migration.
2. Add parser and host tests; verify `maki-osa` tests are unchanged.
3. Add UI labels and routing mappings.
4. Run `dotnet build`, `dotnet test`, and `npm --prefix web run build`.
5. Update `docs/progress.md` and the runner documentation.
6. Rollback: remove the two modes and hosts; `maki-osa` and all osa state remain untouched.

## Open Questions

None that change the spec or task breakdown. The exact OpenCode event fixture and the Maki/OpenCode versions will be captured during implementation.
