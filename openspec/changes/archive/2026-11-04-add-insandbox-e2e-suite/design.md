# Design

## Context

See `proposal.md` for motivation. Constraints that shape the approach:

- `tests/run-tests.sh` is a POSIX `sh` harness that drives the built binaries as
  black boxes, selects a backend per front-end through `OSA_BACKEND_*`, and
  records argv for goldens. It already executes the helper's internal git
  scripts locally, so it is the closest existing thing to this suite.
- `tests/conformance/harness.sh parity` runs a case set twice and reports
  identical, or divergent in recording, state, or exit status.
- Caller mode (`sync-in`, `collect-patch`) is the sandbox-to-host direction and
  is already specified, including exit codes and the empty-patch case.
- The control plane provides real files, processes, and exit codes, but no
  isolation.

## Goals / Non-Goals

**Goals:**

- Prove that a session moves work, not that a command was assembled.
- Be runnable by an agent inside a sandbox with no gateway and no engine.

**Non-Goals:**

- No isolation, policy, egress, or credential assertions (the sibling boundary
  gate owns those).
- No replacement for the conformance suite: argv identity stays where it is.

## Decisions

### D1. POSIX `sh`, same shape as the existing harness

The suite is a `sh` harness under `tests/e2e/` with per-case functions,
`RUN_ONLY` selection, and a summary.

*Why:* the repository's test style is shell for black-box behavior; adding a
second harness language would double the runtime needs inside an already large
image and split the review conventions.

*Alternative rejected:* a Bun/TypeScript harness. It buys structured output at
the cost of a second execution model for the same kind of test.

### D2. Assert effects, not argv

Each case asserts workspace contents, state-tree files, exit codes, and process
lifetime. Recorded invocations are not compared here.

*Why:* argv is already pinned by the conformance goldens. Repeating it would
make this suite fail for reasons the other suite already reports, and would
hide the thing it exists to prove.

### D3. Scripted agents, not models

The four agent commands resolve to scripts that write deterministic changes,
print their working directory, and record their argument vector to a file.

*Why:* a model turn is nondeterministic and costs tokens; the orchestration
question is whether osa moves the agent's work, not whether the agent is smart.
The scripts also let a case provoke a specific failure (non-zero exit, signal,
slow child).

### D4. Parity compares against committed host recordings

A host run against a real gateway produces normalized transcripts through the
existing recorder; those are committed as fixtures. The in-sandbox run executes
the same scenario and the harness compares the two through the existing parity
mechanics.

*Why:* the sandbox cannot reach a real gateway, so the real behavior has to be
carried in. The recorder already redacts credential values and records
environment names only.

*Alternative rejected:* recording on every run. It needs a host, defeating the
purpose.

### D5. One opt-in real-agent case, asserted by effect

A single case runs a real agent headless when the sandbox has a provider
attached, and asserts only that the turn completed and changed the workdir. It
is skipped by name otherwise, and the suite's verdict never depends on it.

*Why:* it is the only case that can catch a break in the real binary's argv
handling or output parsing, but it must not make the suite slow, costly, or
flaky.

### D6. The summary states the layer

The harness prints one scope line naming orchestration as the covered layer and
stating that isolation, policy, egress, and credential brokering are not
covered.

*Why:* the cheapest defense against a misread green is to print the limit with
the result, every time.

## Risks / Trade-offs

- **Timing flakes** (idle stop, streaming, interrupt) → poll state with bounded
  deadlines instead of sleeping, and set the shortest documented idle value the
  configuration accepts.
- **A case that is stable only on the plane** → the host recording comparison
  catches it; the case is corrected or excluded with a stated reason.
- **Suite runtime** → cases share one sandbox where they can and use a fresh
  one only where isolation between cases matters (pending work, interrupt).
- **Divergence repaired by normalization** → the normalization rule from the
  conformance suite carries over: only paths, ids, timestamps, and pids, and
  the reviewer must reject a broad substitution.
