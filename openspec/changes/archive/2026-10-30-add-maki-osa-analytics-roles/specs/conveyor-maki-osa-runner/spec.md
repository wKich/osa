# Spec Delta

## ADDED Requirements

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
