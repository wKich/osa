# Tasks

## 1. Workspace and build

- [x] 1.1 Create `osa-core/` as a Cargo workspace with a `osa-core` crate producing a binary named `osa`, plus `rust-toolchain.toml` and a committed `Cargo.lock`; verify `cargo build --release` succeeds from a clean checkout
- [x] 1.2 Add a `make build` target that builds the workspace and prints the artifact path; verify the printed path exists and is executable
- [x] 1.3 Add `make test-core` running `cargo test --workspace`; verify it passes with no gateway, no Docker, and no network dependency at runtime
- [x] 1.4 Verify `cargo clippy --workspace -- -D warnings` and `cargo fmt --check` pass, and wire both into `make lint`

## 2. Flat TOML codec

- [x] 2.1 Implement the `FlatEntry` ordered-pair type and its serializer (`key = "value"` lines, closed `\\`/`\"` escape set, refusal of newline and tab values); verify unit tests cover each refusal
- [x] 2.2 Implement the writer: mode `600`, temp file in the same directory, atomic rename, no partial file on failure; verify with a test that induces a failure and asserts the previous file survived and no temp file remains
- [x] 2.3 Implement the parser mirroring the `awk` grammar (blank lines, `#` comments, trailing comment, unknown keys, key regex, quoted values); verify unit tests cover each accepted and each rejected form
- [x] 2.4 Build the parser oracle corpus: record the current `awk` parser's output over a fixture set and commit it; verify the Rust parser reproduces every recorded line
- [x] 2.5 Define the entries (registry entry, pending marker, config) as structs with pinned field order and omit-absent semantics; verify golden flat-TOML files for each kind match byte-for-byte

## 3. State tree

- [x] 3.1 Implement state-root resolution (`XDG_STATE_HOME` fallback to `$HOME/.local/state`, `projects/` and `sessions/` layout); verify against the shell implementation for three environment shapes
- [x] 3.2 Implement session and resolve locks with the documented names, announcer-before-checker ordering, pid liveness, and stale cleanup; verify a concurrency test where two starters both observe the other
- [x] 3.3 Implement pending-marker kinds (explicit kind, retained-by-patch-content, parked fallback); verify unit tests for the marker-without-kind derivation
- [x] 3.4 Implement the git project fingerprint (HEAD plus checksum of status and diff, optional locks off) and verify it matches the shell value for a fixture repository with staged, unstaged, and untracked changes

## 4. Gateway JSON reading

- [x] 4.1 Implement lenient deserialization for `openshell sandbox list`, provider listings, and rule listings, tolerating pretty, compact, and single-line multi-object layouts; verify one fixture per layout resolves the same phase and provider set
- [x] 4.2 Implement required-field errors that name the command, the missing field, and the raw payload shape; verify a truncated-payload test exits non-zero with that message
- [x] 4.3 Remove every `jq` invocation from the ported paths and verify the core has no `jq` reference (`grep -r jq osa-core/` is empty)

## 5. Command port

- [x] 5.1 Implement the hand-rolled dispatcher, usage text, and usage-error exit code; verify a message test asserts the usage output and exit code byte-for-byte against the recorded shell output
- [x] 5.2 Port the read-only commands (`projects`, `status`, `health`, `images`, `providers`) and verify conformance parity reports identical for each
- [x] 5.3 Port the state-mutating commands (`remove`, `resolve` with `apply`, `branch`, `drop`, `rescue`, `discard`) and verify conformance parity reports identical, including lock behavior
- [x] 5.4 Port `provider setup` and `provider add` with the `Secret` newtype and child-environment-only delivery; verify the conformance leak case passes and that no `Display`/`Serialize` impl exists on the type
- [x] 5.5 Port `image build` and the `dashboard` passthrough with `exec`, keeping stdio inheritance; verify a case that asserts the child sees a TTY and a non-zero child exit code propagates unchanged

## 6. Shim and parity gate

- [x] 6.1 Write `bin/osa` as the shim (launcher variable, then release path, then a message naming `make build`), and verify an unbuilt checkout fails with that message and writes no state
- [x] 6.2 Preserve the current script as `bin/osa-shell` and verify conformance parity mode runs the case set against `bin/osa-shell` and the Rust binary
- [x] 6.3 Run parity over the full `osa` case set and resolve or document every divergence; verify the verdict is `identical` for every case or listed in the exclusion file with a reason
- [x] 6.4 Flip the shim to the Rust binary by default and verify `make test` passes with the new default
- [x] 6.5 Delete `bin/osa-shell` and its exclusion file, and verify `make test` and parity-mode-free `make test-all` pass afterwards

## 7. Gate and docs

- [x] 7.1 Add the core suite to `make test-all` and to CI, and verify a core-only failure makes `make test-all` exit non-zero naming the core suite, and that a missing `cargo` names the prerequisite
- [x] 7.2 Add the core build step to `docs/ai/host-playbook.md` (toolchain from `rust-toolchain.toml`, `make build`, `osa --help` verification) and verify the documented commands run in order on a clean checkout
- [x] 7.3 Update `docs/helper.md` to state that the `osa` surface is provided by the core binary and that `bin/osa` is a shim, and verify every documented `osa` example runs as written
- [x] 7.4 Verify the toolchain version in `rust-toolchain.toml` matches the version named in the host playbook
