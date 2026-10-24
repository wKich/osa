# Proposal

## Why

`see-file-edit-diff` showed `← Edit notes.txt` on the Maki side with no line
diff, where the reference shows `1 - alpha` / `1 + beta`. The TUI renders an
edit from the tool's `metadata.files[].patch` (`tui/src/routes/session/
index.tsx` v2.0.32 L3279–L3330). Maki computes its own before/after
(`plugins/edit/init.lua` v0.6.4 L224–L230), but the pinned SDK drops it with
the `ToolDone` event (`src/sdk_mode.rs` L1052–L1054). Only the summary
reaches the wire.

## What Changes

- `bridge/src/edit-diff.ts`: undo the one replacement of a successful `Edit`.
  It reads the edited file back from the sandbox and requires `new_string`
  to occur there exactly once. It then builds the unified patch in the shape
  OpenCode's edit tool reports (core `tool/plugin/file-diff.ts` v2.0.32
  L4–L22): byte-identical to jsdiff `createTwoFilesPatch` for a contiguous
  change, with addition and deletion counts.
- The bridge handles each session's Maki frames in order through one chain,
  so the edit result waits for its read and nothing overtakes it. The
  child's exit is handled after its frames.
- The scripted child applies a scripted `edit`, as Maki's tool does.
- Feature `edit-diff`. `see-file-edit-diff`: recorded, `parity` offline and
  live.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the edit-diff requirement.

## Impact

`bridge/src/{bridge,translator,edit-diff}.ts`, `bridge/test/{edit-diff.test,fake-maki}.ts`,
catalog rows. One sandbox read per successful edit, with no `--env` value.
