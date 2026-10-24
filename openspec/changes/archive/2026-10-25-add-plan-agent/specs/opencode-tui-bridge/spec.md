## REMOVED Requirements

### Requirement: Serve the OpenCode boot and config surface
**Reason**: Its server-info scenario still said the bridge offers no terminal
(`persistentPty: false`), stale since `add-sandbox-terminals`, and its agent
list scenario named one agent; Maki's plan mode is now an agent.
**Migration**: Replaced by "Serve the OpenCode boot, config, and agent
surface", which keeps every other scenario.

### Requirement: Record mid-session agent selection without retasking the child
**Reason**: Maki v0.6.4's `set_permission_mode` does switch the child to plan
mode for its next turn (`src/sdk_mode.rs` L77–L111, L688–L696, L846–L860), so
"the child is not re-tasked" was wrong.
**Migration**: Replaced by "Switch Maki's mode for the selected agent".

## ADDED Requirements

### Requirement: Serve the OpenCode boot, config, and agent surface
The bridge SHALL answer the OpenCode `2.0.32` boot and config reads the TUI
performs — `/api/info`, agent/model/config reads, and the session/worktree list
routes — with spec-valid, internally consistent payloads so the TUI reaches a
usable composer without a "session location unavailable" dialog. Model values
SHALL come from the Maki child when it has announced one (`system.init.model`,
`assistant.model`) rather than from synthesized defaults; synthesized values
are permitted only before any child announcement and only for models the
child has not named. Because the TUI reads the model list once at boot, before
any child exists, the bridge SHALL signal a model update when a child
announces, so the location list the TUI caches still names the model its
composer selects.

#### Scenario: TUI boots against the bridge
- **WHEN** the OpenCode TUI is started with `--server` pointed at the bridge
- **THEN** every route it calls during boot is answered with a 2xx and a
  schema-valid body, and none returns an unhandled 404

#### Scenario: Location data is self-consistent
- **WHEN** the TUI reads session, project, and subpath location data
- **THEN** the project canonical equals the session directory, all paths are
  absolute, and `subpath` is empty, so the composer is not blocked

#### Scenario: Enum-bearing responses decode
- **WHEN** the TUI reads agent, model, or migration status enums
- **THEN** the primary agent is selectable (mode not `subagent`), migration
  status does not block submission, and no first-enum-value default prevents
  the user from sending a prompt

#### Scenario: Reported model is the child's model
- **WHEN** the Maki child announces `synthetic/fake` on `system.init` and the
  TUI renders a turn (status line, `session.step.started`, model list)
- **THEN** the reported provider and model id are the announced ones, and no
  route answers with a synthesized placeholder while a live child session
  exists

#### Scenario: The announced model stays selectable
- **WHEN** the child announces its model after the TUI has already read the
  model list, and the user submits another prompt
- **THEN** the bridge emits a location-scoped model update, the refetched
  model list names the announced provider and id, and the submit is not
  refused for an unavailable model

#### Scenario: Server info names the bridge and its terminals
- **WHEN** the TUI reads `GET /api/info`
- **THEN** the body is schema-valid, reports the pinned version, the bridge's
  own pid and a parseable listen URL, and `capabilities.persistentPty: true`
  exactly when a project sandbox exists to open terminals in

#### Scenario: Boot lists carry no fabricated rows
- **WHEN** the TUI reads the plugin, reference, shell, command, MCP server,
  or MCP resource lists, or a session's persistent terminal list, and nothing
  backs that surface in the bridge
- **THEN** each answers a schema-valid body with an empty list, and the agent
  list holds exactly Maki's two primary agents, `build` then `plan`, with no
  synthesized permission rule

### Requirement: Switch Maki's mode for the selected agent
The bridge SHALL offer Maki's build and plan modes as the agents `build` and
`plan`. A selection on an open session SHALL be written to that session's
Maki child as `set_permission_mode` — `plan` for `plan`, and for `build` the
mode the child reported on `system.init` — before the session's next prompt,
and SHALL be reported on the session object, the session list, every later
`session.step.started` frame, a durable `session.agent.selected` event, and
an `agent-switched` history row. A session created as `plan` SHALL start in
plan mode. An agent with no Maki mode SHALL be refused with
`InvalidRequestError`, and an unknown session with `404`
`SessionNotFoundError`; neither sends a control frame.

#### Scenario: Selection is reported on the session and its next turn
- **WHEN** the TUI posts `plan` to an open session and then submits a prompt
- **THEN** the route answers `204`, the child receives
  `set_permission_mode` `plan` before the prompt, and the session read, the
  session list and the next `session.step.started` report `plan`

#### Scenario: Build restores the starting mode
- **WHEN** the TUI posts `build` after `plan`
- **THEN** the child receives `set_permission_mode` with the mode it started
  in, and posting `build` again sends nothing

#### Scenario: An unknown session is not a silent success
- **WHEN** the agent route names a session the bridge does not know
- **THEN** it answers `404` with `_tag: "SessionNotFoundError"` and records no
  selection
