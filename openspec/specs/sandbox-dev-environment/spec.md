# sandbox-dev-environment Specification

## Purpose

Provides the repository-owned development image that makes osa buildable and
testable inside an osa sandbox: a pinned toolchain, an offline dependency set,
and the suite prerequisites the agent-only base deliberately lacks.

## Requirements

### Requirement: Development image builds from the agent base

The repository SHALL provide a development environment store that builds
`FROM` an agent base image, accepting the base tag as a build argument and
defaulting to the Maki base. The resulting image SHALL report the same agent
version as the base it was built from, SHALL run as uid/gid 1500 with
`/sandbox` as its home, and SHALL keep the base's filesystem policy and
configuration unchanged.

The store MUST NOT contain a credential, a provider profile, or an egress rule.
It MUST NOT become the default image of any front-end, and it MUST NOT be
referenced from `examples/maki-image/`.

#### Scenario: The store builds on the Maki base

- **WHEN** the store is built with the default base after the Maki base image exists
- **THEN** the build succeeds and the resulting image's agent binary reports the same version as the base

#### Scenario: The store keeps the sandbox identity

- **WHEN** the built image is inspected
- **THEN** its final user is uid/gid 1500 and its home is `/sandbox`, with no root-owned writable path added under `/sandbox`

#### Scenario: The store carries no credential or egress decision

- **WHEN** the store's files are inspected
- **THEN** they contain no API key, token, or secret, and no network rule or policy file

### Requirement: Toolchain and runtimes are pinned

The image SHALL install the Rust toolchain channel named in
`rust-toolchain.toml`, including `clippy` and `rustfmt`; a pinned Bun; the
`openspec` CLI; a MongoDB server; and the shell prerequisites the test suites
use that the base lacks (`jq`, `timeout`, `pkill`, `fish`, `patch`).

Each version SHALL be a build argument with a fixed default, so bumping one is
an image rebuild rather than a runtime download.

#### Scenario: Every runtime resolves at the pinned version

- **WHEN** the built image runs each runtime's version command
- **THEN** the Rust channel matches `rust-toolchain.toml`, and Bun, `openspec`, and MongoDB each report the pinned version

#### Scenario: No runtime is fetched at use time

- **WHEN** a session inside the image runs the suites with no network reachable
- **THEN** no runtime or package is downloaded, and any attempt would fail rather than install

### Requirement: Dependencies are available offline

The image SHALL pre-populate `CARGO_HOME` with the registry entries and the
version-control dependency pinned in `osa-core/Cargo.lock`, owned by uid/gid
1500 and writable, so an agent can add a dependency and rebuild.

A build and the core test suite SHALL complete with no network reachable.

#### Scenario: Offline build succeeds

- **WHEN** the front end is built in the image with no network
- **THEN** the build completes and the release binaries exist at their documented paths

#### Scenario: Offline core tests succeed

- **WHEN** the core suite runs in the image with no network
- **THEN** every core test runs and the command exits according to its own results

#### Scenario: An agent can add a dependency

- **WHEN** an agent adds a crate to a workspace member and rebuilds with no network
- **THEN** the build fails naming the missing crate, and succeeds once the dependency is present in the pre-populated cache

### Requirement: MongoDB is reachable for the full gate

The image SHALL provide a MongoDB server that an agent can start without
network access, so `OSKHS_TEST_MONGO_URI` can name a loopback instance and the
full gate runs its store tests instead of failing its prerequisite check.

The server's allocator reads CPU topology, the suites' oversized-input cases
read `/dev/zero`, and the bridge suite allocates PTYs, so the repository SHALL
also ship a development sandbox policy that grants exactly those paths. The
policy SHALL name each one explicitly and MUST NOT add a network rule, a
writable filesystem path outside `/sandbox`, `/tmp`, and the PTY device
directory, or any other read.

#### Scenario: The store tests run locally

- **WHEN** the image's MongoDB is started under the development policy and the full gate runs with `OSKHS_TEST_MONGO_URI` pointing at it
- **THEN** the oskhs store tests execute against MongoDB and the command does not report the skip message

#### Scenario: A missing database still fails loudly

- **WHEN** the full gate runs in the image with MongoDB stopped and the URI set
- **THEN** the command exits non-zero and names the store suite rather than reporting a green run

#### Scenario: The development policy adds no reach

- **WHEN** a sandbox created with the development policy is inspected
- **THEN** its filesystem rules are the minimal policy plus the CPU-topology and `/dev/zero` reads and the PTY device directory, and its egress rules are unchanged

### Requirement: A verification target proves the image is usable

The repository SHALL provide `make verify-dev-environment` and the script it
runs. The script SHALL check that each runtime resolves, that the front end
builds, and that the shell suite and the core suite pass offline, and SHALL run
the full gate against the loopback MongoDB. It SHALL invoke cargo, the suite
scripts, and the gate script directly rather than through `make`, so the same
command runs in a sandbox, where `make` cannot spawn a child process.

The target and the script SHALL fail naming the first missing or mismatched
runtime, and MUST NOT report success when they skipped a check.

#### Scenario: A complete image passes

- **WHEN** the script runs inside a correctly built development image
- **THEN** every check runs and the script exits 0

#### Scenario: A missing runtime is named

- **WHEN** the script runs in an image without `jq`
- **THEN** it exits non-zero and names `jq` as the missing prerequisite

#### Scenario: The checks need no child-spawning make

- **WHEN** the script runs inside a sandbox where `make` cannot spawn a child process
- **THEN** every check still runs, because the script calls the tools and suite scripts directly
