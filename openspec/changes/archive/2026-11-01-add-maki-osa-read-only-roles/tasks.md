# Tasks

Implementation target: `/Users/ki/Projects/kontur/conveyor.ai`. This osa change records the cross-repository workaround; no osa helper or policy behavior changes.

## 1. Read-only roles

- [x] 1.1 Add the read-only role allowlist and replace the developer-only gate in `MakiOsaAgentHost.RunAsync`. Verify a `reviewer` run reaches the helper and a `speceditor` run fails before the helper. (`dotnet test --filter FullyQualifiedName~MakiOsaRunnerTests`)
- [x] 1.2 Skip `collect-patch` and `git apply` for read-only roles after termination confirmation, emit a status event, and return the agent outcome. Verify a non-empty fake patch leaves the host worktree unchanged and the log has no `collect-patch`. (`Host_ReadOnlyRolesRunWithoutCollectingOrApplyingChanges_AndKeepTheSandbox`)
- [x] 1.3 Keep unsupported roles refused before any helper call: `speceditor`, `contextcollector`, `specanalyst`, `selfcheck`. Verify no helper log is created. (`Host_RefusesUnsupportedRoles_WithoutStartingTheHelper`)
- [x] 1.4 Keep the developer path unchanged. Verify the existing patch, empty-patch, and apply-failure tests pass. (`dotnet test --filter FullyQualifiedName~MakiOsaRunnerTests`)
- [x] 1.5 Run the full Conveyor suite and web build; record the counts in this change before archive. `dotnet test` passed 700/700; `npm --prefix web run build` passed.

## 2. Documentation

- [x] 2.1 Record this workaround in Conveyor's `docs/progress.md` and the Maki runner/E2E notes: read-only roles do not collect or apply patches; the prompt is the only instruction; sandbox-state residue outside the workdir is accepted until a dedicated change.

Follow-up outside this change: an ephemeral review sandbox or a real read-only run wrapper for sandbox-state isolation. The reusable-worktree change is `add-caller-incremental-sync`.
