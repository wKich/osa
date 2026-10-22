# Design

## Context

The `subagent-nesting` row is `verified` with `caveat: contract-only`, its
evidence is `bridge/test/golden.test.ts`, and the golden projects
`bridge/test/fixtures/maki-subagent.jsonl` — a fixture `provenance.json` marks
`authored`, derived from `parent_tool_use_id` on `assistant`/`user` frames as
pinned in Maki `sdk_mode.rs` v0.6.4. The fixture comment at
`bridge/test/golden.test.ts:40-45` says the shape was "never captured from a
live subagent turn."

Pinned source confirms the *reading* is right — `AssistantPayload` and
`UserPayload` both carry an `Option<String> parent_tool_use_id` behind
`skip_serializing_if`, populated from `envelope.subagent` — but confirming a
reading against the same reading is what got the row here. What is needed is
one turn where Maki itself writes the frames.

Host state, checked before writing this: gateway `openshell` connected over
mTLS, `maki-synthetic` registered with one credential key bound to its single
endpoint, image `maki-agent:local` present, no sandbox currently running. The
archived live smoke (`2026-10-21-add-opencode-tui-bridge/evidence/live-smoke-note.md`)
is the recipe that previously satisfied all three.

See proposal.md for why; this document is only how the capture is taken and
what happens to the records either way.

## Goals / Non-Goals

**Goals:**

- One committed fixture whose `parent_tool_use_id` frames Maki actually wrote.
- The golden runs over that capture, so a future disagreement is a failing
  test instead of a preserved assumption.
- `contract-only` comes off `subagent-nesting` if and only if the capture
  confirms it.
- The capture is repeatable by a committed script, and takes no credential
  into any committed file.

**Non-Goals:**

- Changing `bridge/src/**`. No capture hook in `maki.ts`, no new SDK flag.
- Streaming coverage. `maki-stream.jsonl` stays `authored`; see proposal.md.
- A real `api_retry` capture. `maki-retry.jsonl` stays `mixed`.
- Making the capture part of `make test`. It needs a gateway, an image, and a
  provider, so it is gated like `test-ui` and skips with a message.
- Proving the bridge's *translation* of subagent frames — the golden already
  does that, and this change only replaces the input shape it is fed.

## Decisions

### D1 — Capture Maki directly inside the sandbox, not through the bridge

`openshell sandbox exec -n <name> --no-login-shell --workdir <dir> -- maki -p
--trust --input-format stream-json --output-format stream-json -m
synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017`,
stdin driven with one `user` message, stdout tee'd to the fixture.

**Why not through the bridge:** `bridge/src/maki.ts` pipes child stdout
straight into the frame parser with no capture hook, and adding one is exactly
the source change this change excludes. The question the capture answers —
what does Maki write? — is upstream of the bridge, so routing it through the
bridge would cost a source change to answer a question the bridge does not
influence.

**Alternative considered:** reuse `MAKI_CHILD_CMD`. Rejected — that seam
exists to substitute a scripted child in tests; pointing it at a real Maki
running on the host would break the repository's premise that Maki runs inside
the sandbox.

The boundary holds: Maki still runs inside the sandbox as the non-root sandbox
user, over a stdio pipe, with no bind mount and no `--env` value.

### D2 — Provoke the subagent with `--append-system-prompt`, and gate on it

A subagent turn requires the model to call the `task` tool (mapped to `Task` by
`TOOL_NAME_MAP` in the pinned `sdk_mode.rs`). Prompting for it and hoping is
non-deterministic. Pinned `sdk_mode.rs` reads `cli.append_system_prompt` and
passes it to `InteractiveParams.append_system_prompt`, so the capture script
appends a short instruction naming the `Task` tool.

**Gate, not assumption:** pinned `sdk_mode.rs` starts with
`cli.warn_ignored_flags()`, so an unrecognized flag would be warned about and
dropped rather than failing. Task 1 therefore verifies the flag is accepted
*before* the run, by capturing stderr and confirming no ignore warning.

**If this model still cannot produce a subagent turn** — no `Task` call in N
attempts — the change stops at a recorded outcome rather than picking another
model on its own. A different model needs only a different `-m` spec on the
already-registered `maki-synthetic` profile, so it costs no new credential and
no new egress rule, but *which* model replaces this one is the user's
decision. The fallback is stated in task 1 as an explicit stop, so the plan
carries no unstated assumption about what this model will do.

### D3 — The authored fixture stays; the live capture joins it

`FIXTURES` in `bridge/test/golden.test.ts` gains the live capture alongside
`maki-subagent`, and both get a golden.

**Why not replace:** a single live run is unlikely to reproduce every edge the
authored fixture pins (nested `tool_result` mapping, subagent frames at turn
boundaries). Replacing it would trade a wide synthetic shape for a narrow real
one and silently drop coverage.

**Outcomes:**

- *Live projects to the same golden* → the authored shape was right.
  `contract-only` is dropped from `subagent-nesting`, the new fixture's
  provenance reads `captured`, and the report says observed.
- *Live projects differently* → the golden follows the capture, the authored
  fixture keeps `authored`, and the difference is recorded as a discovery
  finding. The `caveat` stays. A disagreement here is success, not failure:
  it is the circularity breaking.

Either way `cd bridge && bun test` stays green — a green suite after a shape
disagreement means the golden was updated to the observed shape.

### D4 — One committed, gated capture script

`bridge/test/capture-subagent.sh`, alongside the test suite, following the
archived `capture-bridge.sh` precedent: it takes the sandbox name and output
path, prints what it is doing, and skips with a message when `openshell`,
`bun`, or the image is absent. Not wired into `make test`, same rule the
gated TUI pass follows. Its committed existence is what makes the fixture
reproducible instead of a one-off artifact nobody can regenerate.

### D5 — The redaction scan runs over the capture before it is committed

The archived evidence carries `redaction-scan-2026-10-21.md` with two greps —
value-shaped credential patterns, and authorization/api-key key names — over
`bridge/` and the evidence directory. The same two scans run over the new
capture and the scan result is committed as evidence. A capture is model
output from a live run; the rule that kept the earlier captures clean is the
rule that applies here.

### D6 — The two deferred findings are written down, with their cost

Recorded in this change's evidence so the next iteration inherits them as
decisions rather than rediscoveries:

1. The bridge never passes `--include-partial-messages`; pinned `sdk_mode.rs`
   gates every `stream_event` emission on it. The `stream-deltas` path cannot
   occur through the shipped child invocation.
2. The archived `e2e-note.md` recorded that the model in use then never
   streams. That was a property of that model, not of the provider or the
   network: naming a different model on the same registered profile needs no
   new credential and no new egress rule. This change does not take it up —
   `add-live-stream-deltas` owns the streaming observation.

Neither is fixed here (proposal.md, Out of scope). Together they explain why
this change captures a subagent turn and not a streaming one.

## Risks / Trade-offs

- **[The synthetic model never calls `Task`]** → Gate in D2: verify the flag,
  attempt a bounded number of times, then stop and ask rather than reaching
  for another provider. Cost of the stop is one sandbox create and delete.
- **[`--append-system-prompt` is ignored in SDK mode]** → Detected by the
  stderr check before the run; if ignored, fall back to putting the instruction
  in the prompt text itself, which needs no flag.
- **[The capture disagrees with the authored fixture and the golden churns]**
  → Expected outcome per D3, and the reason for the gate: the golden follows
  the capture, the report keeps `contract-only`, and the difference becomes a
  discovery finding rather than a silent overwrite.
- **[A live capture carries host paths or model output with secrets]** → D5's
  committed scan, and the credential never enters the sandbox in the first
  place: it is a profile binding the gateway's proxy consumes, so the sandbox
  only ever sees the opaque stand-in.
- **[Two fixtures named similarly confuse future readers]** → Distinct names
  (`maki-subagent` authored, `maki-subagent-live` captured) and a
  `provenance.json` entry for each, which `crosscheck.test.ts` already
  enforces in both directions.
- **[The sandbox create takes ~90 s and the gateway must be up]** → Accepted;
  this is a gated, human-run task by design (D4), never part of `make test`.

## Migration Plan

One commit: capture script, live fixture, provenance entry, golden for the new
fixture, the `caveat` edit either way, `make compat` regeneration, and the
evidence files (capture note, shape comparison, redaction scan). The suite
gates it: `cd bridge && bun test` must be green, including the provenance
assertion from the earlier change. Rollback is a revert — nothing in
`bridge/src` changes, so there is no behavior to unwind.

## Open Questions

None that change the specs or the task breakdown. Whether the synthetic model
can produce a subagent turn is not an open question to decide here — it is
task 1's measured gate, with an explicit stop that hands the provider choice
back to the user.
