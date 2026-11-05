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

## Create it with maki-oss

The base and any environment layer you use must exist first. The development
layer is built `FROM` the agent image you actually run, so that image's
providers and preferences stay and the toolchain is added on top. The tag
below is a local convention, not a supported user image.

1. **Build the chain.** Base, then any environment layer, then the development
   layer. With the personal store in use:

   ```sh
   ./bin/maki-oss image build
   docker build -t maki-agent:reference examples/environments/reference
   docker build -t maki-agent:personal ~/.config/maki-oss/environments/personal
   docker build -t osa-dev:personal \
       --build-arg OSA_DEV_BASE=maki-agent:personal \
       --build-arg OSA_DEV_AGENT=maki \
       examples/environments/dev
   ```

   Without a derived environment, build the base directly:
   `docker build -t osa-dev:local examples/environments/dev`.

2. **Persist the image and policy** in the helper's config file
   (`${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/config.toml`):

   ```toml
   image = "osa-dev:personal"
   policy = "examples/policies/osa-dev-environment.yaml"
   ```

   A relative policy path is tried against the current directory first, then
   the repository root. The policy must be the development one: it is the
   minimal policy plus `/sys/devices/system/cpu`, `/dev/zero`, and `/dev/pts`,
   and it adds no egress rule. Flags and `MAKI_OSS_IMAGE` / `MAKI_OSS_POLICY`
   override the file; see the settings table in
   [`docs/helper.md`](../helper.md#configuration). `maki-oss image build`
   always tags the base and ignores `image`, so it cannot overwrite the
   environment tag.

3. **Create or recreate the sandbox.** Image and policy are fixed at
   creation, so an existing sandbox keeps the old ones:

   ```sh
   ./bin/maki-oss rm --yes && ./bin/maki-oss up
   ```

   `up` uploads the checkout to `/sandbox/project`; there is no host bind
   mount. Deletion drops that sandbox's sessions, so collect or download any
   work first.

4. **Verify and run from inside**, by script rather than `make` (a sandbox
   refuses `execve` from make's child process; see below):

   ```sh
   scripts/verify-dev-environment.sh
   scripts/build-e2e.sh
   tests/e2e/run.sh local
   ```

   The verification script fails naming the first missing or mismatched
   runtime, and it never reports success for a check it skipped.

## The loop

1. **Set up the sandbox** as described above: build the image chain, persist
   the image and policy, and create or recreate it. `up` uploads the checkout
   to `/sandbox/project`.
2. **Work, then hand the work back as a patch.** The sandbox is the only copy
   of what you edit there. In caller mode, `maki-oss collect-patch --out FILE`
   (the same command on the other helper names) writes the workdir's changes as
   a binary patch against the `sync-in` baseline; on the managed path, download
   before you delete the sandbox, exactly as with any other project in a
   sandbox. The patch is the only thing that crosses to the host.
3. **Let the host run the gate.** Nothing runs automatically on a patch the
   sandbox produced — no watcher, no hook, no auto-apply. A person (or a
   scheduled job on a host that has a gateway) runs:

   ```sh
   make test-boundary BOUNDARY_ARGS='--sandbox NAME --patch FILE --base COMMIT'
   ```

   It creates a throwaway checkout at `COMMIT`, refuses a patch that does not
   match it, applies the patch, runs the fixed command set, and prints a
   boundary record. A sandbox run — including everything in this page — is
   never a boundary claim.

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
information, sandbox upload/download, and the helper scripts' exec form)
through a `PATH` entry scoped to that child tree. The shim is never installed
in a system bin directory.

**The plane is not a boundary.** It provides **no isolation**, enforces **no
policy**, and brokers no credential. Its safety comes only from the outer
sandbox it refuses to start outside of, and nothing it reports is evidence
about the OpenShell policy, provider substitution, or the sandbox user. Treat
a plane-backed run exactly like any other in-sandbox run: it covers
orchestration, parsing, and transport, never isolation.

## The end-to-end suite

The full scenario set — the four front-ends, sessions, caller-mode sync,
lifecycle, pending work, and the host-recording comparison — is what proves the
front-ends' orchestration works together. Build its binaries once:

```sh
scripts/build-e2e.sh
```

Then run it against the control plane from inside the sandbox, calling the
script rather than `make` for the reason above:

```sh
tests/e2e/run.sh local
```

On a host with a real gateway, `make test-e2e` runs the same cases through the
real transport and compares each run with the committed recordings. Neither
target joins `make test`; each skips with a named reason when the test-support
binaries, the OpenShell CLI, or the gateway are absent.

The suite's summary states the layer it covers — session orchestration — and
that it proves nothing about isolation, policy, egress, or credential brokering.
The full mapping of suites to layers is the claim table in
[`docs/ai/verification/claims.md`](verification/claims.md).

## What the loop proves — and what it does not

The loop supports **parsing, transport, and suite runs**: the shell suite and
its conformance goldens, the Rust core's unit and integration tests, the bridge
and dashboard suites, the oskhs round library against a real local MongoDB, and
every lint the repository runs.

It does **not** prove isolation. Running the project's tests inside a sandbox
says nothing about the sandbox boundary: only the OpenShell policy, the
provider placeholder substitution, and the non-root sandbox user do that.
Nothing in this environment store changes them, and no result from this loop is
evidence about them.

The boundary claim comes from the host-only gate, `make test-boundary`
([`tests/boundary/gate.sh`](../../tests/boundary/gate.sh)): it runs the suite
gate, the live journey run, and the scripted isolation checks, and prints a
record whose verdict is `passed`, `failed`, or `incomplete`. The pages under
[`docs/ai/verification/`](verification/) explain each check the gate asserts;
the claim table is
[`docs/ai/verification/claims.md`](verification/claims.md#the-boundary-gate).
The gate does not run automatically and is not a hosted-CI job: it needs a
reachable OpenShell gateway, a container engine with the project image, and a
sandbox holding a provider.
