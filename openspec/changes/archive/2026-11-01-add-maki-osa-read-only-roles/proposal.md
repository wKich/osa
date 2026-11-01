# Proposal

## Why

The `maki-osa` runner currently refuses every role except `developer`, so the normal Conveyor pipeline cannot run Planner, Reviewer, MrWriter, and other read-only passes on the same sandboxed runner. Conveyor's prompts for those roles already instruct the agent not to change files, and the host worktree is only changed by a patch that the runner applies. For read-only roles the runner can therefore discard the sandbox patch instead of implementing a separate read-only sandbox.

## What Changes

- Accept a fixed set of read-only roles in `MakiOsaAgentHost`: `researcher`, `architect`, `decomposer`, `planner`, `mrwriter`, `dutyresponder`, `consultant`, `mrreviewer`, `testanalyst`, and `reviewer`.
- For those roles, run `up`, `sync-in`, and `maki-oss run -`, then return the agent outcome without invoking `collect-patch` or `git apply`. Any files the agent changed stay in the retained sandbox and are replaced by the next `sync-in`.
- Keep `developer` on the existing full sequence, including patch collection and application.
- Continue to refuse roles that need a different workspace or a write path: `speceditor`, `contextcollector`, `specanalyst`, `specreviewer`, and `selfcheck`.
- Do not add a read-only sandbox policy, a new helper flag, tool-deny lists, or an osa behavior change. The Conveyor role prompt is the instruction; the missing patch application is the host boundary.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `conveyor-maki-osa-runner`: add read-only role execution that never applies a patch, while preserving the developer patch lifecycle.

## Impact

- Conveyor repository: `src/Conveyor.Runner/Agents/MakiOsaAgentHost.cs` (role gate and post-run branch), `tests/Conveyor.Domain.Tests/MakiOsaRunnerTests.cs`.
- osa: no helper or policy change; the existing `sync-in` full replacement and retained-sandbox contract remain unchanged.
- Residual risk accepted for now: a read-only agent can still write outside the workdir (Maki config and session state) because the sandbox filesystem is writable. That does not reach the host or the next workdir. A later change can add an ephemeral review sandbox or real read-only execution.
