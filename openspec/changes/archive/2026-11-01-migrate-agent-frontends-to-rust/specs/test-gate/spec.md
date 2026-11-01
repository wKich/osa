## MODIFIED Requirements

### Requirement: One verification gate runs every suite

The repository SHALL provide `make test-all`, which runs the front-end suite,
the conformance suite, the core suite, the bridge suite, the dashboard suite,
and the oskhs suite, including the Mongo-backed `MongoTaskStore` tests against
the URI in `OSKHS_TEST_MONGO_URI`.

The front-end suite SHALL remain a POSIX `sh` harness that drives the built
front-end binaries as black boxes; it SHALL NOT require the binaries to be
interpreted by a shell, and it SHALL NOT skip a case because a binary is
missing — a missing binary SHALL fail the suite.

The target MUST exit non-zero when any suite fails, MUST NOT silently skip a
suite because `bun` or `cargo` is absent, and MUST fail with a clear message
when the Mongo URI is absent. The existing `make test` SHALL keep its offline
meaning: the front-end and conformance suites, with no engine, gateway, or
network.

#### Scenario: All suites pass
- **WHEN** a maintainer runs `make test-all` on a host with `bun`, `cargo`, and a reachable MongoDB
- **THEN** the front-end, conformance, core, bridge, dashboard, oskhs, and Mongo store tests run and the command exits 0

#### Scenario: One suite fails
- **WHEN** a bridge test fails while the other suites pass
- **THEN** `make test-all` exits non-zero and names the failing suite

#### Scenario: Mongo tests are not skipped
- **WHEN** `make test-all` runs with `OSKHS_TEST_MONGO_URI` set
- **THEN** the oskhs store tests execute against MongoDB and do not report the skip message

#### Scenario: Missing prerequisite fails
- **WHEN** `bun`, `cargo`, or `OSKHS_TEST_MONGO_URI` is missing
- **THEN** `make test-all` exits non-zero with a message naming the missing prerequisite instead of reporting a green run

#### Scenario: The conformance suite needs no Bun
- **WHEN** the conformance suite runs on a host without `bun`
- **THEN** it runs its full case set and exits according to its own results rather than skipping

#### Scenario: A conformance divergence fails the gate
- **WHEN** a conformance case fails while every other suite passes
- **THEN** `make test-all` exits non-zero and names the conformance suite as the failing one

#### Scenario: The conformance and core suites need no Bun
- **WHEN** the conformance and core suites run on a host without `bun`
- **THEN** they run their full case sets and exit according to their own results rather than skipping

#### Scenario: A missing front-end binary fails the suite
- **WHEN** the front-end suite runs and one built binary is absent
- **THEN** the suite exits non-zero and names the missing binary instead of skipping its cases

#### Scenario: `make test` stays offline
- **WHEN** `make test` runs on a host with no engine, no gateway, and no network
- **THEN** the front-end and conformance suites run their full case sets and exit according to their own results

#### Scenario: A core-suite failure fails the gate
- **WHEN** a core test fails while every other suite passes
- **THEN** `make test-all` exits non-zero and names the core suite as the failing one
