# Maki SDK wire features (v0.6.4)

The Maki side of the cross-map. Source of truth: `src/sdk_mode.rs` at tag
`v0.6.4` (the version pinned in `examples/maki-image/Dockerfile`), plus the
recorded fixtures in `bridge/test/fixtures/`. Line references are to that
tag.

## Outbound wire types (maki → bridge)

| # | Type | Shape / subtypes | Fixture evidence |
| --- | --- | --- | --- |
| 1 | `system` | `subtype: "init"` with `cwd`, `tools` (Claude-cased names), `model` (`startup_model.id`), `permissionMode`, `apiKeySource`, `mcp_servers`, `slash_commands`, `output_style`, `session_id` (L615) | `maki-plain.jsonl` |
| 2 | `system` | `subtype: "api_retry"` with `attempt`, `retry_delay_ms`, `error` (L1081) | none yet — no retry observed in fixtures |
| 3 | `assistant` | message `{ id, model, role, content[thinking\|text\|tool_use], stop_reason, usage }` plus **`parent_tool_use_id`** for subagent turns; tool names mapped to Claude casing (L1105–L1120) | `maki-tool.jsonl` |
| 4 | `user` | tool_result content carrier, also carries `parent_tool_use_id` (L1116) | `maki-tool.jsonl` |
| 5 | `stream_event` | Anthropic-style deltas (`content_block_*`, `message_*`, `text_delta`, `thinking_delta`, `input_json_delta`); emitted **only** with `--include-partial-messages`, incl. a `finish_message` flush on turn end (L974, L1090) | none — fixtures are buffered-path only |
| 6 | `result` | `subtype: "success" \| "error" \| "error_during_execution"`, `usage`, `total_cost_usd`, `duration_ms`, `session_id`, `permission_denial` (L436, L998) | `maki-plain.jsonl` |
| 7 | `control_request` | outbound subtype **`can_use_tool` only** (`tool_name`, `input`, `tool_use_id`); maki blocks the tool until `control_response` (L1155) | `maki-permission.jsonl` |

## Inbound wire types (bridge → maki)

| # | Type | Behavior | Bridge coverage today |
| --- | --- | --- | --- |
| 1 | `user` | prompt text; content also accepted as blocks; sending while the agent works **steers** the run (`AgentEvent::Steered`) | prompt only; steering never exercised |
| 2 | `control_request` | subtypes: `initialize` (hooks/agents payloads ignored, L827), `set_permission_mode`, `set_model` (resolves via model policy, L866), anything else → `unsupported` error response | **not sent at all** — maki tolerates the absence (live smoke passed) |
| 3 | `control_response` | `{ request_id, behavior: "allow" \| "deny" }` (+ optional guidance); only these two behaviors are representable | implemented (permission round trip, verified) |
| 4 | `control_cancel_request` | cancels the in-flight run | **not implemented** — no interrupt path |

## Session/CLI surface relevant to the bridge

| Feature | Flag / mechanism | Bridge relevance |
| --- | --- | --- |
| SDK mode entry | `-p --input-format stream-json --output-format stream-json` | the child argv (`bridge/src/maki.ts`) |
| Model pin | `-m provider/id` | wired (`MAKI_MODEL` → child argv) |
| Session identity | `--session-id`, `--continue`, `--resume`, `--fork-session` | refused in OpenCode mode (helper-cli requirement); replay of history not emitted on the wire |
| Permission posture | `--permission-mode default\|acceptEdits\|plan\|bypassPermissions`, `--yolo` | default kept so `can_use_tool` fires (the TUI dialog) |
| Turn/output caps | `--max-turns`, `--verbose` | unused |
| Prompt replacement | `--system-prompt`, `--append-system-prompt` (SDK only) | unused |
| Partial streaming | `--include-partial-messages` | implemented in translator, never wire-verified (`stream-deltas` row) |
| Vision | `--image` (print mode) | not representable in the current prompt POST path |

## Scenario seeds taken from this inventory

- Q-A-Q-A ordering (defect `message-order-inversion`)
- status-line model identity from `system.init.model` / `assistant.model`
  (defect `synthesized-model-name`)
- `api_retry` system frame must be tolerated without disturbing the transcript
- mid-turn steering via inbound `user`
- interrupt via `control_cancel_request`
- mid-session model switch via inbound `control_request set_model`
- subagent turns flagged by `parent_tool_use_id`
