# Developing osa inside a sandbox

osa is developed on a host, but it can also be developed *from inside* an osa
sandbox. This page is the in-sandbox authoring loop and the claim it supports.
The image itself lives in
[`examples/environments/dev/`](../../examples/environments/dev/), which is the
authority for its build, its pinned versions, and its rebuild rule.

## What makes it possible

The agent-only base carries the agent runtime and the safety baseline, and
nothing else: no Rust toolchain, no Bun, no `openspec`, no MongoDB. That is
deliberate — a base shared by every user must not grow per-user toolchains. The
development store is the environment layer for repository work: it builds
`FROM` the base you already use and adds the toolchain, the pinned runtimes, the
suite prerequisites, and a pre-fetched dependency set.

It is not a base and not a supported user image. No front-end selects it, it
carries no credential and no egress rule, and it keeps the base's agent
binary, uid/gid 1500, and `/sandbox` home.

## The loop

1. **Build the image** from the store, as its README describes. The base must
   exist first.
2. **Create the sandbox with the development policy**
   [`examples/policies/osa-dev-environment.yaml`](../../examples/policies/osa-dev-environment.yaml).
   It is the minimal policy plus the three paths this image's tools need (CPU
   topology, `/dev/zero`, `/dev/pts`); no egress rule is added.
3. **Upload the project** to `/sandbox/project`, then run the checks from
   inside:

   ```sh
   scripts/verify-dev-environment.sh
   ```

   It fails naming the first missing or mismatched runtime, and it never
   reports success for a check it skipped.
4. **Work, then move files back.** The sandbox is the only copy of what you
   edit there: download before you delete it, exactly as with any other project
   in a sandbox.

Inside the sandbox, call the scripts rather than `make`: an OpenShell sandbox
refuses `execve` from `make`'s child process, so every make target that spawns
anything fails there with `make: /bin/sh: Operation not permitted`. The
project's bodies live in scripts for that reason —
`scripts/test-all.sh` is the full gate, and `make test-all` runs it where
`make` works.

## Offline rules

The sandbox has no egress; the image is built to be used that way.

- Cargo and Bun resolve from caches baked at image build, keyed by
  `osa-core/Cargo.lock`, `bridge/bun.lock`, and `oskhs/bun.lock`.
- A fresh upload has no `node_modules`; restore them with
  `bun install --frozen-lockfile --offline` in `bridge/` and `oskhs/` (the
  verification script does this for you).
- MongoDB is loopback-only and credential-free; the image's start command
  brings it up and `mongosh` answers offline.
- A missing dependency is a reason to rebuild the image, never to add a
  registry endpoint to a policy.

## The in-sandbox control plane

The development image also carries the marker for a dev-only control plane,
[`insandbox-gateway`](../../osa-core/crates/insandbox-gateway/README.md). It
serves the OpenShell surface over a state root where a sandbox is a directory
and `exec` is a real local child, so the front-ends' own lifecycle can run
inside one sandbox:

```sh
cargo build --release -p insandbox-gateway
scripts/run-insandbox-plane.sh
```

The plane prints its non-guarantee and then its loopback URL. It binds loopback
and speaks plaintext only; bearer tokens and mutual TLS are refused, not
downgraded. Commands it execs resolve its private `openshell` shim (gateway
information and sandbox upload/download only) through a `PATH` entry scoped to
that child tree. The shim is never installed in a system bin directory.

**The plane is not a boundary.** It provides **no isolation**, enforces **no
policy**, and brokers no credential. Its safety comes only from the outer
sandbox it refuses to start outside of, and nothing it reports is evidence
about the OpenShell policy, provider substitution, or the sandbox user. Treat
a plane-backed run exactly like any other in-sandbox run: it covers
orchestration, parsing, and transport, never isolation.

## What the loop proves — and what it does not

The loop supports **parsing, transport, and suite runs**: the shell suite and
its conformance goldens, the Rust core's unit and integration tests, the bridge
and dashboard suites, the oskhs round library against a real local MongoDB, and
every lint the repository runs.

It does **not** prove isolation. Running the project's tests inside a sandbox
says nothing about the sandbox boundary: only the OpenShell policy, the
provider placeholder substitution, and the non-root sandbox user do that.
Nothing in this environment store changes them, and no result from this loop is
evidence about them. The isolation checklist stays the separate, host-side
pages starting at
[`docs/ai/verification/maki.md`](verification/maki.md).
