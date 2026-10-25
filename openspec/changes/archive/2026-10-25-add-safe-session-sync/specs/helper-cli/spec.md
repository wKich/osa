# Spec Delta

## MODIFIED Requirements

### Requirement: Session sync-back
When a Maki session launched by bare `maki-oss`, `maki-oss maki`, or
`maki-oss run` ends, including non-zero exits and interrupts, the helper SHALL
collect the sandbox workspace changes as a patch relative to the baseline the
sandbox session started from, unless `--no-sync` is set. The helper SHALL apply
that patch to the local project only when the safety check for the project's
mode passes; otherwise it SHALL leave every local file unchanged and retain the
patch and the sandbox changes for review. The helper MUST NOT overwrite the
project with an automatic overlay of the sandbox workdir. A failed collection,
application, or safety check SHALL warn on stderr without replacing Maki's exit
code. In `maki-oss run`, helper output SHALL go to stderr so stdout carries
Maki's output unchanged.

#### Scenario: Interactive exit syncs changes back
- **WHEN** the user exits an interactive session after Maki changed files and the project's safety check passes
- **THEN** the agent's changes are applied to the project, and files the agent did not change are left as they were on the host

#### Scenario: Conflicting host changes leave the project unchanged
- **WHEN** the user changed a file during the session and the sandbox also changed that file
- **THEN** no local file is overwritten, the patch is retained, and the helper reports how to review the conflict

#### Scenario: Headless run syncs without polluting stdout
- **WHEN** `maki-oss run "<prompt>"` finishes
- **THEN** the patch is applied or retained according to the safety check, stdout contains only Maki's output, and the exit code is Maki's

#### Scenario: Interrupt still syncs
- **WHEN** the interactive session is interrupted with SIGINT
- **THEN** the helper attempts the same patch collection before exiting

#### Scenario: No-sync opt-out
- **WHEN** `--no-sync` is passed
- **THEN** no patch is collected and the helper prints the manual `download` command instead

#### Scenario: Sync failure preserves Maki's status
- **WHEN** patch collection or application fails
- **THEN** a warning goes to stderr and the helper exits with Maki's code, not the failure's

## ADDED Requirements

### Requirement: Session baseline and freshness
Before Maki runs, the helper SHALL record a baseline that identifies the tree
uploaded to the sandbox: the host commit and branch when the project is a git
repository and the host `git` binary is available, the baseline tree hash, and
whether the working tree was clean, dirty, or had untracked non-ignored files. The sandbox SHALL record the tree of
the uploaded baseline. Before using the automatic apply path, the helper SHALL
compare the host baseline tree with the sandbox baseline tree. If they differ,
the helper MUST NOT fast-forward or silently apply changes from the stale
sandbox; it SHALL refresh the sandbox from the baseline or retain the patch and
report the mismatch.

#### Scenario: Clean baseline is recorded
- **WHEN** a session starts in a clean git repository whose working tree matches the uploaded tree
- **THEN** the helper records the current commit, branch, and tree, and the automatic apply path is eligible after a successful patch check

#### Scenario: Dirty or untracked baseline is recorded
- **WHEN** a session starts with uncommitted changes or untracked non-ignored files
- **THEN** the recorded baseline includes those files, and the helper does not treat the commit alone as the baseline

#### Scenario: Stale sandbox blocks the automatic path
- **WHEN** the sandbox baseline tree differs from the host baseline tree
- **THEN** the helper does not fast-forward or silently apply the patch, and it reports that the sandbox must be refreshed or the patch reviewed

### Requirement: Git repository apply path
The helper SHALL use a temporary git worktree when the project is a git
repository, the upload used the default `.gitignore` filtering, and the host
`git` binary is available. For a clean baseline at `HEAD`, the worktree SHALL
be created at that commit. For a dirty
or untracked baseline, the helper SHALL create a synthetic baseline commit
whose tree is the current working tree and whose parent is `HEAD`, and SHALL
create the worktree at that commit. The helper SHALL apply the patch in the
worktree and commit the result on a temporary branch. The helper SHALL
fast-forward the host branch only when the host is still on the recorded branch
at the recorded commit with no tracked changes, and SHALL then remove the
temporary worktree and branch. When the host moved, is dirty, or the patch
conflicts, the helper SHALL keep the branch and worktree and report how to
review, cherry-pick, or merge it. A dirty or untracked baseline MUST NOT be
fast-forwarded automatically, because that would commit the user's uncommitted
work. When the upload used `--no-git-ignore`, the helper SHALL NOT create the
worktree and SHALL use the plain-directory patch check instead.

#### Scenario: Clean host fast-forwards
- **WHEN** the host is still on the recorded branch at the recorded commit with no tracked changes and the patch applies cleanly in the temporary worktree
- **THEN** the helper fast-forwards the host branch, removes the temporary worktree, and deletes the temporary branch

#### Scenario: Host moved during the session
- **WHEN** the host branch has a new commit or a different checked-out branch at session end
- **THEN** the helper does not fast-forward, retains the temporary branch and worktree, and prints the review and merge commands

#### Scenario: Dirty baseline keeps the result branch
- **WHEN** the session started with uncommitted or untracked work and the patch applies in the synthetic-baseline worktree
- **THEN** the helper keeps the temporary branch and worktree, does not fast-forward, and identifies the result commit for cherry-pick

#### Scenario: Patch conflict keeps the review surface
- **WHEN** the patch does not apply cleanly in the temporary worktree
- **THEN** the helper leaves the host unchanged, retains the patch and worktree, and reports the conflict for manual resolution

#### Scenario: Untracked files changed by Maki
- **WHEN** Maki changed a file that was untracked on the host
- **THEN** the helper reports that cherry-pick may require the path to be added first, or that the patch may be applied directly, and the changes remain available in the review worktree

#### Scenario: Unfiltered upload uses the patch check
- **WHEN** the session uploaded the project with `--no-git-ignore`
- **THEN** the helper does not create a worktree or fast-forward, and it applies the patch through the plain-directory check

### Requirement: Plain directory apply path
When the project is not a git repository, or the host `git` binary is
unavailable, the helper SHALL NOT require a repository. When the `git` binary
is available, it SHALL apply the patch with `git apply --check` followed by
`git apply`; when the check fails, it MUST
leave the project unchanged and retain the patch. When `git` is not available,
the helper SHALL use `patch` or `diff3` for text changes, a hash-manifest
selective export for binary changes, or fail closed when neither is available.
The helper MUST NOT download the sandbox workdir over the project
automatically.

#### Scenario: Plain directory applies a clean patch
- **WHEN** the project is a plain directory and `git apply --check` succeeds
- **THEN** the helper applies the patch, and host-only files remain untouched

#### Scenario: Plain directory conflict keeps the project
- **WHEN** the project is a plain directory and `git apply --check` fails
- **THEN** no local file is changed, the patch is retained, and the helper reports the path for review

#### Scenario: Plain directory without git handles text changes
- **WHEN** the `git` binary is unavailable and the patch contains only text changes
- **THEN** the helper uses `patch` or `diff3` and reports any conflicts without overwriting unrelated files

#### Scenario: Plain directory without an apply tool fails closed
- **WHEN** the project is a plain directory, `git` is unavailable, and no text merge tool is available
- **THEN** the helper writes nothing to the project and leaves the changes in the sandbox for explicit recovery

### Requirement: Fail-closed recovery
When patch collection, baseline verification, or application fails, the helper
SHALL write nothing to the project, SHALL retain the collected patch, SHALL
leave the changes in the sandbox, and SHALL print recovery commands that
include the sandbox name, the workspace path, how to inspect the sandbox, and
how to copy a specific path with `maki-oss download`. The helper MUST NOT
automatically download the whole sandbox workspace to the host as a fallback.
A full copy SHALL occur only when the user explicitly runs `maki-oss download`.
The helper SHALL record a pending marker for the sandbox. While the marker
exists, a later session MUST NOT automatically upload over the sandbox or
automatically apply a new patch without the user resolving or explicitly
discarding the pending changes.

#### Scenario: Collection failure leaves the project untouched
- **WHEN** the helper cannot collect a patch because of a sandbox, git, or baseline error
- **THEN** no local file is changed and the recovery commands are printed

#### Scenario: Application failure leaves the project untouched
- **WHEN** the patch cannot be applied safely
- **THEN** no local file is changed and the patch path is printed

#### Scenario: Recovery names the sandbox and path
- **WHEN** the helper fails closed
- **THEN** the message names the sandbox, the workspace path, an inspection command, and a path-copy command

#### Scenario: Full copy is explicit only
- **WHEN** the helper fails closed
- **THEN** it does not run a full workspace download, and a full copy occurs only when the user invokes `maki-oss download`

#### Scenario: Pending patch blocks automatic refresh
- **WHEN** a previous session left a pending patch and the user starts a new session for the same sandbox
- **THEN** the helper does not upload over the sandbox or automatically apply a new patch, and it reports the pending patch for resolution

### Requirement: Patch content and git isolation
The collected patch SHALL carry additions, modifications, deletions, renames,
and binary changes that Maki made inside the sandbox workspace, and SHALL NOT
carry the sandbox's `.git` directory or any host `.git` metadata. The helper
MUST NOT upload the host `.git` directory to the sandbox or download a
sandbox `.git` directory into the host project. Applying a patch SHALL
preserve host-only files and ignored host files unless the patch explicitly
changes a path.

#### Scenario: Deletion travels back
- **WHEN** Maki deletes a file inside the sandbox workspace and the patch applies
- **THEN** the corresponding host file is deleted

#### Scenario: Rename travels back
- **WHEN** Maki renames a file inside the sandbox workspace and the patch applies
- **THEN** the host file is renamed rather than duplicated

#### Scenario: Host-only file is preserved
- **WHEN** a host file does not exist in the sandbox and the patch applies
- **THEN** the host file remains unchanged

#### Scenario: Agent-created git metadata stays in the sandbox
- **WHEN** Maki creates a `.git` directory inside the sandbox workspace
- **THEN** the host `.git` directory is not modified and the sandbox `.git` is not part of the applied patch

#### Scenario: Binary change travels back
- **WHEN** Maki changes a binary file and the patch applies
- **THEN** the host file contains the sandbox version
