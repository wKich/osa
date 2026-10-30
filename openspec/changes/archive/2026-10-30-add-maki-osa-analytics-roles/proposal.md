# Proposal

## Why

Conveyor's analytics tasks (`speceditor`, `contextcollector`, `specanalyst`,
`specreviewer`) run in a plain folder under `Runner:AnalyticsRoot`, not in a git
worktree. The `maki-osa` runner currently accepts only the developer role and
read-only worktree roles, and the runner's analytics dispatcher accepts only
Claude and Simulated modes. As a result, the spec stages cannot run on the
sandboxed Maki runner even though the existing caller binding, `sync-in`, and
`run` path already handle ordinary directories.

## What Changes

- Accept `speceditor`, `contextcollector`, `specanalyst`, and `specreviewer`
  in `MakiOsaAgentHost` only for runs that carry an analytics run spec.
- Allow the `maki-osa` mode in the runner's analytics dispatch path, keeping the
  existing Windows, helper, gateway, image, and provider checks.
- Keep `AnalyticsFolder.PrepareAsync` and its manual-edit hash check before any
  sandbox work.
- Reuse the existing per-directory sandbox binding, `sync-in`, and `run`.
  Analytics roles SHALL NOT use `collect-patch` or `git apply`.
- After a successful `speceditor` or `contextcollector` run, copy the sandbox
  folder back with an explicit download to a temporary host directory, then
  replace only the analytics files in the host task folder. The runner's
  existing `AnalyticsFilesReady` result then carries the updated folder.
- Refuse analytics runs that request a product-code copy
  (`AnalyticsRunSpec.CodeWorkspace` is not null) with an actionable error before
  starting the helper. Passing a host code path into the sandbox is not
  supported by this change.
- Do not add a helper command, a sandbox policy change, a host bind mount, or a
  new Maki permission flag.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `conveyor-maki-osa-runner`: add analytics-folder roles, folder binding,
  file-based results, and the product-code exclusion to the Maki OpenShell
  runner.

## Impact

- Conveyor repository: `src/Conveyor.Runner/Agents/MakiOsaAgentHost.cs`,
  `MakiOsaLauncher.cs`, `RunnerWorker.cs`, `AnalyticsFolder.cs`, and
  `tests/Conveyor.Domain.Tests/MakiOsaRunnerTests.cs` (plus analytics runner
  tests where the mode gate is covered).
- osa: no helper or policy behavior change. This change is the cross-repository
  planning record and the `conveyor-maki-osa-runner` spec delta.
- Security invariants are unchanged: no host bind mounts, no secrets through
  `--env` or `--env-from`, provider profiles remain the only credential path,
  and the host analytics folder remains authoritative.
- Existing developer and read-only worktree roles keep their current behavior.
  `selfcheck` remains the separate M3 sandbox self-check item.
