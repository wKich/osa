## MODIFIED Requirements

### Requirement: Render subagent-flagged frames in the session transcript
The bridge SHALL run a Maki `Task` call's subagent as a child session: a
session with the parent's id as `parentID`, the task's description as title,
and the task's subagent type as agent, announced with `session.created`,
whose turn starts with the task's prompt. Frames the child flags with the
task call's `parent_tool_use_id`, and stream events that arrive while the
task runs other than the task call's own streamed block, SHALL render in the
child session's transcript, not the parent's; the task's `tool_result` SHALL
end the child's turn, and the parent's task tool part SHALL carry the child's
id as `metadata.sessionID`. Subagent frames SHALL neither close nor restart
the parent's turn; the run's single terminal `result` frame ends it.
`GET /api/session` SHALL list a session's children for `parentID=<id>` and
the root sessions for `parentID=null`.

The `parent_tool_use_id` wire shape this rendering depends on SHALL be
confirmed against a capture of a live subagent turn, not solely against a
fixture authored by reading the pinned Maki source; until such a capture
exists the row proving it carries the `contract-only` caveat.

#### Scenario: A subagent opens as a child session
- **WHEN** the child calls `Task` and the subagent streams and then sends its
  reply flagged with the task's id
- **THEN** a child session titled with the task's description lists under the
  parent, its transcript holds the task's prompt and the reply, and the
  parent's transcript holds neither

#### Scenario: Subagent parts render inline, in arrival order
- **WHEN** the child emits `assistant` frames carrying `parent_tool_use_id`
  interleaved with unflagged parent frames within one run
- **THEN** the flagged parts render in arrival order inline in the child
  session's transcript, and the parent's parts keep their own order and
  ordinals

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
