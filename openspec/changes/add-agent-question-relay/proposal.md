# Proposal

## Why

When the agent asks the user a question, OpenCode shows a question dialog.
Under the bridge Maki's `question` tool runs with no UI and is dismissed
(`plugins/question/question_form.lua` v0.6.4 L598–L628), so
`answer-agent-question` diverges and `agent-questions` is `degraded`. A
`tool.question.input` layer that returns `{ ask = reason }` raises a permission
prompt, which reaches the bridge as `can_use_tool` (the bridge runs the default
permission mode). A deny that carries a `message` reaches the model as guidance
(`src/sdk_mode.rs` L918–L927).

## What Changes

- The `maki_bridge` plugin installs a `tool.question.input` layer. It returns
  `ask` with a marker reason naming the call as a question relay, and leaves the
  input unchanged.
- The bridge recognizes the marked `can_use_tool` for `question`. It emits
  OpenCode's question events (`question.asked`) with the tool input's questions
  and options, and does not show a permission prompt.
- When the user answers, the bridge replies `deny` with a `message` holding the
  answers in a fixed, model-readable form. Dismissing the dialog sends a deny
  saying the user declined to answer.
- The transcript shows the question call as answered, not failed. That is the
  one screen difference expected to need an accepted diff, with its reason
  recorded at review.
- `agent-questions` and `answer-agent-question` are re-triaged. They reach
  `parity`, or carry an accepted difference whose reason says why the Maki
  screen is correct.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `maki-bridge-plugin`: adds the question relay layer.
- `opencode-tui-bridge`: a marked question ask becomes an OpenCode question, and
  its answer returns as deny guidance.

## Impact

- Depends on `add-maki-bridge-plugin`. Uses no mailbox, since the
  permission-prompt channel carries the whole round trip.
- `bridge/src/` permission and question routes (`/api/question` family);
  `bridge/test/fake-maki.ts` emulates the marked ask; `answer-agent-question`
  journey; `statuses.json`.
- Risk: the model reads a denied call. The guidance text needs a check across
  the scripted provider and real Maki that the agent continues as if answered.
