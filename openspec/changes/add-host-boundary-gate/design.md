# Design

## Context

See `proposal.md` for motivation. Constraints that shape the approach:

- `test-gate` defines `make test-all` as the one verification gate and requires
  it to fail, not skip, on a missing prerequisite.
- `make test-journeys-live` already skips cleanly when `openshell`, a gateway,
  `opencode`, `bun`, or the image is unavailable — acceptable for a convenience
  target, unacceptable for a boundary verdict.
- `docs/ai/verification/{maki,opencode,claude,codex}.md` carry the isolation
  checks as commands plus "Stop if" prose.
- Caller mode already produces a binary patch against a recorded baseline with
  no bind mount.

## Goals / Non-Goals

**Goals:**

- One command that either produces a boundary verdict or fails naming what it
  could not check.
- Make the limits of every other suite explicit and quotable.

**Non-Goals:**

- No new isolation mechanism, policy rule, or credential handling.
- No automatic execution of sandbox-authored code on the host.

## Decisions

### D1. Compose, do not reimplement

`make test-boundary` runs `make test-all`, the live journey run, then the
scripted checks. It does not redefine what `test-all` covers.

*Why:* `test-gate` already owns the suite list; duplicating it would create two
definitions of "everything" that drift.

### D2. Isolation checks become assertions

Each of the six checks gets a command, an expected result, and a failure
message. The "Stop if" prose stays as explanation but is no longer the check.

*Why:* prose cannot gate a pipeline, and a human reading it after the fact is
not evidence. A check that cannot be automated (a judgment call) is recorded as
manual and makes the run incomplete rather than passing.

### D3. Patch in, fixed commands

The gate takes a patch file and a base commit, creates a throwaway checkout,
applies the patch, and runs a fixed, documented command set. It refuses a
mismatched base, a dirty target, or a path set that escapes the checkout, and
removes the checkout afterwards. It runs the checkout's code but never a
command chosen by the patch or by the sandbox.

*Why:* the patch is the only thing that crosses from the sandbox, and the code
it contains has to run to be verified — in a disposable tree, with the host's
credential store out of reach, and with a command list the author cannot
influence.

*Alternative rejected:* a watcher that gates whenever a sandbox claims work is
ready. It converts an agent's write into host execution with no human decision,
which is a privilege path the project spent its invariants avoiding.

### D4. Every result names its layer

A claim table in `docs/ai/verification/claims.md` names, per layer, the
authoritative suite and the runner it needs. The verification-log record format
requires the gate's own evidence, so a sandbox run cannot be recorded as a
boundary result.

*Why:* the failure this prevents is not a bug but a sentence: "it passed in the
sandbox, so isolation is fine". A table is cheap and can be cited.

### D5. The gate prints a record block

On completion the gate prints the gateway, agent, engine, and image versions,
the patch commit, each check with its outcome, and an overall verdict including
"incomplete" when a prerequisite or a manual check is missing.

*Why:* the record should be a copy of reality, not a reconstruction. It also
makes the incomplete case impossible to paste as a pass.

## Risks / Trade-offs

- **The credential check must compare without echoing** → the check tests the
  shape of the value (a gateway-issued placeholder bound to the revision) and
  never prints it; a failure names the variable only.
- **Gateway log format is version-dependent** → the check names the pinned
  gateway version and fails with a version message rather than silently finding
  nothing.
- **The gate needs a real gateway, so it cannot run in CI as-is** → it is a
  documented manual or scheduled job; the sandbox loop points at it and does not
  pretend to replace it.
- **Throwaway checkout leaks host git identity** → the checkout is created with
  a fixed identity and without host credential helpers.
