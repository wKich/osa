# Spec Delta

## MODIFIED Requirements

### Requirement: Fail-closed recovery

When patch collection fails, the helper SHALL write nothing to the project, SHALL park the workspace because no durable patch exists, SHALL leave the changes in the sandbox, and SHALL print recovery commands that include the sandbox name, the workspace path, how to inspect the sandbox, how to copy a specific path with `maki-oss download`, and the `osa resolve <sandbox> rescue` and `osa resolve <sandbox> discard --yes` commands. When baseline verification or application fails and the collected patch exists, the helper SHALL write nothing to the project, SHALL retain the patch, SHALL NOT park the workspace, and SHALL print review commands, including `osa resolve <sandbox> apply`, `branch`, and `drop --yes`. A retained patch SHALL remain available until the user applies, branches, or drops it; the helper MAY clear the notice when it detects the patch is already applied. The helper MUST NOT automatically download the whole sandbox workspace to the host as a fallback. A full copy SHALL occur only when the user explicitly runs `maki-oss download` or `osa resolve <sandbox> rescue`. `maki-oss upload` MUST refuse a parked workspace unless `--discard` is passed, and `maki-oss rm` MUST refuse a parked workspace unless `--discard` is passed. When a sandbox is recreated, state recorded for the previous instance MUST NOT block the new sandbox; the helper SHALL archive or clear it. The helper SHALL record whether the workspace is `retained` or `parked` and SHALL use that classification in later sessions.

#### Scenario: Collection failure leaves the project untouched
- **WHEN** the helper cannot collect a patch because of a sandbox, git, or baseline error
- **THEN** no local file is changed, the workspace is parked, and the recovery commands are printed

#### Scenario: Application failure leaves the project untouched
- **WHEN** the patch cannot be applied safely
- **THEN** no local file is changed, the patch is retained, the workspace is not parked, and the patch path is printed

#### Scenario: Recovery names the sandbox and path
- **WHEN** the helper fails closed
- **THEN** the message names the sandbox, the workspace path, an inspection command, and a path-copy command

#### Scenario: Recovery names the osa resolve commands
- **WHEN** the helper retains a patch at session exit
- **THEN** the message includes `osa resolve <sandbox> apply`, `osa resolve <sandbox> branch`, and `osa resolve <sandbox> drop --yes` with the real sandbox name

#### Scenario: Full copy is explicit only
- **WHEN** the helper fails closed
- **THEN** it does not run a full workspace download, and a full copy occurs only when the user invokes `maki-oss download` or `osa resolve <sandbox> rescue`

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
