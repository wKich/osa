# Spec Delta

## ADDED Requirements

### Requirement: Per-repository merge request branches

For a follow-up on a task with open merge requests, each changed repository SHALL push its collected branch to that repository's recorded MR branch and SHALL update that repository's `taskRepositories` entry with that branch. The round MUST NOT use one repository's branch name for another repository, MUST NOT force-push a branch that repository does not own, and MUST NOT create a second MR for a repository that already has an open MR.

#### Scenario: Two repositories keep two branches
- **WHEN** a follow-up changes repos `g/a` with branch `feat/a` and `g/b` with branch `feat/b`
- **THEN** `g/a` is pushed to `feat/a`, `g/b` is pushed to `feat/b`, and each `taskRepositories` entry keeps its own branch name

#### Scenario: One changed repository does not touch the other
- **WHEN** a follow-up changes only `g/a`
- **THEN** `g/b` is not pushed and its MR and branch are not changed

### Requirement: Cancellation stops publication and collection

The round SHALL observe its cancellation signal in mirror refresh, collect, push, merge-request creation, and retry waits. Once the signal is aborted, no new push, branch update, or merge request SHALL start, and an in-flight GitLab or git call SHALL be bounded by a timeout and checked for cancellation before its next step. An in-flight push may complete, but no merge request SHALL be created after the abort is observed.

#### Scenario: Cancel during an MR retry leaves no MR
- **WHEN** a cancellation arrives while a merge-request creation is waiting to retry
- **THEN** the wait ends without another request, no merge request is created, and the task can be marked cancelled or requeued

#### Scenario: Cancel during collection stops the next repository
- **WHEN** a cancellation arrives after one repository's changes are collected
- **THEN** the round does not collect or publish another repository and reports the abort
