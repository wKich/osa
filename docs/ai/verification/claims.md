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

| Suite | Command | Layer it is authoritative for | Proves nothing about |
|---|---|---|---|
| Shell suite | `make test` | CLI behavior, state trees, and argv against stub executables | gateway transport, isolation |
| Conformance layer | `make test-conformance` | the same argv under the closed normalization and committed goldens | transport differences, isolation |
| Core suite | `make test-core` | Rust unit and integration behavior, offline recording seam included | the real gateway, isolation |
| End-to-end, in sandbox | `make test-e2e-local` or `tests/e2e/run.sh local` | session orchestration and caller sync through the in-sandbox control plane | isolation, policy, egress, credential brokering, real gateway transport |
| End-to-end, on a host | `make test-e2e` or `tests/e2e/run.sh host` | the same orchestration through a real gateway, and executed-versus-recorded parity | isolation; the suite reports no boundary result, and never a credential value |
| Gate | `make test-all` | every offline suite above, together | isolation |
| Agent verification pages | [`maki.md`](maki.md), [`opencode.md`](opencode.md), [`claude.md`](claude.md), [`codex.md`](codex.md) | the isolation checklist: policy, egress, uid/gid, filesystem policy, credential shape | session orchestration beyond the smoke run |

The control plane behind `test-e2e-local` enforces no isolation and no policy;
it exists so the front-ends' own lifecycle can run inside one sandbox. See
[`docs/ai/dev-environment.md`](../dev-environment.md).

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
  an isolation claim. Only the agent verification pages speak to isolation.
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
- [`docs/glossary.md`](../../glossary.md) — the vocabulary these claims use.
