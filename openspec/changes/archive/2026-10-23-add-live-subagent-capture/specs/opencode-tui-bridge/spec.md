# Spec Delta

## MODIFIED Requirements

### Requirement: Render subagent-flagged frames in the session transcript
The bridge SHALL render frames the child flags with `parent_tool_use_id` —
subagent turns flowing through the parent run's stream — inline in the owning
session's transcript: their parts emit as `session.reasoning.*`,
`session.text.*`, and `session.tool.*` frames in arrival order, under the
turn's assistant message id and continuing the turn's part ordinals, and their
`tool_result` parts map by tool id to `session.tool.success` or
`session.tool.failed`. Subagent frames SHALL neither close nor restart the
turn; the run's single terminal `result` frame ends it.

The `parent_tool_use_id` wire shape this rendering depends on SHALL be
confirmed against a capture of a live subagent turn, not solely against a
fixture authored by reading the pinned Maki source; until such a capture
exists the row proving it carries the `contract-only` caveat.

#### Scenario: Subagent parts render inline, in arrival order
- **WHEN** the child emits `assistant` frames carrying `parent_tool_use_id`
  interleaved with unflagged parent frames within one run
- **THEN** the flagged parts emit in the same order into the session
  transcript, under the turn's assistant message id, with part ordinals
  continuing the turn's sequence rather than restarting it

#### Scenario: Nested tool results map by tool id
- **WHEN** a `user` frame carrying `parent_tool_use_id` holds a
  `tool_result` for a subagent's tool call
- **THEN** the bridge emits `session.tool.success` or `session.tool.failed`
  keyed by that tool id, distinguishable from the parent turn's tool results

#### Scenario: The run's single result closes the turn
- **WHEN** the terminal `result` frame arrives after interleaved parent and
  subagent frames
- **THEN** exactly one `session.step.ended` and one
  `session.execution.succeeded` follow, and no subagent frame emitted before
  it ends the turn early

#### Scenario: The nesting shape is observed, not inferred
- **WHEN** a live Maki subagent turn is captured and compared with the
  fixture the golden projects
- **THEN** the captured frames carry `parent_tool_use_id` where the pinned
  source says they do, and the provenance record for that fixture says
  `captured` — or the comparison records where the real shape differs and the
  golden follows the capture rather than the reading of the source
