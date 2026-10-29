# Design

## Context

See `proposal.md` for motivation and scope. Implementation belongs in Conveyor; this repository holds its planning record.

Current Conveyor integration points:
- `MakiOsaAgentHost.RunAsync` derives the sandbox/workdir from `RunId`, syncs the host tree, collects/applies the patch, and always removes the sandbox in `finally`.
- `StartRunSpec` already carries a prepared `WorkspaceSpec`, `ResumeSessionId`, and `ForkSession`. `RunnerWorker` prepares the host worktree before entering the host, so a lock solely inside the host would be too late to protect preparation.
- `StopRemoteAsync` currently treats writing the stop file as best effort and relies on subsequent container deletion. That is insufficient when retaining containers.
- osa caller-mode `run` uses the existing session lock and can arm helper idle-stop, but that lock covers neither the preceding sync nor subsequent patch collection/application (`lib/oss-core.sh`, `cmd_run`). Keep helper idle-stop disabled and coordinate the full operation in Conveyor.
- `docs/helper.md` documents conversation persistence across stop/start. Verify actual Maki conversation paths in the baked image rather than assuming all state is outside the replaceable workdir.

## Goals / Non-Goals

Goals: add persistence below Conveyor's existing workflow, preserve host authority and explicit conversation selection, and fail closed when an old run might still be writing.

Non-goals: new workflow/session entities in the server, new UI, migration of sessions between runners, worktree reassignment, or recovering sandbox-only source edits after failed runs. The exclusions in the proposal also apply.

## Decisions

### 1. Workspace identity, not task identity or conversation identity

Use a runner-local workspace binding keyed by the canonical prepared host worktree path plus repository identity, scoped to runner ownership and selected gateway. Store its stable sandbox name and stable sandbox workdir in a durable, access-restricted runner-local record. Resolve the prospective host path using the same non-mutating path resolution as existing worktree preparation, then acquire the workspace lock before preparation. Do not independently invent a second worktree naming rule.

Use a collision-resistant key rather than the current first eight characters of `RunId`. Verify recorded ownership/binding before using an existing container; a name collision or an unowned existing container is an error, not permission to adopt or delete it. Keep `RunId` in the unique per-run stop tag only.

A binding stays attached to one worktree incarnation. If Conveyor explicitly removes that host worktree, retire the binding without deleting its container; a newly created worktree at the same path receives a new binding. A missing or replaced worktree outside Conveyor requires reconciliation, not silent adoption. This avoids reusing old conversations against an unrelated workspace that happens to occupy the same path.

Alternative: project-only identity permits concurrent worktrees to overwrite each other. Task-only identity unnecessarily prevents reuse where Conveyor already shares a workspace. Adding a new project-session scheduler duplicates Conveyor workflow.

### 2. Persistent binding metadata, not credentials or conversation copies

The local record holds workspace identity, container identity, resolved execution configuration fingerprint, lifecycle status, active run tag, and last-idle time. Write transitions atomically with restrictive permissions; do not store provider credentials, prompts, or conversation content. Compare gateway, image, provider selection, engine, and relevant execution/policy settings before reuse. Incompatible changes fail with guidance to restore the configuration or explicitly remove the old container before creating a replacement; never silently recreate or reattach incompatible settings. Model selection remains per run.

Store the resolved provider selection, including implicit helper defaults, rather than treating an unset provider option as a stable configuration. Avoid adding a database or external dependency solely for these records.

### 3. One exclusive operation per workspace

A runner-local lifecycle coordinator owns a cross-process workspace lock from before host preparation through quiescence checks, `up`, `sync-in`, agent execution, patch application, and recording idle state. Waiting runs remain cancellable. Distinct workspace locks preserve existing global concurrency limits and permit parallel worktrees.

Host workspace removal must use the same lock and retire the binding. Idle stopping must acquire the same lock and recheck the last-idle timestamp and active-run state. Existing host commit/push workflow remains unchanged; `git apply --check` continues detecting incompatible host edits. This lock is not a claim that unrelated IDE processes honor Conveyor's coordination.

### 4. Host snapshot and conversation state have different lifetimes

Every run refreshes the replaceable sandbox workdir with `sync-in`, which also resets the patch baseline and history. Keep the stable workdir path so Maki's workspace association does not change. Verify conversation storage is outside paths erased by `sync-in`; if necessary choose an image-supported state location outside that workdir without exporting sessions to the host or altering sandbox policy broadly.

Pass precisely the conversation flags already supplied by Conveyor. Do not infer `--continue`, select the latest session, or automatically resume across tasks. A fork must preserve its source conversation. If a known container has been explicitly removed outside Conveyor, reconcile its absence and allow `up` to create a replacement; surface session loss through the existing exact missing-session recovery path, never pretend resume succeeded. Do not classify unrelated failures as lost sessions.

Full snapshot transfer remains intentional; retained containers provide conversation continuity, not an incremental-sync/cache guarantee. Failed, cancelled, or unapplied sandbox edits are not authoritative and the next safe `sync-in` discards them.

### 5. Retention and idle stopping

Normal completion, errors, cancellation, timeouts, runner shutdown, and workspace retirement never issue `rm`. Use existing helper `up` to create/start; retain sessions on stop/start. Offer a runner idle-stop interval with `0` disabling it; use one hour as the proposed default to match osa's documented idle setting. Disable the helper's independent idle-stop for these runs to prevent a stop between agent exit and patch collection. The coordinator stops only idle owned containers, and reconciles overdue records on runner startup.

Workspace retirement does not disable idle stopping for the retained container. Explicit deletion remains the existing user-invoked `maki-oss rm --name ... --yes` operation with the correct gateway; document that it permanently loses conversations. Do not add a deletion UI or delete containers when Conveyor removes a task/worktree. Reconcile externally removed containers on next access.

References: OpenShell lifecycle documentation linked in `proposal.md`, and `docs/helper.md` sections on sessions and idle stop. Confirm stop/start and retained filesystem behavior in the live acceptance test.

### 6. Confirm termination; do not replace deletion with optimism

Persist an active run marker/tag before launching the helper. On cancellation, send the existing stop-file signal, then confirm the wrapper and tagged descendant processes have exited. A successful exec that merely writes the file is not confirmation. A bounded wait can fall back to stopping the container and confirming its stopped state; this preserves its filesystem without deleting it. If neither quiescence nor stopped state can be verified, persist a blocked state and refuse sync or subsequent execution.

Use the same policy for timeout, helper death, and shutdown. On runner restart, a leftover active marker means unknown remote execution: inspect/terminate that run or confirm the container is stopped before changing files. Never resume patch application from a crash record; a new safe run starts with the current host snapshot. If a crash happened after host patch application but before recording completion, the next baseline still starts from current host files, preventing duplicate application.

Normal wrapper completion must also guarantee tagged descendants are gone before the coordinator releases the workspace. Retained containers make this a safety requirement even after a successful result.

### 6a. Implementation note: quiescence across OpenShell exec domains

Measured on OpenShell 0.1.5 while closing the live checks: another `sandbox exec` cannot read
`/proc/<pid>/environ` of the run's processes, but it can read `/proc/<pid>/cmdline`, and `ps` sees them. Each `sandbox
exec` is its own isolation domain, which is also why the helper's stop file must go through the run's wrapper. The
implemented confirmation therefore finds the run wrapper by the run tag in `cmdline` (`sh -c <wrapper> maki-oss-run
<tag> …`). While the wrapper is alive the workspace is not released; when it exits normally it sweeps descendants that
carry `MAKI_OSS_RUN_TAG`. If the wrapper cannot be found and the container cannot be confirmed stopped, the workspace is
blocked. Limitation: a wrapper killed with SIGKILL can leave env-tagged tool processes that a later exec cannot identify
by environment; the fail-closed container-stop fallback and the workspace block remain the safety boundary.

### 7. Keep the change together

Naming, lifecycle records, synchronization, and cancellation form one safety boundary. Deliver them in one Conveyor change rather than introducing retention before safe reuse exists. Existing osa caller primitives remain unchanged. If an adequate quiescence check cannot be implemented with current exec/stop operations, report the concrete missing contract before expanding osa implementation scope.

## Risks / Trade-offs

- Persistent stopped containers consume disk: document listing and explicit removal; never solve this with automatic deletion.
- Session context can describe an older snapshot: keep explicit conversation choice and refresh files before every run; do not imply conversation memory is filesystem truth.
- Hard runner failure can leave a remote process alive: durable active markers plus fail-closed reconciliation prevent destructive reuse.
- Configuration changes can strand old containers: report their identities and the explicit removal/recovery options without mutating their security settings.
- Automatic idle timers racing with queued work: acquire the same lock, recheck timestamps, and use a controllable clock in tests.
- Worktree removal/recreation can alias a path: retire bindings through existing removal hooks and reconcile unexpected disappearance; path alone is not sufficient incarnation evidence.

## Migration Plan

1. Implement in Conveyor with fake-helper tests first; no adoption of legacy run-named containers.
2. Deploy the runner with existing osa caller prerequisites. First use creates a workspace binding; later runs reuse it. Existing server task/worktree and conversation-selection contracts do not change.
3. Run macOS live acceptance for fresh/resume/fork, manual stop/start, cancellation, parallel worktrees, runner restart, and explicit removal/session-loss recovery.
4. Rollback stops owned retained containers without removing them, then restores the old runner. Old behavior uses separate run-scoped names and cannot resume retained workspace conversations; document that limitation. User removal remains explicit.
