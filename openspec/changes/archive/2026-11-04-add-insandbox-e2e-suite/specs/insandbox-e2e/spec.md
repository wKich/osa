# Spec Delta

## Purpose

Provides the end-to-end scenario set that runs osa's four front-ends inside an
osa sandbox against the local control plane, asserting real files, processes,
patches, and state rather than recorded argv, and keeps that set honest by
comparing it with host-recorded real-gateway transcripts.

## ADDED Requirements

### Requirement: One scenario set runs every front-end without case edits

The suite SHALL run its scenarios against any of the four front-ends selected
at run time, exactly as the existing backend selection does, and MUST NOT
require a case body to change per front-end. A case that a front-end does not
apply to SHALL be listed as not applicable with a reason, and MUST NOT be
silently skipped.

#### Scenario: Selecting a front-end changes only the backend

- **WHEN** the suite runs with `maki-oss` selected and then with `opencode-oss` selected
- **THEN** the same scenario bodies run against each executable and no case file changes

#### Scenario: A non-applicable case is named

- **WHEN** a scenario does not apply to the selected front-end
- **THEN** the summary lists it as not applicable with its reason

### Requirement: A session moves real work

A session scenario SHALL create a sandbox, upload a working tree, run the
agent command, and collect the outcome, and SHALL assert the resulting files,
the process the agent ran as, the registry entry, and the sync markers. The
assertions SHALL be on observable effects, and MUST NOT depend on recorded
gateway argv.

#### Scenario: The agent's edit reaches the host tree

- **WHEN** a scripted agent edits, creates, and deletes files during a session
- **THEN** the host tree after the session contains exactly those changes

#### Scenario: The agent ran inside the sandbox workdir

- **WHEN** a scripted agent reports its working directory during a session
- **THEN** the report names the sandbox workdir, and the sandbox directory gained the files the agent wrote

#### Scenario: A failed agent run is reported as a failure

- **WHEN** the scripted agent exits non-zero
- **THEN** the command's exit status reflects the failure and the host tree is not silently applied

### Requirement: Caller mode round-trips a patch

The suite SHALL exercise `sync-in` followed by `collect-patch` against the
plane and assert the patch's content, its emptiness when the workdir is
unchanged, the reported file list, and the documented exit codes. It SHALL
assert that the sandbox workdir holds no host `.git` metadata.

#### Scenario: A patch carries the agent's changes

- **WHEN** `sync-in` uploads a tree and the scripted agent changes two files
- **THEN** `collect-patch` writes a patch that applies cleanly and reports both paths with their status letters

#### Scenario: An unchanged workdir yields an empty patch

- **WHEN** `collect-patch` runs after a sync with no agent change
- **THEN** the written file is empty and the JSON result reports `empty` true

### Requirement: Pending work is resolvable and guarded

The suite SHALL create pending work, then assert `resolve` for each of apply,
branch, and drop, and the refusal of `rm` while work is pending. Each result
SHALL be asserted from the state tree and the exit code.

#### Scenario: Apply clears the pending state

- **WHEN** `resolve` applies a retained patch
- **THEN** the project's pending marker is gone and the host tree holds the applied change

#### Scenario: Removal is refused while work is pending

- **WHEN** `rm --yes` runs with pending work present
- **THEN** the command exits as refused, the sandbox still exists, and the message names the pending work

### Requirement: Lifecycle and read commands reflect real state

The suite SHALL assert that `status`, `list`, `logs`, `doctor`, `policy`, and
`provider` reflect the plane's actual sandbox, log, and provider state, and
that `start` and `stop` change the phase the next command observes.

#### Scenario: Status reflects the sandbox that exists

- **WHEN** a sandbox is created and `status` runs for its project
- **THEN** the report names that sandbox and its phase

#### Scenario: Stop is observable

- **WHEN** `stop` runs and `status` follows
- **THEN** the observed phase is stopped

### Requirement: An interrupted session leaves resumable state

The suite SHALL interrupt a running session and assert that the sandbox lock is
released, the work produced before the interrupt is recoverable, and the next
session does not refuse to start.

#### Scenario: The lock is gone after an interrupt

- **WHEN** a session is interrupted while the agent runs
- **THEN** no lock file remains and the pending work is listed by `status`

#### Scenario: The next session starts

- **WHEN** a session runs again after the interrupt
- **THEN** it starts and completes, and it does not report a held lock

### Requirement: Cases are deterministic and offline

Every case SHALL use scripted agent binaries and SHALL run with no network.
Two runs of one case SHALL produce identical normalized artifacts, and a case
whose artifacts cannot be made stable SHALL be excluded with a stated reason.

#### Scenario: Two runs agree

- **WHEN** the same case runs twice in one sandbox
- **THEN** its normalized artifacts are byte-identical

#### Scenario: No case reaches the network

- **WHEN** the suite runs with egress unavailable
- **THEN** every case completes and none reports a network error

### Requirement: One optional real-agent turn

The suite SHALL provide at most one case that runs a real agent for a single
headless turn through the sandbox's existing provider attachment. It SHALL be
opt-in, SHALL be skipped by name with a stated reason when no provider is
attached, and SHALL assert only that the turn completed and produced a
change — never a model's wording.

#### Scenario: Skipped without a provider

- **WHEN** the suite runs in a sandbox with no provider attached
- **THEN** the case is reported as skipped with that reason and the suite's verdict does not depend on it

#### Scenario: The turn is asserted by effect

- **WHEN** the case runs with a provider attached
- **THEN** it asserts the agent exited successfully and the workdir changed

### Requirement: A host recording keeps the plane honest

The suite SHALL compare the same scenarios against committed transcripts
recorded from a real gateway on a host, using the existing parity mode. A
divergence SHALL fail naming the case and the differing field, and SHALL be
fixed by correcting the plane rather than by widening normalization.

#### Scenario: A matching plane reports identical

- **WHEN** the same scenario runs in a sandbox against the plane and on a host against a gateway
- **THEN** the comparison reports identical

#### Scenario: Drift is named

- **WHEN** the plane records a different operation than the committed host transcript
- **THEN** the comparison reports the divergence, names the case and the field, and exits non-zero

### Requirement: The suite states what a pass proves

The suite's summary SHALL name the layer it covers — session orchestration —
and SHALL state that it proves nothing about isolation, policy, egress, or
credential brokering. It MUST NOT emit a boundary or isolation result, and a
documented claim table SHALL map each suite to the layer it is authoritative
for.

#### Scenario: The summary is scoped

- **WHEN** the suite finishes, passing or failing
- **THEN** its summary names orchestration as the layer covered and states that isolation is not covered

#### Scenario: No boundary verdict exists

- **WHEN** the suite exits successfully
- **THEN** its output contains no claim about policy, egress, host visibility, or credentials
