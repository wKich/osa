# Proposal

## Why

osa cannot be developed from inside an osa sandbox. The base image carries the
agent runtime and the safety baseline only, so an agent working in
`/sandbox/project` has no Rust toolchain, no Bun, no `openspec`, and no
MongoDB: `make build` fails, `make test` fails for lack of the built binaries,
and `make test-all` fails at its prerequisite checks. Dogfooding therefore
stops at reading the repository.

## What Changes

- Add a repository-owned development environment store under
  `examples/environments/dev/`, built `FROM` the selected agent base image and
  following the environment-layer pattern. It installs, at image build:
  - the Rust toolchain pinned by `rust-toolchain.toml` (channel `1.98.1`,
    `clippy`, `rustfmt`);
  - a pre-populated `CARGO_HOME` (registry plus the `git+…/OpenShell?tag=v0.1.5`
    dependency pinned in `osa-core/Cargo.lock`), so `cargo build` and
    `cargo test` run offline;
  - a pinned Bun for the bridge, dashboard, oskhs, and `openspec` CLI;
  - a MongoDB server so `OSKHS_TEST_MONGO_URI` can point at a local instance;
  - the suite's shell prerequisites that the base lacks: `jq`, `timeout`
    (coreutils), `procps` for `pkill`, `fish`, `patch`.
- Add `make verify-dev-environment`, which checks each runtime resolves and
  that one offline build plus `make test` and `make test-core` pass.
- Make the suite runnable on Linux, which is where the image runs: the mode
  assertion reads the mode with the platform's `stat`, the conformance
  normalizer treats a literal `/tmp` like `${TMPDIR}`, and the seven goldens
  that carry a temp path are re-recorded. No case semantics change.
- Add `examples/policies/osa-dev-environment.yaml`: the minimal sandbox policy
  plus the read-only CPU-topology path MongoDB's allocator needs, so the server
  starts inside a sandbox.
- Move the full gate into `scripts/test-all.sh` and have `make test-all` call
  it, because `make` cannot spawn a child process in a sandbox; the
  verification script calls cargo and the suite scripts directly for the same
  reason.
- Add one documentation page describing the in-sandbox authoring loop and the
  claim it supports, and link it from the environment playbook.
- Non-goals: no change to any base image, no change to product code, provider
  profiles, or released front-end behavior. The only policy change is the
  development policy above; every other shipped policy keeps its rule set.

## Capabilities

### New Capabilities
- `sandbox-dev-environment`: the repository-owned development image that makes
  osa buildable and testable inside an osa sandbox, the pinned toolchain and
  pre-fetched dependency set it carries, and the offline verification that
  proves the image is usable.

### Modified Capabilities
- None. The base-image and environment-store requirements in
  `environment-layer` are unchanged; the dev store is an instance of that
  pattern, not a new rule about it.

## Impact

- New: `examples/environments/dev/Dockerfile`, its `.dockerignore`, its
  configuration overlays, and `docs/ai/dev-environment.md`.
- New: `examples/policies/osa-dev-environment.yaml`, `scripts/test-all.sh`, and
  `scripts/verify-dev-environment.sh`.
- Modified: `Makefile` (the verification target; `test-all` delegates), `docs/ai/environment-playbook.md`
  (one pointer), `docs/ai/references.md` (only if a new upstream link is
  needed), `tests/run-tests.sh` and `tests/conformance/normalize.sh` plus seven
  conformance goldens (Linux portability).
- Dependencies: Rust 1.98.1, Bun, MongoDB, `openspec` CLI, all pinned at build.
- Security: unchanged. The store contains no credential and no new policy;
  it is built from the same base and runs as uid/gid 1500 under the same
  filesystem policy. A larger image is not a weaker boundary.
