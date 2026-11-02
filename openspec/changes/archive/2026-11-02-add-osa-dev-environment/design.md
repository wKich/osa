# Design

## Context

See `proposal.md` for motivation. Constraints that shape the approach:

- `examples/maki-image/` is the agent-only base: Maki, uid/gid 1500, the
  baked configuration, and the catalog snapshot. `environment-layer` forbids
  personal runtimes there, so a toolchain cannot ship in the base.
- `rust-toolchain.toml` pins channel `1.98.1` with `clippy` and `rustfmt`.
- `osa-core/Cargo.lock` pins 419 packages plus the dependency taken from the
  OpenShell repository at tag `v0.1.5`, so an offline build needs both the
  registry cache and the checkout cache under `CARGO_HOME`.
- `make test-all` fails, by design, when `bun`, `cargo`, or
  `OSKHS_TEST_MONGO_URI` is absent.

## Goals / Non-Goals

**Goals:**

- One image that an agent can build osa and run the offline suites in, with no
  network at use time.
- The same verification the repository already trusts, not a new test
  definition.

**Non-Goals:**

- No change to the base image, the released front-ends, or any policy.
- No control plane: this image makes the repository usable, not the sandbox
  usable (that is the sibling change).

## Decisions

### D1. A development environment store, not a development base image

The image lives under `examples/environments/dev/` and builds `FROM` a base
image named by a build argument.

*Why:* the environment layer is the documented place for anything an agent
needs beyond its runtime, and the base is shared by every user. A
toolchain-bearing base would make every user's sandbox larger and would
contradict the base-image requirement in `environment-layer`.

*Alternative rejected:* a `maki-agent:dev` base. It is the same rule violation
with a friendlier name, and it would drift from the shipping base.

### D2. Pre-fetch dependencies at build; never vendor into the repository

The Dockerfile runs a fetch for the workspace at build time and installs the
result into the image under `/sandbox/.cargo`, owned by uid/gid 1500. Builds and
tests then run without network.

*Why:* `Cargo.lock` is the single source of truth, the git dependency is
already pinned by revision, and the cache is an image concern rather than a
repository one.

*Alternatives rejected:* `cargo vendor` in the tree (large, per-target, and it
would make the repository the dependency host); a registry mirror in policy
(adds egress for a build-time need).

### D3. MongoDB is part of the image

The image installs a MongoDB server with its data directory under `/sandbox`.

*Why:* the goal is "everything the gate runs, runs in the sandbox", and
`test-gate` deliberately fails rather than skips when the URI is absent. Keeping
the store tests host-only would leave a hole exactly where the agent cannot see
it.

*Trade-off accepted:* a larger image and a start step. The verification target
starts the server and fails if it does not come up.

The server's allocator reads `/sys/devices/system/cpu`, which the minimal
sandbox policy does not grant, so `mongod` aborts at startup inside a sandbox.
The dev flow therefore ships its own policy
(`examples/policies/osa-dev-environment.yaml`): the minimal policy plus that
read-only path, the `/dev/zero` read the suites' oversized-input cases use, and
the `/dev/pts` directory the bridge suite allocates PTYs in. Every addition is
named and justified at the rule; none adds egress. It is not added to `maki-minimal.yaml`, because no base image
runs MongoDB and every other sandbox should keep the narrower rule set.

### D4. The store is one Dockerfile parameterized by base

`OSA_DEV_BASE` names the base (default: the Maki base), `OSA_DEV_AGENT` names
the agent binary to verify.

*Why:* four copies of the same Dockerfile would diverge on the first toolchain
bump.

### D5. Verification builds and runs, it does not introspect

`make verify-dev-environment` checks each runtime's version, runs an offline
`make build`, then `make test` and `make test-core`. It fails naming the first
missing runtime.

*Why:* an image that lists a runtime but cannot build is the failure mode this
change exists to remove; only an actual build detects it.

### D6. The suites must be platform-neutral before they can run in the image

The shell suite and its conformance goldens were recorded on macOS: the mode
assertion reads the mode with BSD `stat` first (GNU `stat` accepts `-f` and
prints filesystem information instead of failing), and the normalizer maps
`${TMPDIR}` but not a literal `/tmp`, so a recording made where `TMPDIR` is
unset renders temp paths differently from the goldens. Both are fixed here —
the `stat` order in `tests/run-tests.sh`, one normalizer rule, and the seven
goldens that carry a temp path — because the verification target cannot pass
inside a Linux image while they stand.

*Why not a separate change:* the spec requires `make test` to pass in the
image. Landing the image first would ship a verification target that is known
to fail on the only platform it runs on.

*Scope guard:* no case body and no product code changes. Goldens differ only in
the temp-path spelling, and the same goldens still pass on macOS.

### D7. The gate and the verification run from scripts, not from make

An OpenShell sandbox refuses `execve` from `make`'s child (`make: /bin/sh:
Operation not permitted`), so no make target that spawns anything runs there —
`make build`, `make test`, and `make test-all` included. The gate therefore
moves to `scripts/test-all.sh`, `make test-all` calls it, and the verification
script calls cargo and the suite scripts directly. Both remain a single
definition: the make target is the convenience entry, the script is the body.

*Why:* the point of the image is the in-sandbox loop; a verification target that
cannot execute in a sandbox would prove nothing about it.

## Risks / Trade-offs

- **Stale cache after a `Cargo.lock` bump** → the offline build fails naming the
  missing package; the fix is a rebuild, and the verification target is the
  detector. The rule is documented next to the store.
- **Image size and build time** → layer ordering keeps the toolchain and the
  cache above the volatile pieces; the cache is fetched in one layer.
- **A dev image mistaken for a user image** → the tag is `osa-dev:local`, the
  store is not referenced by any front-end default, and the README states the
  distinction.
- **MongoDB data under `/sandbox` grows** → the data directory is named and
  documented; the store tests use a throwaway database per run.
