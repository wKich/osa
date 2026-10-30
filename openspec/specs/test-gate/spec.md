# test-gate Specification

## Purpose
Provides one repository-level verification gate that runs every offline test suite and the Mongo-backed oskhs store tests, so a change cannot pass the default test command while the bridge, dashboard, worker, or database path is broken.

## Requirements

### Requirement: One verification gate runs every suite

The repository SHALL provide `make test-all`, which runs the POSIX shell suite,
the bridge suite, the dashboard suite, the oskhs suite, and the conformance
suite, including the Mongo-backed `MongoTaskStore` tests against the URI in
`OSKHS_TEST_MONGO_URI`. The target MUST exit non-zero when any suite fails,
MUST NOT silently skip a suite because `bun` is absent, and MUST fail with a
clear message when the Mongo URI is absent. The existing `make test` SHALL keep
its current shell-only meaning. The conformance suite SHALL never be the reason
a run needs `bun`: it MUST run with only POSIX `sh` and the stub executables.

#### Scenario: All suites pass
- **WHEN** a maintainer runs `make test-all` on a host with `bun` and a reachable MongoDB
- **THEN** the shell, bridge, dashboard, oskhs, Mongo store, and conformance tests run and the command exits 0

#### Scenario: One suite fails
- **WHEN** a bridge test fails while the other suites pass
- **THEN** `make test-all` exits non-zero and names the failing suite

#### Scenario: Mongo tests are not skipped
- **WHEN** `make test-all` runs with `OSKHS_TEST_MONGO_URI` set
- **THEN** the oskhs store tests execute against MongoDB and do not report the skip message

#### Scenario: Missing prerequisite fails
- **WHEN** `bun` or `OSKHS_TEST_MONGO_URI` is missing
- **THEN** `make test-all` exits non-zero with a message naming the missing prerequisite instead of reporting a green run

#### Scenario: The conformance suite needs no Bun
- **WHEN** the conformance suite runs on a host without `bun`
- **THEN** it runs its full case set and exits according to its own results rather than skipping

#### Scenario: A conformance divergence fails the gate
- **WHEN** a conformance case fails while every other suite passes
- **THEN** `make test-all` exits non-zero and names the conformance suite as the failing one

### Requirement: CI runs the same gate

The repository SHALL provide a continuous-integration job that runs `make test-all` for every push and pull request, with a MongoDB service reachable through `OSKHS_TEST_MONGO_URI`. A failing suite in CI SHALL fail the job.

#### Scenario: CI runs all four suites
- **WHEN** a change is pushed and CI starts
- **THEN** the job runs the same shell, bridge, dashboard, oskhs, and Mongo tests as `make test-all`

#### Scenario: A red suite blocks the job
- **WHEN** any suite fails in CI
- **THEN** the CI job exits non-zero and the change is not reported as passing
