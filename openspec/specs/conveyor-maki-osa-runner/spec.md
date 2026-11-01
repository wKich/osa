# conveyor-maki-osa-runner Specification

## Purpose

Lets Conveyor run Maki developer passes inside an OpenShell sandbox through the osa caller contract, reusing one retained sandbox per host workspace while keeping the task worktree and human commit boundary with Conveyor.

## Requirements

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

For a `maki-osa` developer run, the runner SHALL use a retained sandbox bound to the existing Conveyor host workspace and a stable sandbox workdir. It SHALL create an absent container, start a stopped container, or reuse a running compatible container only after verifying ownership and absence of an active prior run. It SHALL refresh the sandbox files and patch baseline from the current host worktree with `sync-in`, run `maki-oss run -` with the prompt on stdin, collect a host temporary patch with `collect-patch`, and apply it only after `git apply --check` succeeds. The host worktree SHALL remain authoritative; success SHALL NOT remove the container.

The sequence SHALL NOT create host bind mounts or pass credentials through `--env` or `--env-from`. Separate workspaces SHALL use separate containers. Runs sharing a workspace SHALL be serialized from before workspace preparation until remote quiescence and patch handling finish. Conveyor's existing task-to-worktree mapping SHALL remain unchanged; sharing a project alone SHALL NOT cause container sharing.

#### Scenario: Happy path
- **WHEN** a developer run starts for a workspace without a binding and every helper stage succeeds
- **THEN** a caller-mode sandbox is created, the worktree is synced, Maki edits are collected and applied, and the container and conversation state are retained

#### Scenario: Concurrent runs do not collide
- **WHEN** two runs use different worktrees of the same project concurrently
- **THEN** they use different containers and workdirs and neither observes the other's workspace files or conversations

#### Scenario: Shared workspace is serialized
- **WHEN** another run requests a workspace while an operation is active there
- **THEN** it waits cancellably before mutating the host or sandbox workspace, while unrelated workspaces can proceed within the runner concurrency limit

#### Scenario: Failure before the run cleans up
- **WHEN** `sync-in` fails
- **THEN** the run fails naming `sync-in`, no agent starts, temporary patch resources are cleaned up, and the container is not deleted

#### Scenario: Patch failure leaves the host tree unchanged
- **WHEN** collection succeeds but `git apply --check` fails
- **THEN** no part of the patch is applied, the host worktree remains unchanged by the run, and the container is retained

#### Scenario: Rework refreshes the baseline
- **WHEN** a previous patch was applied and a user then edits host files before another run
- **THEN** the retained sandbox receives those current files and a new baseline, and the next returned patch contains only that run's changes

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

Every `maki-osa` run SHALL use a positive timeout and a unique run tag. On cancellation, the runner SHALL send the stop-file signal inside the sandbox and confirm that the remote wrapper and tagged descendants have terminated before allowing reuse. Writing the stop file or killing only the local helper SHALL NOT count as confirmed termination. A bounded recovery attempt SHALL be allowed to stop the container, but SHALL NOT delete it. If termination or stopped state cannot be confirmed, the workspace SHALL be blocked from refresh and execution until safely reconciled. Cancelled runs SHALL finish as stopped with no patch applied; timeouts SHALL report failure rather than success.

#### Scenario: User stops a run
- **WHEN** the user cancels an executing run
- **THEN** the runner signals its unique stop file, confirms remote termination or stopped container state, retains the container, and returns stopped without applying a patch

#### Scenario: Timeout expires
- **WHEN** the helper exits 124 because its in-sandbox timeout expired
- **THEN** the runner reports a timeout, confirms remote quiescence before reuse, retains the container, and applies no patch

#### Scenario: Helper process dies alone
- **WHEN** only the local helper dies and remote termination has not been confirmed
- **THEN** the runner follows remote termination/recovery rather than treating local exit as proof that reuse is safe

#### Scenario: Stop cannot be confirmed
- **WHEN** the stop signal and bounded stop-state recovery cannot confirm termination
- **THEN** the workspace is reported blocked and subsequent runs cannot sync files into it until recovery confirms it is safe

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

### Requirement: Workspace binding preserves explicit conversation selection

The runner SHALL retain a stable workspace-to-container binding scoped to its runner ownership and gateway, independent of run id and Maki conversation id. A binding SHALL remain attached to one host worktree incarnation and SHALL NOT be reassigned to another worktree. Existing containers with unverified ownership or incompatible image, provider, engine, gateway, or execution-policy configuration SHALL NOT be silently adopted, reconfigured, or deleted. Maki conversation storage SHALL survive workspace refresh and container stop/start.

The runner SHALL forward Conveyor's explicit fresh, resume, or fork choice without selecting a conversation automatically. Multiple conversations SHALL be permitted inside one retained workspace. Tasks SHALL share a binding only where Conveyor already shares their workspace.

#### Scenario: Resume after rework
- **WHEN** Conveyor supplies an existing conversation id for a later run in the same workspace
- **THEN** the same sandbox and stable workdir are used, current host files are refreshed without erasing that conversation, and Maki resumes the supplied id

#### Scenario: Fork a conversation
- **WHEN** Conveyor requests a fork from a conversation in the retained sandbox
- **THEN** the supplied id and fork flag reach Maki, the source conversation remains available, and the resulting conversation id is reported

#### Scenario: Fresh conversation in retained workspace
- **WHEN** Conveyor provides no resume id
- **THEN** the container is reused but a fresh conversation starts, with no implicit continue or latest-session selection

#### Scenario: Configuration mismatch
- **WHEN** the recorded container configuration is incompatible with the requested execution configuration
- **THEN** the run fails with recovery guidance before syncing or launching the agent and the existing container is neither deleted nor silently changed

#### Scenario: Host worktree is removed and recreated
- **WHEN** Conveyor removes a bound worktree and later creates another at the same path
- **THEN** the old binding is retired and its container retained, and the new worktree does not silently inherit that container or its conversations

### Requirement: Idle stop is distinct from explicit container removal

The runner SHALL support a configurable idle-stop interval, including a disabled setting, and SHALL stop only owned containers that have no active workspace operation. Idle stop SHALL preserve container storage and conversations; later use SHALL start the same container. Automatic idle stopping SHALL NOT interrupt preparation, sync, execution, collection, or patch application. Success, failure, timeout, cancellation, runner shutdown, and removal of a Conveyor task/worktree SHALL NOT automatically delete its container. Users SHALL be given the container identity and instructions for explicit removal that explain conversation loss.

#### Scenario: Idle container is stopped
- **WHEN** the configured idle interval elapses without a new operation
- **THEN** the container is stopped, not deleted, and a later run starts it with its conversation state preserved

#### Scenario: Idle timer races with a run
- **WHEN** a queued idle stop encounters a new or active workspace operation
- **THEN** it rechecks activity under workspace coordination and does not stop that operation's container

#### Scenario: Idle stop is disabled
- **WHEN** the idle-stop interval is disabled
- **THEN** inactivity does not trigger a runner-owned stop or deletion

#### Scenario: Explicit removal
- **WHEN** a user explicitly removes the container using the documented operation
- **THEN** the container and its conversations are deleted, and later use reconciles the missing container rather than claiming its sessions survived

#### Scenario: Task or host workspace is removed
- **WHEN** Conveyor removes a task or its host worktree
- **THEN** the container is not deleted, its retired binding remains identifiable for explicit removal, and idle stopping remains permitted

### Requirement: Interrupted lifecycle is reconciled before reuse

The runner SHALL retain sufficient non-secret ownership and lifecycle state to detect an interrupted active operation after restart. Before refreshing or executing in that workspace, it SHALL confirm the previous remote run is absent or terminate it safely. Uncertain remote state SHALL block reuse. A restart SHALL NOT replay an old patch; a later safe run SHALL establish a new baseline from the current host files. A successful agent result SHALL NOT permit reuse while tagged descendant processes remain active.

If a previously bound container is absent, the runner SHALL report its loss and reconcile creation of a replacement without claiming conversation continuity. An unavailable requested conversation SHALL use Conveyor's existing missing-session recovery behavior; unrelated failures SHALL NOT be classified as missing sessions.

#### Scenario: Runner restarts during execution
- **WHEN** startup finds an interrupted active marker for a retained workspace
- **THEN** the workspace cannot be synced until remote quiescence or stopped state is confirmed, and an unverifiable state remains blocked

#### Scenario: Crash after host patch application
- **WHEN** the runner restarts after applying a patch but before recording completion
- **THEN** it does not apply that patch again and the next safe run uses the host's current content as its baseline

#### Scenario: Missing container with requested resume
- **WHEN** a user previously removed the container and Conveyor requests an old conversation
- **THEN** loss of the old container/session is surfaced, and Conveyor's missing-session recovery can start fresh without reporting a successful resume

#### Scenario: Descendants remain after agent completion
- **WHEN** Maki emits a successful result but tagged tool processes remain alive
- **THEN** the workspace is not released for refresh or another run until those processes are terminated or the container is confirmed stopped

### Requirement: Read-only roles run without applying changes

For a `maki-osa` run whose role is `researcher`, `architect`, `decomposer`,
`planner`, `mrwriter`, `dutyresponder`, `consultant`, `mrreviewer`,
`testanalyst`, or `reviewer`, the runner SHALL execute the caller lifecycle
`up`, `sync-in`, and `maki-oss run -` and SHALL NOT invoke `collect-patch` or
apply any patch to the host worktree. It SHALL return the agent outcome as the
run outcome.

The host worktree SHALL remain unchanged by such a run. A file the agent changed
in the sandbox workdir SHALL NOT reach the host, and the next `sync-in` for that
workspace SHALL replace the workdir from the host tree.

The runner SHALL continue to refuse `speceditor`, `contextcollector`,
`specanalyst`, `specreviewer`, and `selfcheck` before starting any helper
command.

#### Scenario: Reviewer completes without a patch

- **WHEN** a `maki-osa` run has role `reviewer` and every helper stage succeeds
- **THEN** the runner runs `up`, `sync-in`, and `run`, does not run `collect-patch`, applies nothing, and returns the completed outcome

#### Scenario: Reviewer changes are discarded

- **WHEN** a read-only role changes a file in the sandbox workdir despite its prompt
- **THEN** the host worktree still holds its previous content and no patch is applied

#### Scenario: Unsupported role is refused

- **WHEN** a `maki-osa` run has role `speceditor`, `contextcollector`, `specanalyst`, `specreviewer`, or `selfcheck`
- **THEN** the run fails before any helper command and no sandbox is created

#### Scenario: Developer still applies a patch

- **WHEN** a `maki-osa` run has role `developer` and the agent changed files
- **THEN** the runner still collects the patch and applies it to the host worktree

### Requirement: Analytics roles use a task-folder sandbox

The runner SHALL accept `speceditor`, `contextcollector`, `specanalyst`, and
`specreviewer` for a `maki-osa` run only when the run carries an analytics run
spec. It SHALL bind the run to the analytics task folder, not to a git worktree,
and SHALL reuse the existing retained sandbox for that folder.

The runner SHALL refresh the folder with `sync-in`, run `maki-oss run -` with
the prompt on standard input, and confirm remote termination as for other Maki
runs. It SHALL NOT call `collect-patch` or apply a git patch for an analytics
role. It SHALL NOT create a host bind mount or pass credentials through
`--env` or `--env-from`.

#### Scenario: Spec editor runs in the task folder

- **WHEN** a `speceditor` run carries an analytics run spec and the helper
  stages succeed
- **THEN** the runner uses the task-folder sandbox, syncs the folder, starts
  Maki, and emits no `collect-patch` call and no `git apply`

#### Scenario: Analytics role without an analytics run is refused

- **WHEN** a `speceditor` run has no analytics run spec
- **THEN** the run fails before any helper call and names the unsupported role

#### Scenario: Worktree roles keep their behavior

- **WHEN** a `developer` or an existing read-only worktree role runs
- **THEN** its current binding, patch, or discard behavior is unchanged

### Requirement: Analytics file results return through an explicit download

After a successful `speceditor` or `contextcollector` run, the runner SHALL
download the sandbox task folder to a temporary host directory. It SHALL then
replace only the analytics files in the host task folder: files returned by the
download SHALL be written, and analytics files absent from the download SHALL be
removed. The service folder used for attachments and dot-prefixed paths SHALL
NOT be removed or treated as analytics output.

The runner SHALL use the updated host folder for its existing
`AnalyticsFilesReady` result. It SHALL NOT download the sandbox folder over the
host task folder without filtering.

#### Scenario: Edited spec files reach the host folder

- **WHEN** `speceditor` changes a spec file and the download succeeds
- **THEN** the host task folder contains the changed file and the file result
  sent to the server is read from that updated folder

#### Scenario: Deleted spec file is removed

- **WHEN** the agent deletes an analytics file that exists in the host task
  folder
- **THEN** the replaced host folder no longer contains that file

#### Scenario: Attachments survive the result replacement

- **WHEN** the task folder contains the `.conveyor` attachment folder
- **THEN** the replacement leaves that folder untouched

#### Scenario: Download failure is not a completed run

- **WHEN** the download or the host replacement fails
- **THEN** the run fails with the failing stage named, the host task folder is
  left as it was before the replacement, and the runner does not report a
  completed outcome

### Requirement: Read-only analytics roles do not copy files back

`specanalyst` and `specreviewer` SHALL return their agent outcome without a
download, folder replacement, `collect-patch`, or `git apply`. The host task
folder SHALL remain as prepared for the run.

#### Scenario: Spec analyst keeps the prepared folder

- **WHEN** a `specanalyst` run completes
- **THEN** the runner returns the outcome and the host task folder is unchanged
  from the prepared version

### Requirement: Analytics runs that need product code are refused

Before starting the helper, the runner SHALL fail an analytics run whose
analytics run spec carries a product-code workspace. The error SHALL name the
unsupported product-code copy. The runner SHALL NOT pass a host code path into
the sandbox prompt.

#### Scenario: Product-code analytics is refused early

- **WHEN** an analytics run carries a non-null product-code workspace
- **THEN** the run fails before `up`, `sync-in`, or `run`, and no helper command
  is started
