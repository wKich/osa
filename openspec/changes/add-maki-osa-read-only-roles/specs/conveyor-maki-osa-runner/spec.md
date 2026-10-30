# Spec Delta

## ADDED Requirements

### Requirement: Read-only roles run without applying changes

For a `maki-osa` run whose role is `researcher`, `architect`, `decomposer`, `planner`, `mrwriter`, `dutyresponder`, `consultant`, `mrreviewer`, `testanalyst`, or `reviewer`, the runner SHALL execute the caller lifecycle `up`, `sync-in`, and `maki-oss run -` and SHALL NOT invoke `collect-patch` or apply any patch to the host worktree. It SHALL return the agent outcome as the run outcome.

The host worktree SHALL remain unchanged by such a run. A file the agent changed in the sandbox workdir SHALL NOT reach the host, and the next `sync-in` for that workspace SHALL replace the workdir from the host tree.

The runner SHALL continue to refuse `speceditor`, `contextcollector`, `specanalyst`, `specreviewer`, and `selfcheck` before starting any helper command.

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
