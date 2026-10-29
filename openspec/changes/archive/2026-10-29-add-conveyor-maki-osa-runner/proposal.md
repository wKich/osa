# Proposal

## Why

The osa change `add-maki-conveyor-caller` publishes the caller contract that lets Conveyor drive a Maki pass through `maki-oss`, but Conveyor has no Maki runner mode, host, or launcher to use it. Conveyor can only run Claude, Codex, Cursor, or its simulator, so the osa-side M1 contract currently has no consumer. This change records the Conveyor half of M1: a `maki-osa` runner mode that runs the developer pass in an OpenShell sandbox, with the existing Conveyor pipeline and host-side commit boundary intact.

The implementation lands in the Conveyor repository (`/Users/ki/Projects/kontur/conveyor.ai`); this OpenSpec change is the cross-repo planning record, because Conveyor has no OpenSpec root.

## What Changes

- Add a `maki-osa` Conveyor agent mode, known to the domain and safe by construction because the agent runs in OpenShell rather than on the runner host. The mode is refused on Windows.
- Add a `MakiOsaAgentHost` and an OSA launcher that run the caller sequence for one developer pass: `maki-oss up`, `sync-in` the task worktree, `maki-oss run -` with the prompt on stdin, `collect-patch`, apply the patch to the host worktree, then remove the sandbox.
- Map Conveyor's developer role to Maki's flags only: `--model`, optional `--disallowed-tools`, and `--resume`/`--fork-session`. Do not pass Claude-only `--permission-mode`, `--allowedTools`, `--add-dir`, or `--effort`.
- Reuse `ClaudeStreamParser` for Maki's one-shot stream-json and add a captured Maki stream fixture test. Add a new parser only if the fixture proves a shape Conveyor cannot read.
- Make cancellation real: always run with an in-sandbox timeout and `MAKI_OSS_RUN_TAG`; on cancel create the helper's stop file, then remove the sandbox. Killing the local helper alone does not stop the remote process.
- Add runner configuration for the `maki-oss` executable, image, provider, gateway, and sandbox/workdir naming; add the minimum UI mode label and safe-mode treatment needed to select the runner.
- Out of scope: read-only roles and reviewer flows (M2), self-check in the sandbox (M3), analytics and conversation flows, full Maki routing/limits/usage UI, Windows/WSL, and any osa-side change.

## Capabilities

### New Capabilities

- `conveyor-maki-osa-runner`: a Conveyor runner mode that executes one Maki developer pass in an OpenShell sandbox through the osa caller contract, preserving the host-side worktree and the human commit boundary.

### Modified Capabilities

None.

## Impact

- Conveyor repository: `src/Conveyor.Domain/RunnerProfile.cs`, `src/Conveyor.Domain/PipelineRoute.cs`, `src/Conveyor.Runner/RunnerOptions.cs`, new host/launcher under `src/Conveyor.Runner/Agents/`, `src/Conveyor.Runner/RunnerWorker.cs`, `src/Conveyor.Runner/Program.cs`, `tests/Conveyor.Domain.Tests/`, and `web/src` mode labels.
- Runner host: `maki-oss`, the OpenShell CLI and gateway, the `maki-agent:local` image, and a Maki provider profile must exist. No host bind mount and no model key in `--env`.
- Consumers: the Conveyor orchestrator continues to treat the runner as one agent host; `GitWorkspace` keeps commit and push on the host.
- Upstream contract: `add-maki-conveyor-caller` in this repository.
