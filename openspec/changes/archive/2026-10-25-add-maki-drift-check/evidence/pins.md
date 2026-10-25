# Pin rows: closing Maki version or upstream issue draft (2026-10-25)

`make maki-drift`: pinned v0.6.4, latest release v0.6.5; `src/sdk_mode.rs`,
`src/cli.rs` and `maki-agent/src/mcp/protocol.rs` unchanged v0.6.4 → v0.6.5,
and every other file a pin citation names is unchanged too, except
`maki-ui/src/app/mod.rs` (a `SessionCwdChanged` plugin event, no SDK effect).
No pin row closes in v0.6.5, so each has an issue draft. Nothing is posted.

| Pin row | Closing Maki version | Draft |
| --- | --- | --- |
| feature session-compaction | none through v0.6.5 (cited files unchanged) | [issues/sdk-compaction.md](issues/sdk-compaction.md) |
| journey compact-session | none through v0.6.5 (cited files unchanged) | [issues/sdk-compaction.md](issues/sdk-compaction.md) |
| feature session-revert | none through v0.6.5 (cited files unchanged) | [issues/sdk-rewind.md](issues/sdk-rewind.md) |
| journey undo-previous-message | none through v0.6.5 (cited files unchanged) | [issues/sdk-rewind.md](issues/sdk-rewind.md) |
| journey redo-reverted-message | none through v0.6.5 (cited files unchanged) | [issues/sdk-rewind.md](issues/sdk-rewind.md) |
| feature session-fork-at-message | none through v0.6.5 (cited files unchanged) | [issues/sdk-rewind.md](issues/sdk-rewind.md) |
| feature tool-background | none through v0.6.5 (cited files unchanged) | [issues/sdk-background-tool.md](issues/sdk-background-tool.md) |
| journey background-blocking-tools | none through v0.6.5 (cited files unchanged) | [issues/sdk-background-tool.md](issues/sdk-background-tool.md) |
| feature permission-reask | none through v0.6.5 (cited files unchanged) | [issues/sdk-persistent-permission.md](issues/sdk-persistent-permission.md) |
| feature agent-questions | none through v0.6.5 (cited files unchanged) | [issues/sdk-question.md](issues/sdk-question.md) |
| journey answer-agent-question | none through v0.6.5 (cited files unchanged) | [issues/sdk-question.md](issues/sdk-question.md) |
| feature subagent-permissions | none through v0.6.5 (cited files unchanged) | [issues/sdk-subagent-answers.md](issues/sdk-subagent-answers.md) |
| journey reject-permission-with-reason | none through v0.6.5 (cited files unchanged) | [issues/sdk-subagent-answers.md](issues/sdk-subagent-answers.md) |
| feature model-variants | none through v0.6.5 (cited files unchanged) | [issues/sdk-effort.md](issues/sdk-effort.md) |
| journey switch-model-variant | none through v0.6.5 (cited files unchanged) | [issues/sdk-effort.md](issues/sdk-effort.md) |
| feature mid-turn-steering | none through v0.6.5 (cited files unchanged) | [issues/sdk-steer.md](issues/sdk-steer.md) |
| feature prompt-attachments | none through v0.6.5 (cited files unchanged) | [issues/sdk-file-attachments.md](issues/sdk-file-attachments.md) |
| feature mcp-toggle | none through v0.6.5 (cited files unchanged) | [issues/sdk-mcp-control.md](issues/sdk-mcp-control.md) |
| route POST /api/experimental/mcp/{server}/connect | none through v0.6.5 (cited files unchanged) | [issues/sdk-mcp-control.md](issues/sdk-mcp-control.md) |
| route POST /api/experimental/mcp/{server}/disconnect | none through v0.6.5 (cited files unchanged) | [issues/sdk-mcp-control.md](issues/sdk-mcp-control.md) |
| journey manage-mcp-servers | none through v0.6.5 (cited files unchanged) | [issues/sdk-mcp-control.md](issues/sdk-mcp-control.md) |
| feature mcp-forms | none through v0.6.5 (cited files unchanged) | [issues/mcp-elicitation.md](issues/mcp-elicitation.md) |
| journey answer-mcp-form | none through v0.6.5 (cited files unchanged) | [issues/mcp-elicitation.md](issues/mcp-elicitation.md) |
| feature slash-commands | none through v0.6.5 (cited files unchanged) | [issues/sdk-slash-commands.md](issues/sdk-slash-commands.md) |
