# Design

## Context

See `proposal.md` - Why.

What is being ported, and where the sharp edges actually are:

| Area | Current shape | Why it is risky |
|---|---|---|
| Settings | flag > env > config > default, per-agent prefix | every value is read in several places today |
| Ensure | idempotent create/start/attach/upload before launch | ordering is asserted by many cases |
| Sync | clean/behind/retained/parked classification, baseline, fingerprint | fingerprint is `git status` + `git diff` through `cksum` |
| Patch | temp worktree, `git apply`-style collection, never writes the project | fidelity for renames, binaries, deletions |
| Idle stop | `nohup "$@" &` re-exec of `$0 __idle-watch NAME PID SECS` | a detached process whose command line is asserted by cleanup |
| Timeout | `timeout --kill-after=10` around the sandbox exec | pinned by `helper-cli` |
| Prompts | `[ -t 0 ]` gate, `stty -echo` for hidden input | terminal state must be restored on every path |
| Signals | `trap … INT TERM` with cleanup and non-zero exit | temp files, locks, and the watcher must not survive |
| Locks | `session.<pid>` files and `resolve.d/` | concurrency semantics are asserted |

The acceptance asset: `tests/run-tests.sh` already has `RUN_ONLY=<glob>` case
selection, per-case stub state, and stub CLIs for `openshell`, `bun`, `docker`,
`codex`, and `opencode`. Combined with the conformance harness's backend
selection and argv goldens, every slice below can be verified before the next
starts.

## Goals / Non-Goals

**Goals:**

- Delete the second implementation of the state contract.
- Keep every documented command, flag, output line, and exit code.
- Keep the existing suite as the specification, not as a rewritten test set.
- Make each slice independently regressable and revertible.

**Non-Goals:**

- Redesigning the sync model, the patch format, or the wizard's UX.
- Moving the bridge, dashboard, or oskhs.
- Removing the external `openshell`, `git`, `docker`, or `timeout` dependencies.
- Parallelizing anything the shell runs serially.

## Decisions

### D1. One library, four `[[bin]]` targets, profile as data

`osa-core/crates/osa-core/src/agent/` holds the shared pipeline. Each binary declares an
`AgentProfile` constant: tag, environment prefix, config path, agent command,
base image, and owned config keys.

*Alternative rejected:* one binary dispatching on `argv[0]`. It needs symlink
installation, breaks `command -v` clarity when both a shim and a symlink exist,
and hides which profile a process is running.

*Alternative rejected:* four crates. The shared logic is the majority; separate
crates would duplicate it or force a fifth shared crate anyway.

### D2. Vertical slices gated by case selection

Port order: settings and naming → `status`, `up`, create → upload and sync
classification → baseline, run, patch collection → `rm`, `doctor`, `mcp status`
→ provider wizard → idle watcher and signals → `fish install`.

Each slice is complete (its commands work end to end) before the next starts,
and each is verified with `RUN_ONLY` over the cases that cover it plus
conformance parity for its invocations.

*Why not module-by-module:* a horizontal port leaves every command half-moved,
so no case can pass and the suite gives no signal until the end.

### D3. The agent inherits the terminal

The launch uses inherited standard streams and waits for the child. The helper
writes nothing to standard output around it, because `helper-cli` requires the
agent's output on standard output unchanged.

*Why not capture and forward:* capturing changes buffering, breaks an
interactive agent, and would risk adding bytes to a stream scripts parse.

### D4. The detached watcher is a re-exec with null streams

The helper spawns its own executable with `__idle-watch NAME PID SECS`, standard
streams set to null, then drops the child handle. Liveness stays pid-based, the
watcher checks the lock before stopping anything, and the internal argument is
matched before profile dispatch.

*Why re-exec instead of an in-process timer:* the watcher must outlive the
session, so it cannot be a thread of a process that is exiting. Re-exec also
preserves the command line that cleanup patterns match on.

*Note:* dropping a `Child` does not reap it; once the parent exits the child is
reparented, so no zombie accumulates. The watcher itself exits after its single
decision.

### D5. External `timeout` is kept

`maki-oss run --timeout` keeps running the agent under
`timeout --kill-after=10`, as `helper-cli` states, rather than implementing a
timer in the helper.

*Why:* the requirement names the mechanism, and an in-process kill changes the
distinction between "the agent timed out" and "the helper failed", which callers
already depend on.

### D6. Signal cleanup is one guarded path

A cleanup guard owns every temporary file, directory, and lock the process
creates. `signal-hook` handlers set a flag and run the same cleanup the normal
exit path runs, then exit with the documented non-zero code (130 for interrupt,
143 for termination).

*Why not `Drop` alone:* `Drop` does not run when a signal terminates the
process, which is exactly the case the requirement covers.

*Why not `tokio::signal`:* the front-ends stay synchronous; the async runtime
is only in the gateway client.

### D7. Hidden input uses terminal attributes, not `stty`

The prompt module disables echo through terminal attributes and restores them in
a guard whose restore runs on the error and interrupt paths.

*Alternative rejected:* spawning `stty -echo`. It is one more child process and
one more failure mode than a direct `tcsetattr`, and the observable behavior
(characters not echoed, state restored) is identical.

### D8. Patch collection stays a `git` conversation

The collector keeps using `git` against a temporary worktree and produces the
same patch text, including renames (`--find-renames`), binary markers, and
deletions, and it still never writes to the project.

*Why not a library like `git2`:* the output bytes are the contract
(`helper-cli` requires specific additions, modifications, deletions, renames,
and binary changes), and matching `git`'s patch format by hand is harder than
invoking `git`.

### D9. State comes from the core layer, not a front-end copy

Registry entries, markers, locks, and fingerprints use the types built in the
core change. The port deletes `lib/osa-state.sh` in the slice that first makes
the binaries write state, so a second implementation never coexists in a
released state.

### D10. Prompts gate on standard input, as today

The interactive path keeps `[ -t 0 ]` semantics: prompts are interactive only
when standard input is a terminal. Reading `/dev/tty` instead would change
behavior for piped-stdin invocations that currently refuse.

### D11. The suite is kept, not replaced

`tests/run-tests.sh` stays a POSIX `sh` harness and keeps its cases. Its
description changes from "tests of the shell helper" to "black-box tests of the
front-end binaries", and the backend selection from the conformance change is
what makes it runnable against either implementation during the port.

*Why not port the suite to Rust:* the suite's value is that it asserts from
outside the implementation. Rewriting it in the implementation's language
removes that independence and would let a bug be "fixed" on both sides.

## Risks / Trade-offs

- **Silent behavioral drift in a corner case** → slices are gated on the
  relevant `RUN_ONLY` set plus conformance parity; the shell implementation
  stays until the whole suite is green.
- **Patch fidelity** (renames, binary files, mode bits) → dedicated cases before
  the patch slice is considered done, and the shell implementation remains
  available to produce a comparison patch for a fixture repository.
- **Detached watcher lifecycle** (orphan or double-stop) → a case that asserts
  one watcher per session, its command line, and its single decision; cleanup by
  pattern is asserted.
- **Terminal state left altered after an interrupt** → the restore guard plus a
  case that interrupts the hidden prompt and asserts echo is back.
- **Signal exit codes drift** → a case per signal asserting the exact code.
- **`timeout` availability differs across hosts** → unchanged from today, and
  the requirement keeps naming the mechanism; the doctor check continues to
  report it.
- **Loss of `shellcheck` coverage** → `clippy -D warnings` plus the suite; the
  sh that remains is shims and the test harness, both still covered.
- **A slice that cannot pass a case** → the case is investigated, not excluded;
  an exclusion needs a written reason and applies only to a case that asserts
  the shell implementation itself.
- **A long-lived branch that conflicts with in-flight changes** → slices land as
  separate reviewed units with the shell still authoritative until the flip.

## Migration Plan

1. Land the library skeleton, profiles, and shims behind the backend variable,
   so nothing changes for a host that does not opt in; the shell stays the
   default.
2. Land slices in the D2 order, each with its cases green in parity mode
   (`transport-changed` or identical as appropriate, state and output
   identical).
3. Flip the shims to the binaries once the full suite is green.
4. Delete `lib/oss-core.sh` and `lib/osa-state.sh`; update `docs/helper.md` and
   the stack description in `openspec/config.yaml`'s context.
5. Rollback: `bin/*-oss` shims exec the preserved shell helper from git. No
   on-disk format changed during the port, so a rollback needs no state
   migration.

## Open Questions

None that change the specs or the task breakdown. Whether the `sh` harness is
eventually re-expressed in another language is deliberately left alone: it is
the independent oracle, and moving it would weaken the port's evidence.
