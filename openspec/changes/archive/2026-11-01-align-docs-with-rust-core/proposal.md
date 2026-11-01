# Proposal

## Why

The Rust port replaced the shell helper with shims that `exec` a built binary
under `osa-core/target/release/`, but the first-run pages and the onboarding
spec still treat `clone` plus `PATH` as a working helper. A clean host
following the README or quickstart reaches `maki-oss image build` and stops on
`the front-end binary is missing; run make build`, and the README still calls
the helper "plain POSIX sh".

## What Changes

- README, quickstart, setup guide, and onboarding name the pinned Rust
  toolchain, run `make build` before the first helper command, and describe the
  helper as Rust behind a POSIX `sh` shim.
- The Maki playbook's shell preparation runs the helper after it resolves, and
  states that an unbuilt shim fails with a message naming `make build`.
- The onboarding phase map names the build and a running check in its `P2` row
  for all four front-ends.
- `docs/ai/references.md` indexes the rustup link the host playbook now uses.
- `dashboard/README.md` states that `bin/osa` must be built with `make build`.
- `docs/helper.md` lists `make build` and `make test-core` in its development
  checks.
- The `agent-onboarding` spec requires the core build in every clean-host page,
  not only the clone and `PATH` step, so the contract that allowed the drift is
  corrected rather than just today's pages.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-onboarding`: the "First-run documentation is executable" requirement
  now includes the core build and treats a resolvable shim over a missing
  binary as not ready.

## Impact

- Docs: `README.md`, `docs/ai/quickstart.md`, `docs/setup-guide.md`,
  `docs/ai/onboarding.md`, `docs/ai/playbooks/maki.md`,
  `docs/ai/references.md`, `docs/helper.md`, `dashboard/README.md`.
- Specs: `openspec/specs/agent-onboarding/spec.md` via a delta.
- No Rust, shell, fish, dashboard, or sandbox code changes; no command, flag,
  config, state, or security-invariant change.
- Historical records (`docs/verification-log.md` and archived changes) stay
  unchanged; they describe the state at the time of each run.
