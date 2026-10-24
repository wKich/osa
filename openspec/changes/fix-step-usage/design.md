# Design

The pinned child emits, per model call, one buffered `assistant` frame with
that call's `usage` (TurnComplete), and per run one `result` whose `usage` is
the ledger total. OpenCode's step is one model call
(`core/src/session/runner/llm.ts` v2.0.32) and its `step.ended.tokens` is that
call's usage, which the TUI shows as context. The bridge keeps one step per
Maki run (its parts and the footer line already match), so the closest
faithful value is the last call's usage — the call whose context the counter
describes. A run with no usage-carrying assistant frame (an error before any
call) falls back to the result.
