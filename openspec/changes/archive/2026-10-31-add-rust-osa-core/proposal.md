# Proposal

## Why

`osa` — the command that reads and writes the project registry, resolves
retained patches, reports health, and configures providers — is 789 lines of
POSIX `sh` on top of a 7,342-line shared library. Three of its data paths are
hand-rolled parsers:

- the registry and marker format is parsed by an embedded `awk` program and
  written by `printf '%s = "%s"'` concatenation;
- JSON output is assembled by `printf` from `entry_json_fields()`, with a
  separate `json_str()` escaper;
- gateway JSON is read through two code paths, one for hosts with `jq` and one
  for hosts without, and `helper-cli` pins both behaviors.

Those files are a **published contract**: `osa-project-layer` requires the flat
TOML v1 registry and pending markers, and the dashboard, bridge, and oskhs read
them. Adding a field means editing a writer, an `awk` allow-list, a JSON
concatenation, and each reader, in two languages, with only string assertions to
catch a mistake. The `jq`-optional split doubles the gateway-reading surface for
a tool the host playbook does not install anyway.

A typed implementation of that contract removes the parser class of bug and
collapses the dual `jq`/`awk` paths. It is also the prerequisite for replacing
CLI-scraping with the gateway protocol later, which needs a typed client to
build on.

## What Changes

- Add a Cargo workspace `osa-core/` producing one binary, `osa`, implementing
  the **entire current `osa` command surface**: `projects`, `status`, `health`,
  `providers`, `provider setup`, `images`, `image build`, `remove`, `resolve`,
  `dashboard`.
- Implement the registry/config/pending/marker layer once, matching the
  published flat TOML v1 format byte-for-byte: key order, `\\`/`\"` escaping
  only, mode `600`, atomic temp-and-rename, values with tabs or newlines
  refused.
- Accept on read everything the current `awk` parser accepts: comments, blank
  lines, trailing comments after a value, unknown keys.
- Replace `printf`-assembled JSON with a serializer; one gateway-JSON reader
  instead of the `jq`/`awk` pair.
- **BREAKING** (host): the core path gains a build step. `bin/osa` becomes a
  `sh` shim that `exec`s the built binary and fails with an actionable message
  when it is absent; `rust-toolchain.toml` pins the toolchain and
  `Cargo.lock` is committed.
- Keep the `openshell` CLI as the transport in this change. Swapping it for the
  gateway protocol is a separate change.

Non-goals: no front-end (`maki-oss`, `opencode-oss`, `claude-oss`, `codex-oss`)
code moves here; no bridge, dashboard, or oskhs code moves here; no gateway
protocol work.

## Capabilities

### New Capabilities

- `osa-core`: the Rust core's contract — build and launch, command-surface
  parity with the documented `osa` reference, registry and marker format
  parity, JSON output parity, state-tree parity, credential discipline, and an
  offline test suite.

### Modified Capabilities

- `host-setup`: the shared host playbook gains a core build step (pinned
  toolchain, `make build`, verification that `osa` runs) before the `bin/`
  `PATH` verification.
- `test-gate`: `make test-all` additionally runs the core suite, and the gate
  fails with a clear message when the Rust toolchain is absent.

## Impact

- New: `osa-core/` (crate, tests, `rust-toolchain.toml`), `make build`,
  `make test-core`.
- Modified: `bin/osa` becomes a shim; `docs/helper.md` gains a note that the
  `osa` surface is provided by the core binary; `docs/ai/host-playbook.md` and
  the agent playbooks gain the build step.
- Unchanged: `lib/oss-core.sh` and the four front-ends keep their current
  registry implementation until the front-end migration. Two implementations of
  one contract is temporary by design, and the conformance harness from
  `add-helper-conformance-harness` proves parity case by case.
- Security: no invariant changes. Credential values still travel only through
  the child environment; the conformance leak case gates that.
- Depends on `add-helper-conformance-harness` being archived first; its parity
  mode is the acceptance mechanism, and both changes touch `test-gate`.
- Risk: a second build system and a toolchain on the host. Mitigated by a
  pinned toolchain, a committed lock file, and a shim that fails loudly rather
  than silently falling back to the old script.
