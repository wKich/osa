## ADDED Requirements

### Requirement: Review the sandbox checkout's changes
The bridge SHALL answer `GET /api/vcs/diff`, `GET /api/vcs/base`, and
`GET /api/vcs/status` from the sandbox checkout with the pinned git
provider's rules: the review base is the reflog's creation branch or the
default branch, `branch` diffs the working tree against the merge base with
it, `working` against `HEAD`, `committed` from the merge base to `HEAD`,
untracked files are added files, patches carry whole-file context unless
`context` is given, and files are sorted. A provider failure SHALL answer
503 `ServiceUnavailableError`. The project and location reads SHALL reflect
a repository created after the bridge started.

#### Scenario: The diff viewer shows the change against main
- **WHEN** the agent commits `notes.txt` on `main` and then appends a line
- **THEN** `/diff` shows `All · vs main` with `notes.txt +1 -0` and the
  whole-file hunk, and the footer names the `main` branch
