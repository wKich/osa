# Proposal

## Why

After the core change, `osa` is Rust but the four agent front-ends are still
2,203 lines of POSIX `sh` over `lib/oss-core.sh` (6,985 lines) and
`lib/osa-state.sh` (357 lines). They carry the densest logic in the repository:
settings precedence across four sources, sandbox naming, idempotent session
ensure, upload and sync classification, patch collection and apply, the provider
wizard with hidden input, the idle-stop watcher, per-sandbox locking, signal
cleanup, and the launch of each agent with its own environment.

That logic also holds a **second implementation** of the registry and marker
format, which the core change deliberately left in place. Two implementations of
one published contract is a temporary state that only a port can end.

The reason this is now practical rather than speculative is the test asset:
`tests/run-tests.sh` is 11,008 lines and about 2,320 assertions that drive the
commands as black boxes through a stubbed `openshell`. The conformance harness
made those cases backend-selectable. That suite is the port's specification, and
it is why this change can be verified case by case instead of by review.

## What Changes

- Grow `osa-core` into a library plus four `[[bin]]` targets — `maki-oss`,
  `opencode-oss`, `claude-oss`, `codex-oss` — sharing one implementation and
  differing only by an agent profile (environment prefix, config path, agent
  command, base image, own config keys).
- Port the whole front-end surface: settings precedence, naming, session ensure
  (`up`, bare invocation, `maki`, `run`), `status`, `upload`, `download`, sync
  classification and refresh, baseline and fingerprint, patch collect and
  apply, `rm`, `doctor`, `mcp status`, the provider wizard, idle stop, locks,
  and signal cleanup.
- Preserve the internal watcher invocation `__idle-watch NAME PID SECS` as a
  detached child with the same command-line shape, because the suite and the
  documented cleanup depend on it.
- Replace `bin/maki-oss`, `bin/opencode-oss`, `bin/claude-oss`, and
  `bin/codex-oss` with shims, and **delete** `lib/oss-core.sh` and
  `lib/osa-state.sh`.
- Keep `tests/run-tests.sh` as the acceptance suite, now describing the
  front-end suite that drives the built binaries.
- **BREAKING** (contributor): the helper is no longer a POSIX script.
  `shellcheck` no longer covers command logic, and `lib/` disappears.

Non-goals: the bridge, the dashboard, and oskhs keep their current code and
language; the fish plugin keeps calling `maki-oss`; no command gains or loses a
flag; no sandbox-side script changes.

## Capabilities

### New Capabilities

- `agent-frontend-binary`: the four front-end commands as Rust binaries — one
  shared implementation with a per-agent profile, full behavioral parity with
  the shell helper, the preserved internal watcher, streaming and exit-code
  semantics, TTY prompt behavior, signal cleanup, and the isolation invariants.

### Modified Capabilities

- `test-gate`: the former "POSIX shell suite" becomes the front-end suite that
  drives the built binaries, still run by a POSIX `sh` harness, and `make test`
  keeps its offline meaning.
- `host-setup`: the build step produces the four front-end binaries, and the
  shell preparation step verifies each command resolves and runs.

## Impact

- New: `osa-core/crates/osa-core/src/agent/` (profile, settings, naming, ensure, sync, patch,
  wizard, idle, locks, prompts, signals) and four `[[bin]]` targets.
- Removed: `lib/oss-core.sh`, `lib/osa-state.sh`, and the command logic in
  `bin/*-oss`. `docs/helper.md` keeps its command reference; the "POSIX sh"
  description of the stack changes.
- Unchanged behavior by design: every documented command, flag, environment
  variable, config key, output line, exit code, state file, and marker. The
  suite enforces this.
- Security: no invariant changes. The port must keep no bind mounts, credentials
  only through the child environment, deny-by-default egress, non-root sandbox
  execution, and no in-sandbox agent login. These are assertions in the existing
  suite, so a regression fails a case rather than being reviewed by eye.
- Risk: this is the change most likely to regress subtle behavior — patch
  fidelity, TTY prompts, the detached watcher, and interrupt cleanup are the
  sharp edges. Mitigated by porting in slices, each gated on the relevant cases
  plus conformance parity, and by deleting the shell only after the suite is
  green against the binaries.
- Depends on `add-rust-osa-core` and `add-helper-conformance-harness` (and reads
  more clearly after `add-openshell-sdk-transport`, though it does not require
  it: the front-ends keep the transport the core exposes).
