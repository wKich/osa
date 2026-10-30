# Tasks

Implementation target: Conveyor (`/Users/ki/Projects/kontur/conveyor.ai`). This
osa directory is the cross-repository planning record; do not change the osa
helper or sandbox policy under this change.

## 1. Analytics role and mode gates

- [x] 1.1 Add the analytics role groups to `MakiOsaAgentHost`: `speceditor` and
  `contextcollector` as analytics writers, `specanalyst` and `specreviewer` as
  analytics readers. Accept each only when `spec.Analytics` is non-null; keep
  `developer` and the worktree read-only roles unchanged. Verify an analytics
  role without an analytics spec fails before any helper call.
  (`dotnet test --filter FullyQualifiedName~MakiOsaRunnerTests`)
- [x] 1.2 Allow `maki-osa` in the analytics dispatch mode gate in
  `RunnerWorker.ExecuteAnalyticsRunAsync` while keeping Claude and Simulated
  behavior. Verify a `maki-osa` analytics run reaches the host and an unknown
  mode still gets the existing refusal. (`dotnet test --filter
  FullyQualifiedName~MakiOsaRunnerTests`)
- [x] 1.3 Refuse `AnalyticsRunSpec.CodeWorkspace != null` before `up`, `sync-in`,
  or `run`, with an error naming the unsupported product-code copy. Verify the
  fake helper log is empty. (`dotnet test --filter
  "FullyQualifiedName~MakiOsaRunnerTests&FullyQualifiedName~CodeWorkspace"`)

## 2. Folder result transport

- [x] 2.1 Add the helper download argv to `MakiOsaLauncher` and call
  `maki-oss download <sandbox-workdir> <temp-dir>` with the existing caller
  environment. Verify the exact argv and that the temp directory is created
  outside the host analytics folder. (`MakiOsaRunnerTests`)
- [x] 2.2 Add a host-folder replacement operation that reads the downloaded
  directory with `AnalyticsFolder.ReadAsync` filtering and writes or deletes
  only analytics files. Verify it preserves `.conveyor`, ignores dot-prefixed
  paths, and removes a deleted spec file. (`dotnet test --filter
  FullyQualifiedName~AnalyticsFolder`)
- [x] 2.3 Wire `speceditor` and `contextcollector` to download and replace after
  termination confirmation, then return the outcome. Verify the fake helper log
  has `up`, `sync-in`, `run`, `download` and no `collect-patch`, `git apply`, or
  `rm`. (`MakiOsaRunnerTests`)
- [x] 2.4 Wire `specanalyst` and `specreviewer` to return without downloading or
  replacing; verify the host folder stays at the prepared version.
  (`MakiOsaRunnerTests`)
- [x] 2.5 Cover download failure, replacement failure, cancellation, and timeout:
  each run fails or stops without a completed outcome, the host folder is not
  partially replaced, and the sandbox is retained.
  (`MakiOsaRunnerTests`)

## 3. Documentation

- [x] 3.1 Record the analytics support, the file-based result, and the
  `CodeWorkspace` limitation in Conveyor's `docs/progress.md` and
  `docs/maki-osa-e2e.md`. Verify both files name the four analytics roles and
  the product-code refusal.
- [x] 3.2 Update this change's evidence and validate it with `openspec validate
  add-maki-osa-analytics-roles --strict` from osa.

## 4. Verification

- [x] 4.1 Run the full Conveyor suite and the web build; record the counts in
  this change. (`dotnet test`, `npm --prefix web run build`)
- [x] 4.2 When an OpenShell gateway is available, run a no-repository analytics
  task on a `maki-osa` runner: open a spec draft, let `speceditor` change a
  spec file, verify `AnalyticsFilesReady` carries the change, the host task
  folder matches it, and the runner log has no `collect-patch` or `git apply`.
  Record the result or the missing-gateway limitation in this change.

## Evidence

- Conveyor changes: `MakiOsaAgentHost` (analytics writer/reader role groups,
  `CodeWorkspace` refusal, download/replace hand-off), `MakiOsaLauncher`
  (`DownloadArguments`), `AnalyticsFolder.ReplaceAsync`, `RunnerWorker`
  analytics mode gate (`AgentModes.SupportsAnalytics`).
- Targeted tests: `dotnet test --filter
  "FullyQualifiedName~MakiOsaRunnerTests|FullyQualifiedName~AnalyticsFolderTests"`
  passed 64/64.
- Full suite: `dotnet test` passed 713/713. Web: `npm --prefix web run build`
  passed (chunk-size warning only).
- Live run (`speceditor`, gateway `openshell`, image `maki-agent:personal`,
  provider `maki-synthetic`, model
  `synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017`): `up` → `sync-in` →
  `run` → `download` → host replacement, outcome `completed`; host `spec.md`
  changed to `Версия: v2`, `.conveyor/note.txt` preserved, no `collect-patch`
  or `git apply`. The sandbox was removed explicitly with `maki-oss rm`.
  The full UI path emitting `AnalyticsFilesReady` was not exercised because no
  Conveyor stand was running; the transport is covered by the fake-helper
  tests and `RunnerWorker`'s existing `finally` send.
- `openspec validate add-maki-osa-analytics-roles --strict` passed.
