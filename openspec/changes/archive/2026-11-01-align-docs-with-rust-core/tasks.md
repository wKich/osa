# Tasks

## 1. First-run entry pages

- [x] 1.1 `README.md`: name the pinned Rust toolchain in Prerequisites, put
      `make build` before `bin/maki-oss image build` in the install block, and
      describe the helper as Rust behind a POSIX `sh` shim. Verify
      `grep -n 'make build' README.md` shows it before `image build`, the
      "plain POSIX `sh` helper" phrase is gone, and
      `scripts/check-links.sh README.md` exits 0
- [x] 1.2 `docs/ai/quickstart.md`: name the toolchain in "Prepare the host",
      and in step 2 run `make build` and `./bin/maki-oss --help` before
      exporting `PATH`. Verify the `make build` line precedes the first
      `bin/` helper command and `scripts/check-links.sh docs/ai/quickstart.md`
      exits 0
- [x] 1.3 `docs/setup-guide.md`: add pinned-toolchain and built-helper rows to
      the prerequisites table, and run `make build` plus a `--help` smoke
      check in the clone block. Verify both rows are present and
      `scripts/check-links.sh docs/setup-guide.md` exits 0
- [x] 1.4 `docs/ai/onboarding.md`: the Helper on `PATH` section runs
      `make build` and `./bin/maki-oss --help` before resolving, and the `P2`
      phase row names the build and a running check for all four front-ends.
      Verify `grep` shows `make build` in the section and in the `P2` row, and
      `scripts/check-playbooks.sh docs/ai` exits 0

## 2. Verification surfaces

- [x] 2.1 `docs/ai/playbooks/maki.md`: the Shell preparation section says the
      host playbook has built the helper, both POSIX and fish checks run
      `maki-oss --help` after resolving, and the expected/stop text states that
      a shim over a missing binary fails naming `make build`. Verify
      `scripts/check-playbooks.sh docs/ai` exits 0 and, after `make build`,
      `./bin/maki-oss --help` exits 0
- [x] 2.2 `docs/ai/references.md`: add a project-toolchain section indexing the
      rustup installer the host playbook links. Verify
      `scripts/check-links.sh docs/ai` exits 0 and
      `grep -q 'rustup' docs/ai/references.md` succeeds
- [x] 2.3 `dashboard/README.md`: state in Requirements that `osa` is the built
      core binary and a checkout needs `make build` before the Projects view
      works. Verify `grep -q 'make build' dashboard/README.md` succeeds and
      `scripts/check-links.sh dashboard/README.md` exits 0
- [x] 2.4 `docs/helper.md`: list `make build` and `make test-core` in
      Development checks, and keep the `make lint` description that includes
      `cargo fmt` and `clippy`. Verify the four commands appear and
      `scripts/check-playbooks.sh docs/ai` exits 0

## 3. Contract and end-to-end checks

- [x] 3.1 Run `openspec validate align-docs-with-rust-core --strict` and verify
      it exits 0 with the modified `agent-onboarding` requirement
- [x] 3.2 In a temporary clone or copy with no `osa-core/target`, run the
      first-run helper command and verify it exits non-zero naming
      `make build`; run `make build`, then `./bin/maki-oss --help`, and verify
      exit 0. Record both outputs in the apply summary
- [x] 3.3 Run `make lint-docs` and
      `scripts/check-links.sh` over every touched file, and verify both exit 0
