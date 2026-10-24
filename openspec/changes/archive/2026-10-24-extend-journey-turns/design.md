# Design

## Pinned shapes the scripted child follows

- Cancelled stream: deltas were emitted, `TurnComplete` never fires, and the
  run ends with an `error_during_execution` result
  (`maki-agent/src/agent/run.rs` v0.6.4 L560–L571; `sdk_mode.rs` L1162–L1178).
- Tool call: buffered `assistant` tool_use, then the streamed tool_use block,
  then `can_use_tool` when asked (run.rs L605–L608; sdk_mode.rs L1037–L1052,
  L1115–L1149), names spelled Claude-style (sdk_mode.rs L43–L60).
- Provider failure: `API error ({status}): {message}`
  (`maki-providers/src/error.rs` L106); 429 and 5xx are retryable (L2) and
  surface as `system`/`api_retry` (sdk_mode.rs L1076–L1089); others end the
  run with the failed result.

The `call` turn carries Maki's tool result text because the scripted child
cannot run Maki's tools; the live run executes the real tool, so a wrong
scripted result shows up as a live verdict worse than offline.

## Update check

`OPENCODE_DISABLE_AUTOUPDATE` is read by the CLI before any policy
(`updater.ts` L533–L541). Setting it in the shared harness environment keeps
both sides identical and the reference's only network peer the loopback
provider. It is the harness's own switch, not a host variable: the isolation
test still rejects every host `OPENCODE_*` variable.
