# Design

## Context

`allow-permission-once` (`bridge/test/journeys/allow-permission-once/diff.json`)
differs at `permission-prompt` and, live, never reaches `allowed`
(`bridge/test/journeys/evidence/pilot-live.md`).

## Decisions

1. **Permission action is the TUI's tool vocabulary.** The pinned TUI maps
   `bash` → `shell` and `task` → `subagent` (`tui/src/util/tool-display.ts`
   v2.0.32 L1–L6) and hides the title line only for the literal `shell`
   action (`routes/session/permission.tsx` L206). The bridge therefore sends
   the canonical name, not the Claude-style name Maki puts on the wire
   (`sdk_mode.rs` v0.6.4 L43–L60). The dialog reads the input from the tool
   part named by `source` (L122–L131), so the tool part must exist before the
   ask, which the pinned child guarantees.
2. **`save` mirrors Maki's session scope.** Maki applies an `AllowSession`
   answer to the generalized scope of each segment (`permissions.rs` v0.6.4
   L670–L692, L1047–L1059): `<first word> *` when the first word names one
   program, otherwise the literal segment. The bridge applies the same rule
   to the single command it sees, so "Always allow" names what Maki will
   actually allow. Non-shell tools keep the tool name.
3. **`executed: false`.** OpenCode sets `executed` from `providerExecuted`
   (`core/src/session/runner/publish-llm-event.ts` v2.0.32 L391, L632); a
   Maki tool always runs locally in the child.
4. **Scripted child fidelity.** In journey script mode the fake emits the
   buffered `assistant` tool_use, then the streamed tool_use block, then
   `can_use_tool` — the pinned order — and a silent successful command
   answers `Exit code: 0` (`plugins/bash/init.lua` v0.6.4 L412).
5. **Remaining difference.** OpenCode's shell prints `(no output)` for a
   silent command (`core/src/shell.ts` v2.0.32 L249); Maki returns
   `Exit code: 0`. The TUI renders each tool's own result, so the Maki screen
   is correct; it is recorded as an accepted difference only if it is the
   sole difference left at `allowed`.

## Risks

The bridge now also sees a streamed tool_use block after the buffered one;
the translator must not add a second tool part for the same id.
