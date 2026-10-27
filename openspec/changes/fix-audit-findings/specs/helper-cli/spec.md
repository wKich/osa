# Spec Delta

## MODIFIED Requirements

### Requirement: Project transfer in and out

`maki-oss upload [path] [dest]` SHALL copy local files into the sandbox using `openshell sandbox upload` and SHALL NOT create a bind mount or any other host filesystem exposure. When the destination is the project workspace and no explicit path is given, or the explicit path is the workspace root `.`, upload SHALL refresh the tracked tree: it SHALL upload the current host tree and SHALL remove tracked files that the previous refresh placed in the workspace but the current host tree no longer contains, while preserving gitignored sandbox-local artifacts. When an explicit path other than `.` is given, upload SHALL copy only that path to the requested destination, MUST NOT substitute the current directory, and MUST NOT prune or refresh the full tree. Upload SHALL refuse to copy when the workspace is parked. A full workspace refresh with `--discard` SHALL discard the parked output and proceed, while keeping patch files on disk. A partial copy into a parked workspace SHALL be refused even with `--discard`; `--discard` applies only to a full refresh. Upload SHALL warn, without refusing, when a retained patch is unapplied. Only a full workspace refresh SHALL record the new baseline and synced pair; a partial copy-in MUST NOT alter the recorded baseline, host manifest, synced pair, or project fingerprint, and SHALL leave the workspace classification to the normal freshness check. `maki-oss download [path] [dest]` SHALL copy files from the sandbox workspace to an explicit host destination.

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
- **WHEN** the workspace is parked and the user runs `maki-oss upload . --discard`
- **THEN** the full refresh proceeds, the parked state is cleared, and existing patch files remain on disk

#### Scenario: Upload warns about a retained patch
- **WHEN** a retained patch is unapplied and the user runs `maki-oss upload`
- **THEN** the refresh proceeds, the retained patch remains available, and the output names its path

#### Scenario: Subpath upload keeps copy-in semantics
- **WHEN** the user runs `maki-oss upload ./dist /sandbox/project/dist`
- **THEN** only that path is copied and no tracked-file pruning is attempted

#### Scenario: Explicit path with the default destination copies only that path
- **WHEN** the user runs `maki-oss upload ./notes.txt` with no destination
- **THEN** `notes.txt` is copied into the workspace, another file in the current directory is not uploaded, and no full-tree refresh or synced pair is recorded

#### Scenario: Partial upload does not claim the workspace is current
- **WHEN** a full refresh was recorded, the host later edits a tracked file, and the user copies one path into the workspace
- **THEN** the next status or session still sees the host change and does not treat the workspace as clean

#### Scenario: Partial copy-in does not clear a parked marker
- **WHEN** the workspace is parked and the user runs `maki-oss upload ./dist --discard`
- **THEN** the helper refuses the copy with the parked-workspace error, the parked marker remains, and only a full `maki-oss upload --discard` can replace the workspace
