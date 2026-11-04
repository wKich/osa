# boundary-verification Specification

## Purpose

Provides the host-only gate that produces a real boundary verdict: it composes
the full suite, the live journey run, and scripted isolation checks, receives
sandbox-authored work as a patch, and scopes every result to the layer it
actually proves.

## Requirements

### Requirement: One host gate produces the boundary verdict

The repository SHALL provide `make test-boundary`, which runs `make test-all`,
the live journey run against a real gateway, and the scripted isolation checks.
The gate SHALL exit non-zero when any part fails and SHALL name the failing
part. A missing prerequisite (engine, reachable gateway, image, Bun, cargo,
database URI) SHALL fail the gate with a named message and MUST NOT be reported
as a skip.

#### Scenario: Every part passes

- **WHEN** the gate runs on a host with a reachable gateway, an engine, and the project image
- **THEN** the full suite, the live journey run, and every isolation check run, and the gate exits 0

#### Scenario: One check fails

- **WHEN** the egress-denial check fails
- **THEN** the gate exits non-zero and names that check

#### Scenario: A missing prerequisite fails

- **WHEN** the gate runs with no reachable gateway
- **THEN** it exits non-zero naming the gateway and does not report a green run

### Requirement: Isolation checks are scripted assertions

Each isolation check SHALL be a command with an expected result and an
actionable failure message, covering: an endpoint in no policy being refused,
a credential variable in the sandbox holding a gateway placeholder rather than
a key, no host path being visible, the sandbox process running as uid/gid 1500,
no bind mount being present, and a refused request appearing in the gateway
log.

A check MUST NOT be satisfied by a human instruction, and MUST NOT be made to
pass by adding an egress rule, disabling policy, or widening a wildcard.

#### Scenario: A leaking credential fails the check

- **WHEN** the credential variable in the sandbox contains a key rather than a placeholder
- **THEN** the check fails, names the variable, and does not print its value

#### Scenario: A wildcard rule cannot rescue a check

- **WHEN** an egress check would pass only because a wildcard host rule exists
- **THEN** the check fails and names the rule that must be removed

### Requirement: The gate accepts sandbox work as a patch only

The gate SHALL accept a patch file and a base commit, apply them to a
throwaway checkout, run the fixed gate command there, and delete the checkout
afterwards. It SHALL refuse a patch whose base does not match, whose target
tree is dirty, or whose path set escapes the checkout. It MUST NOT run a
command named by the patch or by the sandbox, and MUST NOT run automatically on
work a sandbox produced.

#### Scenario: A valid patch is gated in isolation

- **WHEN** the gate is given a patch and its matching base commit
- **THEN** it applies the patch to a fresh checkout, runs the fixed gate, reports the result, and removes the checkout

#### Scenario: A mismatched base is refused

- **WHEN** the patch's base commit does not match the supplied base
- **THEN** the gate exits non-zero before running any suite and deletes the checkout

#### Scenario: The patch cannot choose the command

- **WHEN** the patch modifies a task runner or a Makefile target the gate uses
- **THEN** the gate still runs its fixed, documented command set

### Requirement: Every result is scoped to a layer

The repository SHALL document a claim table naming, for each layer — parsing
and configuration, gateway transport, session orchestration, and boundary — the
suite that is authoritative for it. The documentation SHALL state that a pass
produced inside a sandbox is never evidence for a boundary claim.

#### Scenario: The table names an authority per layer

- **WHEN** the claim table is read
- **THEN** each layer names exactly one authoritative suite and the runner it requires

#### Scenario: A sandbox result cannot be recorded as a boundary result

- **WHEN** a verification record is written from a run inside a sandbox
- **THEN** the record format requires host gate evidence and rejects a record without it

### Requirement: Boundary runs are recorded with their evidence

Each boundary run SHALL produce a record naming the gateway version, the agent
version, the engine, the image tag, the patch commit, each check that ran, and
the outcome. The record SHALL be written to `docs/verification-log.md` in the
documented format, and MUST NOT include a credential value or a literal
placeholder string.

#### Scenario: A passing run records its versions

- **WHEN** the gate passes
- **THEN** it prints a record containing the gateway, agent, engine, image, and patch identity and every check's outcome

#### Scenario: A partial run is not recorded as a pass

- **WHEN** the gate fails or a check is skipped for a missing prerequisite
- **THEN** the printed record marks the run incomplete and must not be recorded as a boundary pass
