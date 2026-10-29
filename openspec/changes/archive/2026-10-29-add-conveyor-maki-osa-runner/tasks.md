# Tasks

Implementation target: `/Users/ki/Projects/kontur/conveyor.ai`. Run the apply workflow from the Conveyor repository; this OpenSpec change is the cross-repo planning record.

## 1. Mode, kind, and UI

- [x] 1.1 In Conveyor, add `AgentModes.MakiOsa = "maki-osa"`, include it in `IsKnown`, `IsIsolated`, and `IsSafe`, and add `IsMakiOsa`. Add xUnit cases that the mode is known and safe and that a near-miss mode is rejected. Verify with `dotnet test --filter FullyQualifiedName~AgentModes` (or the suite that covers `RunnerProfile`).
- [x] 1.2 Add `AgentKinds.Maki`, `IsMaki`, and the `Of`/`ModeFor`/`All` mappings; keep `SupportsEffort` false for Maki. Verify with `dotnet test`.
- [x] 1.3 Add `RunnerOptions` fields for `MakiOssExecutable` (`maki-oss`), `MakiImage` (`maki-agent:local`), `MakiProvider`, `MakiGateway`, `MakiEngine`, and `MakiSandboxPrefix`; document defaults in XML comments. Verify with `dotnet build Conveyor.slnx`.
- [x] 1.4 Extend the web `AgentMode` union, `AGENT_MODES`, `isSafeMode`, and the runner profile editor so `maki-osa` has a Russian label and is not shown as unsafe. Verify with `npm --prefix web run build`.

## 2. Host and launcher

- [x] 2.1 Add `MakiOsaLauncher` with pure helpers for the sandbox name, workdir, caller environment, `up`/`sync-in`/`run`/`collect-patch`/`rm` argument lists, and the Windows refusal. Add xUnit tests for the exact argv and the caller environment. Verify with `dotnet test`.
- [x] 2.2 Add `MakiOsaAgentHost`: run `up`, `sync-in`, start `maki-oss run -` with redirected stdin, hand the stream to `AgentCliRunner` and `ClaudeStreamParser`, then `collect-patch` and apply. Register it in `Program.cs` and dispatch it in `RunnerWorker.ExecuteAgentRunAsync` for `AgentModes.MakiOsa`. Verify a fake-helper test covers the full sequence and `dotnet build Conveyor.slnx` succeeds.
- [x] 2.3 Apply the collected patch only after `git apply --check` succeeds; leave the host worktree unchanged on a failed check, delete the temporary patch, and treat an empty patch as a successful no-op. Verify with the fake-helper test and a worktree fixture.
- [x] 2.4 Refuse roles other than `developer` in the Maki OSA host with an explicit M2 message before starting any helper command. Verify a test asserts no helper process starts for `reviewer`.

## 3. Cancellation and failure

- [x] 3.1 Always pass a positive `--timeout` and a unique `MAKI_OSS_RUN_TAG`; on cancellation create `/tmp/maki-oss-stop/<tag>` inside the sandbox, kill the local helper, and run best-effort `rm`. Verify with a fake-helper test that records the stop-file command and cleanup, and asserts the run outcome is `stopped`.
- [x] 3.2 Map helper failures to named stages (`up`, `sync-in`, `run`, `collect-patch`, `apply`) and fail the run; never emit `completed` for a missing helper, gateway, image, provider, or failed patch. Verify with one test per stage using the fake helper.
- [x] 3.3 Ensure the timeout path reports a timeout, not a successful result, and removes the sandbox. Verify with a fake helper that exits 124.

## 4. Stream and role behavior

- [x] 4.1 Add a captured Maki one-shot stream fixture (init, assistant, tool use, tool result, result) to `tests/Conveyor.Domain.Tests/ClaudeStreamParserTests.cs` or a sibling test. Verify the parser produces the expected Conveyor events, session id, usage, and cost; only fork the parser if the fixture proves a mismatch.
- [x] 4.2 Add a role-argument test proving the Maki developer argv is `--print --yolo --trust --output-format stream-json --verbose`, then model and resume/fork flags, and never contains `--permission-mode`, `--allowedTools`, `--add-dir`, or `--effort`. Verify with `dotnet test`.
- [x] 4.3 Add a test that an effort value in the profile or task does not reach the Maki command and does not fail the run. Verify with `dotnet test`.

## 5. Integration and docs

- [x] 5.1 Run `dotnet build Conveyor.slnx`, `dotnet test`, and `npm --prefix web run build`; verify all pass and existing Claude, Codex, Cursor, and simulated tests are unchanged.
- [x] 5.2 On macOS with a local OpenShell gateway, a `maki-agent:local` image, and a provider-bound Maki runner, run one developer task end to end: `maki-osa` profile, task worktree, Maki edit, patch applied, commit/push buttons still host-side. Verify the stream, the patch, and that `git status` on the runner shows the agent's change.
- [x] 5.3 Repeat the same task and press stop mid-run; verify the remote run stops, the sandbox is removed, the host worktree is unchanged, and the run is reported as stopped.
- [x] 5.4 Document the mode, the runner-host prerequisites (`maki-oss`, OpenShell, gateway, image, provider), the macOS/Linux-only limit, and the M1 developer-only scope in Conveyor's Russian docs (`docs/progress.md` session log and the runner page copy). Verify the docs mention the osa change and no Windows path.

Чек-лист живого прогона для 5.2 и 5.3 — в репозитории Conveyor: `docs/maki-osa-e2e.md` (два раннера, этапы
«План + Разработка», проверки ленты, патча, рабочей копии и удаления песочницы, остановка через файл остановки).

Итог живой проверки 2026-10-29 (OpenShell 0.1.5, Maki 0.6.5, `maki-synthetic`, модель
`synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017`) — в Conveyor `docs/progress.md` и `docs/maki-osa-e2e.md`.
Побочно найдено и исправлено: продолжение удалённой сессии после остановки (`--resume` в удалённую песочницу) теперь
распознаётся как потеря сессии, и прогон перезапускается новой сессией.
