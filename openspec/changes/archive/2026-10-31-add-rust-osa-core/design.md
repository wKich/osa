# Design

## Context

See `proposal.md` - Why.

The current `osa` is `bin/osa` (789 lines) plus `lib/osa-state.sh` (357 lines
of shared contract code) plus the parts of `lib/oss-core.sh` it reaches through
`lib/osa-state.sh`. The observed contract it must preserve is precise and
already documented:

- `osa-project-layer` pins the flat TOML v1 registry and pending-marker format
  and forbids removing or renaming keys within a version.
- `helper-cli` pins phase and provider lookup results "with or without `jq`
  installed", for pretty-printed, compact, and single-line multi-sandbox
  gateway JSON.
- `tests/run-tests.sh` asserts exit codes, stdout, and the state tree for the
  `osa` cases; the conformance harness from the prerequisite change records the
  `openshell` argv each case produces.

Read-side grammar the current parser accepts (`parse_flat_file`): blank lines,
`#` comment lines, `key = "value"`, a trailing `#` comment after the value, keys
matching `[a-z][a-z0-9_]*`, only `\\` and `\"` escapes, tabs rejected inside
values. Write-side grammar (`flat_write`): the same key rule, one pair per
line, mode `600`, temp file plus `mv` in the same directory.

## Goals / Non-Goals

**Goals:**

- One typed implementation of the registry/marker/config contract, byte-
  compatible in both directions.
- One JSON serializer and one gateway-JSON reader.
- A command surface indistinguishable from today's for scripts and tests.
- A build that a host playbook step can verify in one command.

**Non-Goals:**

- Gateway protocol work; `openshell` stays the transport here.
- Moving any front-end, bridge, dashboard, or oskhs code.
- Changing any spec-level `osa` behavior. This change is a reimplementation.
- Cross-platform support beyond macOS and Linux, which is the playbook's scope.
- Prebuilt binary distribution. Build-from-source is the shipping story; a
  download path would be a separate change to the host playbook.

## Decisions

### D1. Hand-written flat-TOML codec, not the `toml` crate

A `FlatEntry` type holds an ordered `Vec<(Key, Value)>`. The serializer emits
`key = "value"` lines with the closed escape set, and the parser mirrors the
`awk` grammar, including trailing comments and unknown keys.

*Why not `serde` + `toml`:* the requirement is byte-for-byte parity of output
and permissive parity of input. A general TOML serializer chooses its own key
order, quoting, and whitespace, and a general parser accepts structures the
contract forbids (arrays, inline tables, multi-line strings). Both directions
would need overriding, which is more code than the codec.

*Why not keep shell and call it from Rust:* then the parser class of bug
survives inside a subprocess boundary, which is the thing being removed.

The parser's oracle is the existing `awk` program: a corpus of entry files
(valid, commented, unknown-key, malformed) is generated once, the `awk` parser's
output is recorded as a golden, and the Rust parser must reproduce it.

### D2. Pinned key order per entry kind

Each entry kind (registry entry, pending marker, config) has one struct whose
field order is the documented write order. Fields absent for an entry are
omitted, not written empty, matching what the current writer does.

*Alternative rejected:* sort keys alphabetically. It would diff every registry
file in the repository's fixtures and every user's state root for no gain.

### D3. Typed JSON output with serde, explicit field order

Output structs derive `Serialize` with fields in documented order. Maps that
come from the gateway are parsed into `serde_json::Value` with
`preserve_order` so a pass-through stays stable.

*Why not `Value` everywhere:* it loses the compile-time field-name check that
is the main reason to move, and `serde_json::Map` ordering is not guaranteed
without `preserve_order`.

Emitted JSON is compared as bytes in tests, not as parsed structure, because
field order and null-versus-omitted are part of what scripts see.

### D4. Lenient gateway JSON structs replace the jq/awk pair

One reader deserializes `openshell ... --output json` into structs with
`#[serde(default)]`, so pretty-printed, compact, and single-line multi-object
layouts all work without a second code path.

*Why this preserves the `jq`-absent scenarios:* those scenarios exist because
the shell needs a parser at all. A typed reader has one behavior for every
layout, so both scenarios become a property of the single implementation.

*Risk:* leniency can hide a shape change. Mitigation: unknown fields are
tolerated but a missing *required* field is an error naming the command and the
field, and a fixture test covers each layout shape seen in gateway output.

### D5. Hand-rolled argument dispatch, not `clap`

The existing usage text, unknown-flag handling, and usage-error exit code are
observable and asserted. `clap` owns help formatting and exits with its own
code.

*Trade-off:* more dispatch code and manual help text. Accepted because the
surface is fixed and small, and because a help-text diff is a real regression
for users who script against `osa --help`.

*Alternative rejected:* `clap` with disabled help and a custom error mapping —
fighting the library to reproduce a hand-written surface.

### D6. Synchronous standard library; no async runtime

The only concurrency is waiting on child processes and their piped output.
`std` covers it. `tokio` arrives with the gateway client in the follow-up
change, not before.

*Why:* an unused async runtime doubles build time and dependency surface for a
CLI whose slowest operation is a gateway call it does not own.

### D7. A `Secret` type with no way to print itself

Credential values are carried in a newtype that implements neither `Display`
nor `Serialize`, and the only way to use one is `Command::env`, which takes it
by reference. A leak becomes a compile error at the call site rather than a
conformance failure.

*Why also keep the conformance leak case:* the type prevents accidental
formatting from Rust code, not a deliberate `arg(secret.expose())`, and the
black-box case covers the whole pipeline including the child process.

### D8. `bin/osa` is a nine-line shim with a documented override

The shim resolves the binary from the launcher variable, then the workspace's
release path, then fails naming `make build`. `exec` is used so signals, TTY
state, and the exit code pass through unchanged — the `osa dashboard` path
depends on that.

*Alternative rejected:* installing the binary into `bin/` or onto `PATH` at
build time. It would make the checkout stateful and let a stale binary shadow a
fresh build.

### D9. Parity runs through the conformance harness, with the shell kept briefly

The current script is preserved as `bin/osa-shell` for the duration of the
change so the harness has two backends. It is deleted in the final task, and
the task is only startable when parity is green.

*Why keep it in-repo rather than rely on git history:* the harness needs a
runnable backend, and a checked-out historical revision cannot be launched by
the suite.

## Risks / Trade-offs

- **Message and exit-code drift** (a help line, a usage exit code, an error
  string) → conformance goldens record exit codes and captured output; a
  dedicated message test asserts the usage text byte-for-byte.
- **Lenient parser hides a gateway shape change** → required fields error by
  name; each observed layout has a fixture.
- **Build needs crates.io on first use** → `Cargo.lock` is committed, the
  dependency set is deliberately small, and the host playbook states that the
  first build needs network access.
- **Rust toolchain on a host that did not need one** → pinned in
  `rust-toolchain.toml`, verified by its own playbook step, and `make test`
  stays toolchain-free.
- **Two implementations of one contract drift while both exist** → parity mode
  is required green before the shim flips, and the shell copy is deleted in the
  same change.
- **Losing the awk parser's tolerance accidentally** → the corpus oracle test
  compares against the recorded `awk` output rather than against my reading of
  it.
- **`osa dashboard` exec semantics regress** (TTY, signals, exit code) → a
  dedicated case runs a child that inspects its TTY and propagates a non-zero
  exit.

## Migration Plan

1. Land the workspace, the codec, and the shim behind `OSA_CORE_BIN`, so
   nothing changes for a host that does not opt in.
2. Port subcommands in dependency order (read-only queries, then state
   mutation, then provider and image paths), running conformance parity per
   command as it lands.
3. Flip the shim default once every case reports identical or is documented as
   intentionally divergent.
4. Delete `bin/osa-shell`; update `docs/helper.md` and the host playbooks.
5. Rollback: revert the shim to exec `bin/osa-shell`. The shell implementation
   is restorable from git, and no state on disk changed format, so a rollback
   needs no migration of a user's `$XDG_STATE_HOME/osa` tree.
