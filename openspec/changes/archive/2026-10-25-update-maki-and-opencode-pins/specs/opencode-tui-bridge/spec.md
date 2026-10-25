# Spec Delta

## ADDED Requirements

### Requirement: Name tool parts in the TUI's rendering vocabulary

The bridge SHALL translate Maki wire tool names into the names the pinned
OpenCode TUI renders specially, while preserving the tool input unchanged.
In particular, Maki's `TodoWrite` and `todo_write` SHALL become `todowrite`,
`WebFetch` SHALL become `webfetch`, `WebSearch` SHALL become `websearch`, and
`CodeExecution` SHALL become `execute`; single-word names SHALL continue to
render in lower case. A `todowrite` part SHALL retain its `todos` input so the
TUI can render the list in the transcript and, at the pinned TUI version, in
the todo sidebar. Permission asks SHALL continue to name the tool as Maki named
it, so the answer reaches the child unchanged.

#### Scenario: A todo update renders in the chat and sidebar

- **WHEN** the Maki child emits a `TodoWrite` tool call carrying a non-empty
  `todos` array with `content` and `status` values
- **THEN** the transcript renders the todo list under the TUI's todo display,
  the sidebar lists the same items, and the permission ask, if any, still names
  the tool as Maki did

#### Scenario: A camel-cased tool gets its dedicated rendering

- **WHEN** the Maki child emits a `WebFetch`, `WebSearch`, or `CodeExecution`
  tool call
- **THEN** the transcript renders it with the TUI's `webfetch`, `websearch`, or
  `execute` display rather than the generic tool row
