## ADDED Requirements

### Requirement: Answer workspace routes from the sandbox checkout
The bridge SHALL answer the branch and project routes the TUI reads at
boot — `GET /api/vcs`, `GET /api/project` and `GET /api/location` — from the
git state of the sandbox workdir, read over the sandbox exec transport. The
branch SHALL be read on every `GET /api/vcs`. The project id SHALL be the
repository's first root commit, or `global` when the workdir is not a
repository, and every answer that names a project, including session objects,
SHALL carry that same id.

#### Scenario: The footer branch is the sandbox branch
- **WHEN** the sandbox workdir has `feature/route-queue` checked out from a
  clone whose origin's default branch is `main`
- **THEN** `GET /api/vcs` answers `{provider: "git", branch: {current:
  "feature/route-queue", default: "main"}}`, and a later checkout in the
  sandbox shows on the next read

#### Scenario: One project id everywhere
- **WHEN** the TUI reads the project list and its location and creates a
  session in a repository workdir
- **THEN** each names the repository's root commit as the project id, and the
  project carries the workdir as `canonical`, its basename as `name` and
  `vcs: "git"`

#### Scenario: A workdir outside git
- **WHEN** the sandbox workdir is not a git repository
- **THEN** `GET /api/vcs` answers an empty `branch` object and the project id
  is `global` with no `vcs`
