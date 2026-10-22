# Shape comparison (task 3.3)

`bridge/test/fixtures/maki-subagent-live.jsonl` (captured) against
`bridge/test/fixtures/maki-subagent.jsonl` (authored from pinned
`sdk_mode.rs` v0.6.4). Only the `parent_tool_use_id` wire shape is compared;
message content differs by prompt and model.

## Frame-by-frame

| # | Authored (`maki-subagent`) | Live (`maki-subagent-live`) | Same wire shape |
| - | -------------------------- | --------------------------- | --------------- |
| 1 | `system` init, `apiKeySource: none` | `system` init, `apiKeySource: none` | yes |
| 2 | `assistant` unflagged: thinking + `tool_use` Bash | `assistant` unflagged: thinking + `tool_use` Task | yes |
| 3 | `assistant` flagged: text + `tool_use` Bash | `assistant` flagged: `tool_use` Bash | yes |
| 4 | `user` flagged: `tool_result` for the subagent's tool_use | `user` flagged: `tool_result` for the subagent's tool_use | yes |
| 5 | `user` unflagged: `tool_result` for the parent's tool_use | `assistant` flagged: subagent text | (live adds one) |
| 6 | `assistant` unflagged: thinking + text | `user` unflagged: `tool_result` for the parent's Task tool_use | yes, after the extra frame |
| 7 | `result` | `assistant` unflagged: text | yes, after the extra frame |
| 8 | — | `result` | yes |

## What agrees

- `parent_tool_use_id` is present on every subagent `assistant` frame and on
  the `user` frame carrying the subagent's `tool_result`; its value is the
  `tool_use` id of the parent's `Task` call (`chatcmpl-tool-b159c0d2b6ec01d5`).
- The parent's own `tool_result` (`tool_use_id` = the `Task` call) carries no
  `parent_tool_use_id` — exactly as the authored fixture pins it.
- Frame order matches: subagent frames arrive between the parent's `Task` call
  and the parent's `tool_result`, and a single terminal `result` ends the run.
- `session_id` and `uuid` ride on flagged and unflagged frames alike.

## What differs, and why it is not a shape disagreement

- The live subagent emits a final `assistant` text frame the authored fixture
  does not have (the authored subagent only calls a tool). Content-level, not
  `parent_tool_use_id`-level; the golden continues text ordinals across it
  (subagent text `ordinal 0`, parent text `ordinal 1`) as the spec requires.
- The live subagent frames carry no `thinking` part. The model chose not to
  emit reasoning for the small delegation; the authored fixture's thinking part
  is preserved for that path.

## Verdict

Agreement. The observed `parent_tool_use_id` shape is the shape the authored
fixture and the bridge assume, including the nested `tool_result` frame the
authored fixture covers. The `contract-only` caveat comes off
`subagent-nesting`; both fixtures stay in `FIXTURES` (the authored one keeps
the edges one live run does not reproduce).
