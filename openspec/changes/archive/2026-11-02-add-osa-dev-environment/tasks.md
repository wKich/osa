# Tasks

## 1. Store skeleton

- [x] 1.1 Create `examples/environments/dev/` with `Dockerfile`, `.dockerignore`, and `README.md`; `OSA_DEV_BASE` (default the Maki base) and `OSA_DEV_AGENT` are build arguments. Verify: `docker build -t osa-dev:local examples/environments/dev` succeeds and the image's `id` reports uid 1500.
- [x] 1.2 State in the README that the store is not the base, is not a front-end default, and carries no credential or egress rule. Verify: `grep -R 'osa-dev' bin/ examples/maki-image/ osa-core/crates/osa-core/src/` finds nothing.

## 2. Toolchain and runtimes

- [x] 2.1 Install the Rust channel from `rust-toolchain.toml` with `clippy` and `rustfmt`, as uid 1500 under `/sandbox/.rustup` and `/sandbox/.cargo`. Verify: `cargo --version` reports the pinned channel and `cargo clippy --version` resolves.
- [x] 2.2 Install a pinned Bun and a pinned `openspec` CLI as build arguments. Verify: `bun --version` and `openspec --version` report the pinned values.
- [x] 2.3 Install the suite prerequisites the base lacks: `jq`, `timeout`, `pkill`, `fish`, `patch`. Verify: `for t in jq timeout pkill fish patch; do command -v $t; done` prints each path.
- [x] 2.4 Install a MongoDB server with its data directory under `/sandbox`. Verify: the image's start command brings it up and `mongosh --eval 'db.runCommand({ping:1})'` succeeds offline.

## 3. Offline dependencies

- [x] 3.1 Fetch the workspace at image build into `/sandbox/.cargo`, covering the registry and the OpenShell dependency pinned in `osa-core/Cargo.lock`, owned by uid 1500. Verify: `ls /sandbox/.cargo/registry/cache` and `/sandbox/.cargo/git/checkouts` are non-empty.
- [x] 3.2 Prove an offline build and core run. Verify: with egress unavailable, `make build` and `make test-core` both exit 0.
- [x] 3.3 Document the rebuild rule for a `Cargo.lock` change. Verify: the README section exists and the failure mode (a missing package named by the offline build) is quoted.

## 4. Verification target

- [x] 4.1 Add `make verify-dev-environment` and `scripts/verify-dev-environment.sh`: check each runtime version, an offline build, the shell suite, the core suite, and a started MongoDB with the full gate. The script calls cargo, the suite scripts, and the gate script directly, never `make`. Verify: the script exits 0 in the built image.
- [x] 4.2 Make the script fail on the first missing runtime. Verify: run it with `jq` removed from `PATH` and confirm exit is non-zero and the message names `jq`.
- [x] 4.3 Prove the store is base-parameterized. Verify: a build with `OSA_DEV_BASE=opencode-agent:local` reports the same agent version as that base.

## 5. Documentation

- [x] 5.1 Add `docs/ai/dev-environment.md` covering the build, the in-sandbox loop, the offline rules, and the layer claim (parsing, transport, and suite runs; not isolation). Verify: `scripts/check-links.sh` passes.
- [x] 5.2 Link the page from `docs/ai/environment-playbook.md` without restating it. Verify: one link, no duplicated procedure text.

## 6. Suite portability on Linux

- [x] 6.1 Read the mode with the platform's `stat` in `assert_file_mode` (GNU `-c '%a'` first, BSD `-f '%Lp'` fallback). Verify: `make test` reports every mode assertion as passing on the host and inside the development image.
- [x] 6.2 Normalize a literal `/tmp` to `<tmp>` in `tests/conformance/normalize.sh`, so a recording is the same whether or not `TMPDIR` is set. Verify: `make test` reports `0 mismatched` on the host and inside the image.
- [x] 6.3 Re-record the seven goldens that carry a temp path (`test_mk_run_stdin_timeout*`, `test_cc_run_stdin_timeout*`, `test_caller_run_wrapper*`, and the four `caller-inc-*` recordings) under the fixed normalizer. Verify: their diff is temp-path lines only, and `make test` exits 0 on the host and inside the image.

## 7. Sandbox policy and the make-free gate

- [x] 7.1 Add `examples/policies/osa-dev-environment.yaml`: the minimal policy plus the one read-only CPU-topology path MongoDB's allocator needs, with no network rule and no other widening. Verify: `openshell policy get` reports that path and nothing else new, and `mongod --version` exits 0 in a sandbox created with it.
- [x] 7.2 Move the full gate into `scripts/test-all.sh` and have `make test-all` call it, so the gate runs where `make` cannot spawn a child process. Verify: `make test-all` and `scripts/test-all.sh` both exit 0 on the host.
