| Field | Value |
|---|---|
| Doc | `verification-claims` |
| Kind | `verification` |
| Agent | `shared` |
| Covers | `P6-P7` |
| Reference | `tests/e2e/run.sh` |
| Verified | 2026-11-04: `tests/e2e/run.sh host` and `tests/e2e/run.sh local` each reported 22 passed, 1 skipped, 22 identical |

# Verification: what each suite proves

## Scope

Every green run in this repository is a claim about one layer, and no suite
proves more than its layer. Read this table before citing a result: an
in-sandbox green is never evidence about the sandbox boundary, and the
end-to-end suite is no exception.

The end-to-end suite covers **session orchestration**: `up`, a session run,
pending work, caller-mode sync, lifecycle, and the four front-ends' observable
outcomes. It states that scope on every run, passing or failing:

```text
e2e scope: orchestration (sessions, caller sync, lifecycle, pending work) is covered.
e2e scope: isolation, policy, egress, and credential brokering are NOT covered.
```

### The layer-claim table

Each layer has exactly one authoritative suite and one runner. A green run in
any other suite is supporting evidence at best; it is never the claim.

| Layer | Authoritative suite | Runner it requires |
|---|---|---|
| Parsing and configuration | `make test-conformance` | POSIX sh and the stubs under `tests/stub`; no gateway, engine, or network |
| Gateway transport | `make test-e2e` (`tests/e2e/run.sh host`) | a reachable OpenShell gateway, the test-support binaries from `scripts/build-e2e.sh`, and the project image |
| Session orchestration | `make test-e2e-local` (`tests/e2e/run.sh local`) | the in-sandbox control plane and the test-support binaries; no gateway |
| Boundary | `make test-boundary` (`tests/boundary/gate.sh`) | a host with a reachable OpenShell gateway, a container engine, the project image, bun, cargo, opencode, `OSKHS_TEST_MONGO_URI`, and a verification sandbox with the provider attached |

The boundary gate is authoritative because it is the only suite that runs the
live journey against a real gateway *and* asserts the isolation facts: an
endpoint in no policy is refused, the credential variable holds a gateway
placeholder rather than a key, no host path is visible, the process runs as
uid/gid 1500, no bind mount exists, and the refusal is in the gateway log.

**A pass produced inside a sandbox — including `make test-e2e-local` and any
`make test-all` run in the development image — is never evidence for a
boundary claim.** Only a gate record from the host is.

### What each suite covers

| Suite | Command | Layer it covers | Proves nothing about |
|---|---|---|---|
| Shell suite | `make test` | CLI behavior, state trees, and argv against stub executables | gateway transport, isolation |
| Conformance layer | `make test-conformance` | the same argv under the closed normalization and committed goldens | transport differences, isolation |
| Core suite | `make test-core` | Rust unit and integration behavior, offline recording seam included | the real gateway, isolation |
| End-to-end, in sandbox | `make test-e2e-local` or `tests/e2e/run.sh local` | session orchestration and caller sync through the in-sandbox control plane | isolation, policy, egress, credential brokering, real gateway transport |
| End-to-end, on a host | `make test-e2e` or `tests/e2e/run.sh host` | the same orchestration through a real gateway, and executed-versus-recorded parity | isolation; the suite reports no boundary result, and never a credential value |
| Suite gate | `make test-all` | every offline suite above, together | isolation |
| Boundary gate | `make test-boundary` | the boundary: the live journey run plus the scripted isolation checks | anything it did not run; a failed or incomplete run proves nothing |
| Agent verification pages | [`maki.md`](maki.md), [`opencode.md`](opencode.md), [`claude.md`](claude.md), [`codex.md`](codex.md) | the explanation behind each check, and the helper-path checks the gate does not automate | anything a page records without a gate record behind it |

The control plane behind `test-e2e-local` enforces no isolation and no policy;
it exists so the front-ends' own lifecycle can run inside one sandbox. See
[`docs/ai/dev-environment.md`](../dev-environment.md).

## The boundary gate

`make test-boundary` runs `tests/boundary/gate.sh` on a host. It composes, in
one fixed order:

1. `scripts/test-all.sh` — the body `make test-all` runs, unchanged in meaning.
2. `bun bridge/test/journeys/harness/live.ts` — the live journey run against
   the real pinned Maki in one throwaway sandbox.
3. `tests/boundary/checks.sh` — the scripted isolation checks, one assertion
   each, over evidence collected from the named sandbox.

The sandbox is named with `--sandbox NAME` or `MAKI_OSS_SANDBOX_NAME`; the
probe host and credential variable default to `example.com` and
`ANTHROPIC_API_KEY` and can be set with `--probe-host` and `--credential-var`.
A missing prerequisite — a reachable gateway, the engine, the image, bun,
cargo, opencode, `OSKHS_TEST_MONGO_URI`, or the sandbox — fails the gate with a
message naming it. Nothing is skipped, and a check that cannot be automated is
recorded as manual, which makes the run **incomplete**, not passed.

### Sandbox work arrives as a patch

Work authored inside a sandbox leaves as a patch (`collect-patch`). The gate
takes `--patch FILE --base COMMIT`, creates a throwaway clone at that commit,
and applies the patch there. Before it runs any suite it refuses a patch whose
preimage content is not in the base commit, a target tree that is not clean,
and a path that escapes the checkout. The suite runner is the base commit's own
`scripts/test-all.sh`, copied out of the checkout, and `make` is never invoked
inside it, so neither the patch nor the sandbox can choose the command that
runs. The checkout is removed on every exit, and it runs with a fixed git
identity with no host credential helper. Nothing runs automatically on work a
sandbox produced: a person starts the gate.

### The record

The gate prints a record on completion, and only a record from a `passed` run
is a boundary pass:

```text
boundary record
  gateway: OpenShell 0.1.7
  agent: maki 0.6.5
  engine: docker 29.4.0
  image: maki-agent:local (sha256:...)
  patch: none (working tree 8c3fba3)
  checks:
    egress-denied: pass
    credential-shape: pass
    host-paths: pass
    sandbox-user: pass
    no-bind-mount: pass
    gateway-log-refusal: pass
  verdict: passed
```

A record with a `manual` check, a dry run, or any failed part reads
`incomplete` or `failed`, and must not be recorded as a boundary pass. The
record never contains a credential value.
[`docs/verification-log.md`](../../verification-log.md) is where a record is
written.

### CI

The gate is **not** a job in `.github/workflows/test.yml`: a hosted runner has
no OpenShell gateway, no container engine with the project image, and no
sandbox holding a provider, and the gate must fail rather than skip when they
are absent. The documented home for it is a self-hosted runner or a scheduled
manual run on a host that provides all of `openshell status` reporting
`Connected`, a reachable container engine with the image built, and bun,
cargo, opencode, and `OSKHS_TEST_MONGO_URI`. The workflow file's header links
to this decision.

The offline half of the gate — every check's pass and fail path, the three
patch refusals, the fixed command set, and the record verdicts — is proven
without a gateway by [`tests/boundary/self-test.sh`](../../../tests/boundary/self-test.sh).

## Check 1 — The scope line and the verdicts

### Run

| Check | Command |
|---|---|
| Scope line on a pass | `tests/e2e/run.sh local` (or `host`) with every case passing |
| Scope line on a failure | the same with a case deliberately failed |
| No boundary verdict | `grep -Ei 'policy\|egress\|credential' ` on the suite's output |
| Parity verdict | `tests/e2e/parity.sh --self-test` |
| Drift is named | alter one normalized operation in a run transcript, then compare |

### Verify

Expected:

| Check | Observed |
|---|---|
| Scope line on a pass | both `e2e scope:` lines print before the summary |
| Scope line on a failure | the same two lines print, then the failures |
| No boundary verdict | only the scope lines mention the uncovered layers; no case reports a decision |
| Parity verdict | `parity self-test: identical and divergent in providers` |
| Drift is named | `divergent in <field> (<case>)` and a non-zero exit |

### Stop if

- A suite result is cited for a layer it does not own, especially an
  in-sandbox green cited for isolation.
- The summary omits either scope line, or a run reports a boundary verdict.
- A divergence is reported without naming the case and the field.

## Invariants

- An in-sandbox green, including the whole end-to-end suite, is never cited as
  an isolation claim. Only a `make test-boundary` record from the host speaks to
  the boundary.
- A boundary claim quotes a `passed` record. A record marked `incomplete` or
  `failed`, and a check recorded as `manual`, is not a pass.
- The end-to-end summary names orchestration as covered and isolation, policy,
  egress, and credential brokering as not covered. A summary without the scope
  line is a bug.
- The suite asserts no boundary verdict. It may assert phases, files, exit
  codes, state records, and agent argv; it never reports a policy or egress
  decision.
- Provider variables are asserted by name only. No suite reads, records, or
  prints a credential value, and the recorder scans its transcripts before a
  run counts as recorded.
- Host recordings are inputs, not verdicts: a matching plane run reports
  `identical`, and an altered operation names the case and field and fails.

## See also

- [`docs/ai/dev-environment.md`](../dev-environment.md) — the in-sandbox loop and
  the control plane's non-guarantee.
- [`tests/e2e/run.sh`](../../../tests/e2e/run.sh) — the harness, modes, and knobs.
- [`tests/boundary/gate.sh`](../../../tests/boundary/gate.sh) — the boundary gate,
  its fixed command set, and its patch refusals.
- [`tests/boundary/checks.sh`](../../../tests/boundary/checks.sh) — the six
  scripted isolation checks and the evidence each reads.
- [`docs/verification-log.md`](../../verification-log.md) — where a boundary
  record is written.
- [`docs/glossary.md`](../../glossary.md) — the vocabulary these claims use.
