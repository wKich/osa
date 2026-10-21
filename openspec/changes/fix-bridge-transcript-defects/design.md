# Design

## Context

Iteration 1 of the polish loop. Machinery from `add-bridge-verification` is
in place and was exercised this session: `bun bridge/test/discovery.ts`
ran offline against the current build — 5 scenarios, 3 clean, both inventory
defects deduped, 0 appended. Ground truth for the two-sided inventory was
pulled from primary sources this session: Maki v0.6.4 `src/sdk_mode.rs`
(outbound `system{init,api_retry}`, `assistant` with `model` and
`parent_tool_use_id`, `user` tool_result carrier, `stream_event` behind
`--include-partial-messages`, `result{success,error,error_during_execution}`,
outbound `control_request` of subtype `can_use_tool` only; inbound
`user` (steerable mid-turn), `control_request` with subtypes `initialize`,
`set_permission_mode`, `set_model`, `control_response{allow,deny}`,
`control_cancel_request`) and the vendored OpenAPI 2.0.32 (119 paths; the
archived route inventory shows the TUI measured 33 of them). See
`proposal.md` for why; requirements are in the delta spec.

## Goals / Non-Goals

Goals: a recorded, evidence-linked inventory of both protocol surfaces with
a coverage cross-map; the two open transcript defects fixed and closed; the
table regenerated so the loop's first full iteration is visible.

Non-goals: implementing anything else the cross-map reveals (interrupt,
mid-session model switch, steering, subagent nesting, message replay, …) —
those are recorded rows for later iterations; touching `bin/maki-oss` or the
sandbox transport; changing any requirement other than the two named.

## Decisions

1. **The user-message event shape is established from evidence, in order:**
   the archived real-service capture (`…/evidence/sse-events.jsonl` and
   `tui-run.typescript`), the vendored OpenAPI event schemas, then a gated
   live capture — never from assumption. The discovery scenario's
   expectation (`message.part.updated` with `data.message.role === "user"`)
   is a hypothesis until that chain confirms it; whichever shape is chosen
   gets recorded in `evidence/cross-map.md` with its source. *If the chain
   cannot confirm any shape, task 2.x records the gap and the defect stays
   open rather than shipping a guess.*

2. **The bridge owns the prompt representation, emitted at admission.** Maki
   does not echo plain user text back on the SDK wire (recorded in the
   mapping table), so the user frame is emitted synchronously in the prompt
   handler, before the child is written to — causal ordering within and
   across turns falls out of the single emit path, with no reliance on maki
   timing.

3. **Model identity has one source: the child.** `system.init.model` and
   each `assistant.model` update the session's model; the bridge answers
   `/api/model`, session state, and `session.step.started` from it. Parsing
   splits `provider/id` on the first `/`, falling back to
   `{ providerID: "maki", id: <raw> }` for ids without one (e.g.
   `syn:small:text`). Synthesis from the pinned spec survives only for the
   window before a live child has announced anything.

4. **Closures keep their history.** Fixed inventory entries flip to
   `status: "fixed"` with the expected-failure marker removed (never
   deleted); their goldens become positive assertions (renamed to what they
   assert, not what they tolerated). `bridge/test/discovery.ts` needs no
   change: its clean/known verdicts are observational, so after the fixes a
   rerun prints `ok` for both scenarios and appends nothing.

5. **The cross-map records, statuses decide.** New coverage rows land in
   `bridge/compat/statuses.json` as `unverified`/`deferred` with evidence
   keys pointing at this change's evidence files (the archive step rewrites
   those paths, as it did for the previous change); the two fixed rows flip
   to `verified` with their tests as evidence. Rows this iteration only
   discovered stay honest — recorded, not implemented — which is exactly
   what the report's statuses mean.

## Risks / Trade-offs

- [Wrong user-event shape guessed] → decision 1's evidence chain, plus the
  golden that asserts it; a wrong shape fails at the TUI smoke or the next
  discovery pass, not silently.
- [`syn:small:text`-style model ids render oddly] → the fallback rule keeps
  the raw id visible instead of hiding it behind a placeholder; a prettier
  mapping is a later iteration if it matters.
- [Prompt admission emission races streaming deltas] → both are emitted from
  the same bridge event loop before any assistant frame exists; the golden
  asserts the interleaving.
- [Statuses evidence links point into a change directory that will be
  archived] → same pattern as the previous iteration; the archive step
  rewrites the paths (called out in the wrap-up task).

## Migration Plan

Additive data plus two behavior fixes behind the existing tests. Rollback:
revert the commit; goldens and statuses return with it.

## Open Questions

None blocking. Deferred to later iterations (each already visible as a
cross-map row): interrupt/cancel round trip, `set_model` mid-session switch,
mid-turn steering, `stream_event` verification on a streaming provider,
subagent nesting via `parent_tool_use_id`, message replay for session
resume.
