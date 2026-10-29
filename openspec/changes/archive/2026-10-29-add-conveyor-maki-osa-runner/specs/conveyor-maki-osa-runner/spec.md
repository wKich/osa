# Spec Delta

## Purpose

Lets Conveyor run one Maki developer pass inside an OpenShell sandbox through the osa caller contract, so the task's host worktree and human commit boundary stay with Conveyor.

## ADDED Requirements

### Requirement: Maki OSA is a known safe runner mode

Conveyor SHALL accept `maki-osa` as a runner profile agent mode and SHALL treat it as safe without `UnsafeMode`, because the agent process runs in an OpenShell sandbox rather than on the runner host. The mode SHALL be refused on Windows with an explicit error before any task work starts. The runner list and profile editor SHALL show the mode with a label that names Maki and OpenShell, and SHALL NOT show the unsafe-mode warning for it.

#### Scenario: Safe mode is assignable
- **WHEN** an administrator saves a runner profile with `maki-osa` and `UnsafeMode` is off
- **THEN** the profile is accepted, the runner is not hidden by `RunnerAccessPolicy`, and the runner card marks it safe

#### Scenario: Windows is refused
- **WHEN** a `maki-osa` run is started on Windows
- **THEN** the run fails with an error naming Windows and no `maki-oss` process is started

#### Scenario: Unknown mode is not invented
- **WHEN** a profile carries `maki-osa-docker`
- **THEN** profile validation rejects it as an unknown mode

### Requirement: One developer pass uses the caller lifecycle

For a `maki-osa` run, the runner SHALL execute the osa caller sequence with a literal sandbox name and workdir:

1. create or start the sandbox in caller mode, with the configured image, gateway, and provider, and with idle stop disabled;
2. `sync-in` the task's host worktree into the sandbox workdir;
3. start `maki-oss run -` with the role arguments and the prompt on standard input;
4. write the run's changes to a host temporary patch with `collect-patch`;
5. apply the patch to the host worktree after `git apply --check` succeeds;
6. remove or stop the sandbox.

The sequence SHALL NOT create a host bind mount, SHALL NOT pass a model key or other secret through `--env` or `--env-from`, and SHALL use a distinct sandbox name per run so two concurrent runs cannot share a workdir.

#### Scenario: Happy path
- **WHEN** a developer run starts for a clean task worktree and every helper stage succeeds
- **THEN** the sandbox is created in caller mode, the worktree is synced in, Maki edits are collected as a patch, the patch applies to the host worktree, and the sandbox is removed

#### Scenario: Concurrent runs do not collide
- **WHEN** two `maki-osa` runs start at the same time on one runner
- **THEN** each uses a different sandbox name and workdir, and neither run's `sync-in` or patch collection observes the other's files

#### Scenario: Failure before the run cleans up
- **WHEN** `sync-in` fails because the sandbox is stopped
- **THEN** the run fails with the `sync-in` stage named, no `run` process is started, and the sandbox is removed

#### Scenario: Patch failure leaves the host tree unchanged
- **WHEN** `collect-patch` succeeds but `git apply --check` fails on the host worktree
- **THEN** the run fails without applying any part of the patch, and the host worktree still matches its pre-run state

### Requirement: Developer role arguments are Maki-native

The runner SHALL launch the in-sandbox agent as `maki --print --yolo --trust --output-format stream-json --verbose`, followed by the resolved `--model`, the resolved session flags, any allowed Maki pass-through flags, and no prompt argument. The prompt SHALL be written to the helper's standard input and SHALL NOT appear in any command argument. The runner SHOULD pass `--disallowed-tools` when the developer role needs a whole-tool restriction.

The runner SHALL NOT pass `--permission-mode`, `--allowedTools`, `--disallowedTools` (Claude spelling), `--add-dir`, or `--effort` to Maki. It SHALL NOT rely on a command-scoped git deny list for the developer role, because Maki's CLI deny list accepts tool names only; the host-side patch and commit boundary is the enforcement point.

#### Scenario: Developer argv
- **WHEN** a developer run resolves model `deepseek/deepseek-chat` and resumes session `S1` with a fork
- **THEN** the in-sandbox command is `maki --print --yolo --trust --output-format stream-json --verbose --model deepseek/deepseek-chat --resume S1 --fork-session`, with the prompt only on stdin

#### Scenario: Claude-only flags are not forwarded
- **WHEN** the role mapping would produce `--permission-mode acceptEdits` or `--allowedTools Read,Edit`
- **THEN** those flags are absent from the Maki command and the run still starts

#### Scenario: Effort is ignored
- **WHEN** a runner profile or task sets an effort level
- **THEN** the `maki-osa` run omits `--effort` and does not fail because of it

### Requirement: Maki stream-json is read without a new parser

The runner SHALL parse Maki's one-shot stdout as line-delimited stream-json using the existing Claude-compatible parser. `system/init`, `assistant`, `user`, and `result` lines SHALL produce Conveyor status, message, tool, and result events; `result` SHALL supply `session_id`, `is_error`, the result text, `total_cost_usd`, and token usage. Non-JSON lines SHALL be surfaced as output events, not treated as fatal. A captured Maki stream SHALL be added as a fixture test.

#### Scenario: Successful Maki stream
- **WHEN** the parser is fed a captured Maki stream with init, assistant text, a tool call, a tool result, and a successful result
- **THEN** Conveyor emits status, message, tool-use, tool-result, and result events, records the session id and cost, and marks the run completed

#### Scenario: Maki reports an error result
- **WHEN** the `result` line has `is_error: true`
- **THEN** Conveyor marks the run failed and reports the result text as the cause

#### Scenario: Maki starts but emits no result
- **WHEN** the stream ends without a `result` line
- **THEN** Conveyor marks the run failed with the stderr tail or the exit code, and does not report success

### Requirement: Cancellation stops the sandboxed run

Every `maki-osa` run SHALL pass a positive `--timeout` and a `MAKI_OSS_RUN_TAG` so the helper's in-sandbox wrapper can be stopped. On Conveyor cancellation, the runner SHALL create the helper's stop file inside the sandbox, terminate the local helper process, and remove the sandbox. The run SHALL finish as stopped, and no patch SHALL be applied.

#### Scenario: User stops a run
- **WHEN** a `maki-osa` run is running and the user presses stop
- **THEN** the runner creates `/tmp/maki-oss-stop/<tag>` in the sandbox, the wrapper ends Maki, the sandbox is removed, and the run ends as stopped with no host changes

#### Scenario: Timeout expires
- **WHEN** the in-sandbox timeout expires
- **THEN** the helper exits 124, Conveyor reports a timeout rather than a successful result, and the sandbox is removed

#### Scenario: Helper process dies alone
- **WHEN** only the local `maki-oss` process is killed and the stop file is not written
- **THEN** the implementation does not claim the remote run was stopped; it follows the stop-file path before cleanup

### Requirement: Failures name the stage and do not fake a result

The runner SHALL fail the run with an actionable message when `maki-oss` is missing, the OpenShell gateway is unreachable, the image or provider is unavailable, `sync-in` or `collect-patch` fails, or the patch does not apply. It SHALL NOT emit a completed outcome for any of these cases. The host worktree SHALL remain unchanged except for a patch that applied successfully.

#### Scenario: Missing helper
- **WHEN** the configured `maki-oss` executable does not exist
- **THEN** the run fails before any sandbox call with an error naming the executable

#### Scenario: Missing provider
- **WHEN** the sandbox cannot attach the configured Maki provider
- **THEN** the run fails with the provider stage named, and no agent prompt is sent

#### Scenario: Empty patch
- **WHEN** the agent makes no changes and `collect-patch` returns `{"empty":true}`
- **THEN** the run completes normally, no patch is applied, and the worktree remains unchanged
