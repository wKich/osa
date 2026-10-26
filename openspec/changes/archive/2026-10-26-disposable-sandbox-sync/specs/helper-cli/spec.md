# Spec Delta

## MODIFIED Requirements

### Requirement: Idempotent sandbox lifecycle

`maki-oss up` SHALL start the project's sandbox when it exists and is stopped, and SHALL create it when absent, never creating a second sandbox with the same name. `maki-oss up` SHALL remain create/start-only and SHALL NOT upload the project. `maki-oss status` SHALL report existence, phase, image, attached providers, sync state (`clean`, `behind`, `retained`, or `parked`), any retained patch path, and the next command for that state. `maki-oss rm` SHALL refuse to delete a parked workspace unless the user passes `--discard`, and SHALL archive instance-scoped sync state when it deletes a sandbox. Sandbox phase and provider lookups MUST give the same result whatever the gateway's JSON layout is (pretty-printed, compact, or a single line listing several sandboxes), with or without `jq` installed.

#### Scenario: First run creates the sandbox
- **WHEN** no sandbox named `maki-myproject` exists and the user runs `maki-oss up` in `~/code/myproject`
- **THEN** a sandbox named `maki-myproject` is created from the configured image, policy, and providers

#### Scenario: Second run starts the same sandbox
- **WHEN** the sandbox exists in `Stopped` phase and the user runs `maki-oss up` again
- **THEN** the existing sandbox is started and no new sandbox is created

#### Scenario: Status reports sync state
- **WHEN** the user runs `maki-oss status` for a project sandbox
- **THEN** the output names one of `clean`, `behind`, `retained`, or `parked` and the next command for that state

#### Scenario: Rm refuses a parked workspace
- **WHEN** the workspace is parked and the user runs `maki-oss rm --yes`
- **THEN** no delete request is sent and the error names the `--discard` command

#### Scenario: Rm archives state for a disposable sandbox
- **WHEN** the workspace is not parked and the user confirms `maki-oss rm`
- **THEN** the sandbox is deleted and its instance-scoped sync state is archived

#### Scenario: Compact JSON without jq still resolves the phase
- **WHEN** `jq` is not installed and `openshell sandbox list --output json` returns compact JSON such as `{"sandboxes":[{"name":"maki-a","phase":"Stopped"}]}`
- **THEN** `maki-oss status` reports phase `Stopped` for `maki-a` and `maki-oss up` does not attempt a second create

#### Scenario: Single-line JSON never yields another sandbox's phase
- **WHEN** `jq` is not installed and the sandbox list is one line containing several sandboxes, where `maki-a` is `Stopped` and a later sandbox is `Ready`
- **THEN** the reported phase for `maki-a` is `Stopped`, not `Ready`

#### Scenario: Concurrent create race resolves to reuse
- **WHEN** two `maki-oss` runs race to create the same project sandbox and the second create reports that the name already exists
- **THEN** the second run re-checks the sandbox and continues by reusing it instead of exiting with a gateway error

### Requirement: Project transfer in and out

`maki-oss upload [path] [dest]` SHALL copy local files into the sandbox using `openshell sandbox upload` and SHALL NOT create a bind mount or any other host filesystem exposure. When the destination is the project workspace, upload SHALL refresh the tracked tree: it SHALL upload the current host tree and SHALL remove tracked files that the previous refresh placed in the workspace but the current host tree no longer contains, while preserving gitignored sandbox-local artifacts. Upload SHALL refuse when the workspace is parked unless `--discard` is passed; `maki-oss upload --discard` SHALL discard the parked output and refresh, while keeping patch files on disk. Upload SHALL warn, without refusing, when a retained patch is unapplied. On success it SHALL record the new baseline and synced pair and SHALL keep the retained patch available for review. `maki-oss download [path] [dest]` SHALL copy files from the sandbox workspace to an explicit host destination.

#### Scenario: Upload never mounts
- **WHEN** the user runs `maki-oss upload .`
- **THEN** the helper invokes `openshell sandbox upload` and its argv contains no mount or bind option

#### Scenario: Upload mirrors a tracked deletion
- **WHEN** the host deletes a tracked file that the previous refresh placed in the workspace and the user runs `maki-oss upload`
- **THEN** the file is absent from the sandbox workspace after the upload

#### Scenario: Upload preserves gitignored artifacts
- **WHEN** the sandbox workspace contains a gitignored dependency directory such as `node_modules` or `.venv` and the user runs `maki-oss upload`
- **THEN** that directory is preserved

#### Scenario: Upload refuses a parked workspace
- **WHEN** the workspace is parked and the user runs `maki-oss upload` without `--discard`
- **THEN** no upload is recorded and the error names the `--discard` and download commands

#### Scenario: Upload discards a parked workspace
- **WHEN** the workspace is parked and the user runs `maki-oss upload --discard`
- **THEN** the refresh proceeds, the parked state is cleared, and existing patch files remain on disk

#### Scenario: Upload warns about a retained patch
- **WHEN** a retained patch is unapplied and the user runs `maki-oss upload`
- **THEN** the refresh proceeds, the retained patch remains available, and the output names its path

#### Scenario: Subpath upload keeps copy-in semantics
- **WHEN** the user runs `maki-oss upload ./dist /sandbox/project/dist`
- **THEN** only that path is copied and no tracked-file pruning is attempted

### Requirement: One-command project session

Bare `maki-oss` (no subcommand), `maki-oss maki`, and `maki-oss run "<prompt>"` SHALL share an idempotent ensure routine before launching Maki: resolve remembered providers from configuration, create the project sandbox when absent using the configured image, policy, resources, and remembered providers, start it when stopped, attach any remembered provider that is not currently attached, and make the workspace match the host under the disposable-workspace rules. The routine SHALL refresh the tracked project tree from the host when the host tree differs from the last synced host tree and the workspace has no output without a durable patch. It SHALL refresh a `retained` workspace before launching Maki even when the host tree matches. It SHALL skip the upload when the host and sandbox trees match and no retained patch is pending, and it MUST NOT upload over a parked workspace. It SHALL refuse to launch Maki while the workspace is parked and SHALL print the download or discard command. It SHALL announce whether it reused without uploading, refreshed the workspace, or refused. The explicit `maki-oss up` command SHALL remain create/start-only, and explicit `upload`, `download`, and `provider attach` SHALL keep their manual semantics.

#### Scenario: Fresh project starts in one command
- **WHEN** no sandbox exists for the project and the user runs `maki-oss` (or `maki-oss run "<prompt>"`) in the project directory with providers remembered
- **THEN** the sandbox is created with those providers, the project is uploaded once, and Maki runs in the sandbox workspace

#### Scenario: Existing sandbox is reused without upload
- **WHEN** the project sandbox exists in `Ready` phase, the host tree matches the last synced host tree, and the user runs bare `maki-oss`
- **THEN** the existing sandbox is reused and no upload invocation is recorded

#### Scenario: Reuse without upload is announced
- **WHEN** a session reuses an existing sandbox without an upload
- **THEN** stderr states that the workspace is already current and no refresh was needed

#### Scenario: Changed host refreshes on reuse
- **WHEN** the project sandbox exists, the host tree differs from the last synced host tree, the workspace has no output without a durable patch, and the user runs bare `maki-oss`
- **THEN** the helper uploads the current host tree before Maki runs and records the new baseline

#### Scenario: Reuse refresh is announced
- **WHEN** a session reuses an existing sandbox and refreshes the workspace
- **THEN** stderr carries a note that the workspace was refreshed from the host

#### Scenario: Uncollected sandbox output is not overwritten
- **WHEN** the sandbox workspace contains output without a durable patch
- **THEN** the helper does not upload over it, treats the workspace as parked, and refuses to launch Maki until the output is downloaded or discarded

#### Scenario: Parked workspace refuses to launch
- **WHEN** a session is requested for a parked workspace
- **THEN** the helper starts no Maki process and prints the download or discard command

#### Scenario: Stopped sandbox is started
- **WHEN** the project sandbox exists in `Stopped` phase
- **THEN** the helper starts the existing sandbox and no second sandbox is created

#### Scenario: Missing provider attachment is repaired
- **WHEN** a remembered provider is not attached to the project sandbox
- **THEN** the helper attaches it with `--wait` before launching Maki

#### Scenario: Explicit up stays create-only
- **WHEN** the user runs `maki-oss up`
- **THEN** only create/start behavior runs: no upload and no Maki launch

### Requirement: Session sync-back

When a Maki session launched by bare `maki-oss`, `maki-oss maki`, or `maki-oss run` ends, including non-zero exits and interrupts, the helper SHALL collect the sandbox workspace changes as a patch relative to the baseline the sandbox session started from, unless `--no-sync` is set. The helper SHALL apply that patch to the local project only when the safety check for the project's mode passes; otherwise it SHALL leave every local file unchanged and retain the patch for review. A retained patch SHALL NOT freeze the workspace: the next session SHALL refresh a retained workspace before launching Maki while the patch waits for the user. When collection fails, the helper SHALL park the workspace because no durable patch exists. When `--no-sync` is passed, the helper SHALL park the workspace and SHALL print the explicit download command. The helper MUST NOT overwrite the project with an automatic overlay of the sandbox workdir. A failed collection, application, or safety check SHALL warn on stderr without replacing Maki's exit code. In `maki-oss run`, helper output SHALL go to stderr so stdout carries Maki's output unchanged.

#### Scenario: Interactive exit syncs changes back
- **WHEN** the user exits an interactive session after Maki changed files and the project's safety check passes
- **THEN** the agent's changes are applied to the project, and files the agent did not change are left as they were on the host

#### Scenario: Conflicting host changes leave the project unchanged
- **WHEN** the user changed a file during the session and the sandbox also changed that file
- **THEN** no local file is overwritten, the patch is retained, and the helper reports how to review the conflict

#### Scenario: Retained patch does not freeze the workspace
- **WHEN** a previous session retained a patch because it could not be applied and the user starts a new session
- **THEN** the helper refreshes the workspace before Maki launches, and the retained patch remains available for review

#### Scenario: Headless run syncs without polluting stdout
- **WHEN** `maki-oss run "<prompt>"` finishes
- **THEN** the patch is applied or retained according to the safety check, stdout contains only Maki's output, and the exit code is Maki's

#### Scenario: Interrupt still syncs
- **WHEN** the interactive session is interrupted with SIGINT
- **THEN** the helper attempts the same patch collection before exiting

#### Scenario: No-sync opt-out
- **WHEN** `--no-sync` is passed
- **THEN** no patch is collected, the workspace is parked, and the helper prints the manual download command

#### Scenario: Collection failure parks the workspace
- **WHEN** patch collection fails and no durable patch exists
- **THEN** the workspace is parked and the recovery commands are printed

#### Scenario: Sync failure preserves Maki's status
- **WHEN** patch collection or application fails
- **THEN** a warning goes to stderr and the helper exits with Maki's code, not the failure's

### Requirement: Session baseline and freshness

Before Maki runs, the helper SHALL record a baseline that identifies the sandbox instance by its OpenShell sandbox ID, the host commit and branch when the project is a git repository and the host `git` binary is available, the baseline tree hash, whether the working tree was clean, dirty, or had untracked non-ignored files, the sandbox tree, and the host/sandbox tree pair recorded at the last refresh or clean apply. At session start the helper SHALL classify the workspace as one of:

- `clean`: the host and sandbox trees match the recorded pair.
- `behind`: the host tree differs from the recorded host tree and the sandbox tree matches the recorded sandbox tree.
- `retained`: a collected patch for sandbox output exists on the host, its recorded result tree matches the sandbox tree, and it has not been applied.
- `parked`: the sandbox contains output that no retained patch covers, because collection failed, `--no-sync` was used, the sandbox was edited outside the helper, or the sandbox changed after collection.

A retained patch whose result tree no longer matches the sandbox is an advisory notice; it does not change a `clean` or `behind` classification.

The helper MUST NOT upload over a parked workspace. It SHALL refresh a `behind` workspace. It SHALL refresh a `retained` workspace before the next session, even when the host tree matches the recorded host tree. It MAY refresh a `clean` workspace; it SHALL skip the upload when the host and sandbox trees already match. A retained patch that is only a notice does not force an upload. Before using the automatic apply path, the helper SHALL compare the host baseline tree with the sandbox baseline tree. If they differ, the helper MUST NOT fast-forward or silently apply changes from a workspace the host has not accepted. When the recorded sandbox ID differs from the current sandbox ID, the helper SHALL treat the recorded state as belonging to a previous instance and MUST NOT let it park or block the new sandbox.

#### Scenario: Clean baseline is recorded
- **WHEN** a session starts in a clean git repository whose working tree matches the uploaded tree
- **THEN** the helper records the sandbox ID, the current commit, branch, and tree, and the automatic apply path is eligible after a successful patch check

#### Scenario: Dirty or untracked baseline is recorded
- **WHEN** a session starts with uncommitted changes or untracked non-ignored files
- **THEN** the recorded baseline includes those files, and the helper does not treat the commit alone as the baseline

#### Scenario: Host changed only is behind and refreshable
- **WHEN** the host tree differs from the recorded host tree and the sandbox tree matches the recorded sandbox tree
- **THEN** the helper classifies the workspace as `behind` and refreshes it from the host

#### Scenario: Sandbox output without a durable patch is parked
- **WHEN** the sandbox tree differs from the recorded sandbox tree and no retained patch covers that output
- **THEN** the helper classifies the workspace as `parked` and does not upload over it

#### Scenario: Retained patch allows a refresh
- **WHEN** the sandbox tree differs from the recorded sandbox tree and a retained patch covers that output
- **THEN** the helper refreshes the workspace before the next session and keeps the retained patch available

#### Scenario: Matching trees skip the upload
- **WHEN** the host tree and sandbox tree already match the recorded pair
- **THEN** the helper records the session baseline and does not upload

#### Scenario: State from a previous sandbox instance is ignored
- **WHEN** the recorded sandbox ID differs from the current sandbox ID
- **THEN** the helper does not inherit `parked` or `retained` state from the previous instance

#### Scenario: Stale sandbox blocks the automatic path
- **WHEN** the sandbox baseline tree differs from the host baseline tree
- **THEN** the helper does not fast-forward or silently apply the patch, and it reports whether the patch was retained or the workspace was parked

### Requirement: Fail-closed recovery

When patch collection fails, the helper SHALL write nothing to the project, SHALL park the workspace because no durable patch exists, SHALL leave the changes in the sandbox, and SHALL print recovery commands that include the sandbox name, the workspace path, how to inspect the sandbox, and how to copy a specific path with `maki-oss download`. When baseline verification or application fails and the collected patch exists, the helper SHALL write nothing to the project, SHALL retain the patch, SHALL NOT park the workspace, and SHALL print review commands. A retained patch SHALL remain available until the user applies it; the helper MAY clear the notice when it detects the patch is already applied. The helper MUST NOT automatically download the whole sandbox workspace to the host as a fallback. A full copy SHALL occur only when the user explicitly runs `maki-oss download`. `maki-oss upload` MUST refuse a parked workspace unless `--discard` is passed, and `maki-oss rm` MUST refuse a parked workspace unless `--discard` is passed. When a sandbox is recreated, state recorded for the previous instance MUST NOT block the new sandbox; the helper SHALL archive or clear it. The helper SHALL record whether the workspace is `retained` or `parked` and SHALL use that classification in later sessions.

#### Scenario: Collection failure leaves the project untouched
- **WHEN** the helper cannot collect a patch because of a sandbox, git, or baseline error
- **THEN** no local file is changed, the workspace is parked, and the recovery commands are printed

#### Scenario: Application failure leaves the project untouched
- **WHEN** the patch cannot be applied safely
- **THEN** no local file is changed, the patch is retained, the workspace is not parked, and the patch path is printed

#### Scenario: Recovery names the sandbox and path
- **WHEN** the helper fails closed
- **THEN** the message names the sandbox, the workspace path, an inspection command, and a path-copy command

#### Scenario: Full copy is explicit only
- **WHEN** the helper fails closed
- **THEN** it does not run a full workspace download, and a full copy occurs only when the user invokes `maki-oss download`

#### Scenario: Retained patch does not block automatic refresh
- **WHEN** a previous session retained a patch and the user starts a new session for the same sandbox
- **THEN** the helper refreshes the retained workspace and reports the retained patch for review

#### Scenario: Pending patch blocks automatic refresh
- **WHEN** a previous session parked the workspace and the user starts a new session for the same sandbox
- **THEN** the helper does not upload over the workspace or automatically apply a new patch, and it reports the download or `--discard` command

#### Scenario: Recreated sandbox ignores a dead instance's marker
- **WHEN** a sandbox is recreated under the same name and the recorded sandbox ID belongs to the previous instance
- **THEN** the new sandbox is not parked by that marker and its first session refreshes normally

#### Scenario: No-sync parks the workspace
- **WHEN** a session ends with `--no-sync`
- **THEN** the workspace is parked and the next session refuses to refresh it until the user downloads or discards the output

#### Scenario: Rm refuses a parked workspace
- **WHEN** the workspace is parked and the user runs `maki-oss rm --yes`
- **THEN** no delete request is sent and the error names the `--discard` command
