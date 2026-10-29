# Proposal

## Why

Conveyor currently creates and deletes a Maki sandbox for every run, destroying conversations needed by `--resume` and `--fork-session` during rework. M2b retains a sandbox for an existing Conveyor workspace without changing Conveyor's task, worktree, or conversation-selection workflow.

## What Changes

- Bind a retained sandbox and stable sandbox workdir to one existing host workspace on a runner/gateway, not to a run or project alone. Separate project worktrees use separate containers; tasks reuse a container only when Conveyor already reuses their workspace.
- Create absent containers, start stopped ones, and reuse running ones after checking ownership, configuration compatibility, and remote-run quiescence.
- Serialize workspace preparation through patch application for the same workspace, while allowing distinct workspaces to run concurrently.
- Refresh files and the patch baseline from the host before every run; preserve Maki conversation storage outside the replaced workdir. Conveyor alone selects fresh, resume, or fork behavior.
- Retain containers after success, failure, timeout, cancellation, and host-worktree removal. Idle containers may be stopped, never automatically removed; deletion remains an explicit user operation with session-loss guidance.
- Replace deletion-based cancellation safety with confirmed remote termination or a blocked workspace requiring recovery. Reconcile interrupted runs after runner restart without overwriting a possibly active sandbox.
- Keep developer-only scope, existing patch application and host commit/push boundaries, and current security policies.

Lifecycle references: [OpenShell sandbox management](https://docs.nvidia.com/openshell/how-it-works/sandboxes/overview.md). The repository's existing session contract in `docs/helper.md` states that conversations survive stop/start but not deletion; implementation must verify this with the installed OpenShell/Maki versions.

## Capabilities

### New Capabilities

None; extend the existing runner capability rather than introduce a parallel workspace workflow.

### Modified Capabilities

- `conveyor-maki-osa-runner`: replace per-run sandbox destruction with workspace-bound reuse, exclusive execution, safe cancellation/recovery, idle stopping, and explicit deletion; retain Conveyor's explicit conversation selection.

## Impact

Implementation target is `/Users/ki/Projects/kontur/conveyor.ai`; this osa change is the cross-repository planning record, as with the M1 runner change. Apply implementation from Conveyor, not this repository.

Affected areas: `MakiOsaAgentHost`, `MakiOsaLauncher`, runner-local lifecycle state/configuration, workspace preparation and removal integration in `RunnerWorker`/`GitWorkspace`, runner registration, tests, and the existing Maki runner documentation. Use current osa caller-mode `up`, `sync-in`, `run`, `collect-patch`, and stop operations; no osa helper behavior change is planned. Keep helper idle-stop disabled until patch handling finishes; a runner-owned idle-stop coordinator can cover the entire workspace operation.

Out of scope: new project-session UI, automatic conversation selection, cross-runner migration, cross-worktree reassignment/pooling, automatic deletion/GC, reviewer roles, reference repositories, incremental sync, and sandboxed self-check. If safe reuse requires a substantial new osa lifecycle API, report that dependency and scope a separate change rather than silently expanding this one.
