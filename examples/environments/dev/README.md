# Development environment store

The repository-owned environment store for developing osa itself: an image an
agent can build, test, and lint the project in from inside an osa sandbox.

It is a store, not a base. It builds `FROM` whichever agent base you already
use, adds the toolchain and runtimes the agent-only base deliberately omits, and
changes nothing about the base's identity: the agent binary, uid/gid 1500,
`/sandbox`, and the baked configuration are the base's. No front-end selects
this image by default, and no image tag here is a supported user image.

It carries no credential, no provider profile, and no egress rule. Model access
still comes from OpenShell provider profiles attached on the host, exactly as
for the base. A larger image is not a weaker boundary: the sandbox still runs
as uid/gid 1500 under the same filesystem policy, with egress denied by
default.

## Build

The selected agent's base must exist first (for Maki: `maki-oss image build`).

```sh
docker build -t osa-dev:local examples/environments/dev
```

The agent binary to verify defaults to `maki`. For another base, name both the
base and its agent binary:

```sh
docker build -t osa-dev:opencode \
  --build-arg OSA_DEV_BASE=opencode-agent:local \
  --build-arg OSA_DEV_AGENT=opencode \
  examples/environments/dev
```

Every version is a build argument with a fixed default (`RUST_CHANNEL`,
`BUN_VERSION`, `OPENSPEC_VERSION`, `MONGODB_VERSION`, `MONGOSH_VERSION`), so
bumping one is an image rebuild rather than a download in a session.
`RUST_CHANNEL` must match `channel` in `rust-toolchain.toml`; the verification
target names a mismatch.

## What it installs

- The Rust channel from `rust-toolchain.toml` with `clippy` and `rustfmt`, as
  uid 1500 under `/sandbox/.cargo` and `/sandbox/.rustup`.
- A pinned Bun, a pinned OpenSpec CLI (run by that Bun, since the base has no
  Node), and the suite prerequisites the base lacks: `jq`, `timeout`, `pkill`,
  `fish`, `patch`, plus the C toolchain a Rust build needs.
- A MongoDB server and `mongosh`, with the data directory under
  `/sandbox/.local/share/mongodb`. Both live under `/usr/local`: the sandbox
  policy allows reads under `/usr`, so a binary in `/opt` could not start.
- A pre-populated `CARGO_HOME` and Bun install cache, so builds and installs
  succeed with egress denied. See "Offline rules" below.

## Run it in a sandbox

The development sandbox needs the policy in
[`examples/policies/osa-dev-environment.yaml`](../../policies/osa-dev-environment.yaml):
the minimal policy plus three named paths the image's tools read or write (CPU
topology for MongoDB's allocator, `/dev/zero` and `/dev/pts` for the suites).
Nothing else is widened and no egress rule is added.

```sh
openshell sandbox create --name osa-dev --from osa-dev:local \
  --policy examples/policies/osa-dev-environment.yaml -- sleep infinity
openshell sandbox upload osa-dev . /sandbox/project
```

Then verify the image from inside, on the uploaded project:

```sh
openshell sandbox exec -n osa-dev -- sh -c \
  'cd /sandbox/project && scripts/verify-dev-environment.sh'
```

The script checks every pinned runtime, builds with the network off, runs the
shell suite, the core suite offline, and the full gate against the image's
loopback MongoDB. `make verify-dev-environment` runs the same script where
`make` can spawn child processes; inside an OpenShell sandbox it cannot, which
is why the script and `scripts/test-all.sh` are the entry points there.

## Offline rules

Egress stays deny-by-default in the sandbox; nothing is fetched at use time.

- `Cargo.lock` is the source of truth for crates. The image fetches the
  registry and the git dependency pinned there at build time.
- `bridge/bun.lock` and `oskhs/bun.lock` populate Bun's install cache. A fresh
  upload has no `node_modules`, so run `bun install --frozen-lockfile --offline`
  in each package once, or let the verification script do it.
- MongoDB binds `127.0.0.1` only and accepts no credential. The image's
  start command brings it up; `osa-dev-start-mongodb` does the same on demand.
- Never add an npm/crates endpoint to a policy to make a session install. A
  missing dependency is a reason to rebuild the image.

## Rebuild when a lockfile changes

The pre-fetched dependency set comes from `OSA_REF` in the repository remote
(default `main`). When `osa-core/Cargo.lock`, `bridge/bun.lock`, or
`oskhs/bun.lock` changes, rebuild the image against a ref that carries the
change:

```sh
docker build -t osa-dev:local \
  --build-arg OSA_REF=<ref> examples/environments/dev
```

Until then the offline build fails naming the package it cannot download —
that failure is the detector, not a reason to relax the rule:

```text
error: failed to download `axum v0.7.9`

Caused by:
  attempting to make an HTTP request, but --offline was specified
```

The same applies to a new crate in a workspace member: the offline build names
the crate, and the fix is a rebuild that includes it in the cache.

## Not a boundary

This store makes the repository usable inside a sandbox; it does not make the
sandbox safe. Isolation comes from OpenShell — the policy, the provider
placeholder substitution, and the non-root user — and this image changes none
of them. Do not put a credential, an egress rule, or a host path in this
directory.
