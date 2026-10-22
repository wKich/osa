# opencode-tui-bridge Specification

## Purpose
Lets the OpenCode TUI render its compact transcript over a live Maki session
running inside the project's OpenShell sandbox by serving the OpenCode
HTTP+SSE contract and translating Maki's SDK stream into it, without forking
either upstream project.

## Requirements

### Requirement: Serve the OpenCode boot and config surface
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

### Requirement: Maintain one Maki session behind one OpenCode session
The bridge SHALL run one Maki SDK session per OpenCode session — Maki running
inside the project sandbox, reached over `openshell sandbox exec` stdio — and
SHALL mint and map OpenCode-shaped ids (`ses_`, `msg_`, `per_`, `evt_`) to and
from Maki's ids.

#### Scenario: Session lifecycle maps one-to-one
- **WHEN** the TUI lists, reads, creates, or deletes a session
- **THEN** the bridge performs the corresponding operation on the Maki session
  it owns and returns ids that satisfy the OpenCode id patterns

#### Scenario: Minted ids are stable within a session
- **WHEN** the bridge emits multiple event frames for one turn
- **THEN** the assistant message id is the same minted `msg_` in every part
  event for that turn, and each frame carries a distinct `evt_` id

### Requirement: Translate the prompt into an OpenCode transcript
The bridge SHALL accept a prompt on the OpenCode prompt endpoint and emit SSE
event frames covering reasoning, text, tool, step, and execution boundaries as
Maki reports them, for both streamed and non-streamed Maki output. The
transcript SHALL be causally ordered: a frame representing the user's prompt
precedes every assistant frame the prompt caused, within a turn and across
turns.

#### Scenario: Plain text turn renders
- **WHEN** the user submits a prompt and Maki returns an assistant text part
- **THEN** the bridge emits `session.text.started`, one or more
  `session.text.delta`, and `session.text.ended` carrying the full text

#### Scenario: Reasoning and tool parts render
- **WHEN** the assistant message carries thinking and tool_use parts
- **THEN** the bridge emits the corresponding `session.reasoning.*` and
  `session.tool.input.*`/`session.tool.called` frames, and maps each
  tool_result to `session.tool.success` or `session.tool.failed`

#### Scenario: Turn completion is reported
- **WHEN** Maki emits a `result` frame
- **THEN** the bridge emits the matching `session.step.ended` with usage and
  finish status, and `session.execution.succeeded` or `session.execution.failed`

#### Scenario: Event stream opens correctly
- **WHEN** the TUI connects to the event stream
- **THEN** the first frame is `server.connected` and subsequent frames follow
  the wire format the real server uses

#### Scenario: Prompt renders before its response
- **WHEN** the user submits a prompt and the session produces assistant
  output, across one or more turns
- **THEN** the emitted transcript places a user-role representation of each
  prompt before the assistant frames it caused, so the rendered conversation
  interleaves Q-A-Q-A instead of grouping all answers before all questions

#### Scenario: Streamed deltas render incrementally, once
- **WHEN** a recorded Maki fixture replays a turn whose parts arrive as
  `stream_event` frames (`content_block_start`/`*_delta`/`content_block_stop`
  in the sdk_mode-derived envelope) followed by the buffered `assistant`
  message carrying the same parts
- **THEN** the projected transcript emits each part's `started`, one delta
  frame per streamed chunk, and `ended` carrying the full text — and the
  buffered message adds no duplicate part frames, with `message_*` frames
  emitting nothing

### Requirement: Tolerate recorded Maki wire frames with no OpenCode counterpart
The bridge SHALL consume outbound Maki frames it has no OpenCode
representation for — first among them `system{subtype:"api_retry"}` with its
`attempt`, `retry_delay_ms`, and `error` fields (Maki SDK wire v0.6.4) —
without emitting any event frame for them and without disturbing the
in-progress turn: the emitted transcript SHALL be identical to the same turn
replayed without those frames.

#### Scenario: A mid-turn api_retry leaves the transcript undisturbed
- **WHEN** a recorded Maki fixture replays a plain turn with
  `system{subtype:"api_retry"}` frames interleaved between its assistant and
  result frames
- **THEN** the projected frame sequence matches the committed plain-turn
  golden exactly — no extra, dropped, or reordered frames, and the turn still
  ends in `session.execution.succeeded`

### Requirement: Render subagent-flagged frames in the session transcript
The bridge SHALL render frames the child flags with `parent_tool_use_id` —
subagent turns flowing through the parent run's stream — inline in the owning
session's transcript: their parts emit as `session.reasoning.*`,
`session.text.*`, and `session.tool.*` frames in arrival order, under the
turn's assistant message id and continuing the turn's part ordinals, and their
`tool_result` parts map by tool id to `session.tool.success` or
`session.tool.failed`. Subagent frames SHALL neither close nor restart the
turn; the run's single terminal `result` frame ends it.

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

### Requirement: Round-trip tool permissions
The bridge SHALL forward each Maki `can_use_tool` control request to the TUI as
a permission request, block that tool call until the TUI answers, and map the
TUI's reply onto Maki's `allow`/`deny` wire answer. A reply of `always` SHALL be
honored for that one call only; every later tool call re-prompts. A reply whose
decision is not `once`, `always`, or `reject` SHALL fail closed: the bridge
answers Maki `deny`, drops the pending request, and answers the route 400.

#### Scenario: User allows one call
- **WHEN** Maki requests permission and the user answers "allow once"
- **THEN** the bridge answers Maki `behavior: allow` and the tool executes

#### Scenario: User rejects
- **WHEN** the user rejects the request
- **THEN** the bridge answers Maki `behavior: deny` and Maki reports the call
  as rejected

#### Scenario: Always re-prompts the next call
- **WHEN** the user answers "always" and a later matching tool call requests
  permission
- **THEN** the bridge asks the TUI again rather than auto-allowing

#### Scenario: An invalid reply fails closed
- **WHEN** the TUI replies to a pending permission request with a decision
  outside `once`/`always`/`reject`
- **THEN** the bridge answers Maki `behavior: deny`, answers the route 400,
  clears the pending request, and the target the tool would have touched stays
  untouched

### Requirement: Follow the wire, not the schema, for SSE frames
The bridge SHALL emit event frames in the format the measured server uses — bare
`data:` frames with the event type inside the JSON envelope — rather than the
`event:` field the OpenAPI frame schema requires. The stream SHALL also carry
the measured server's `: heartbeat` comment more often than the client's idle
stall timeout (45 seconds in the pinned OpenCode 2.0.32 client), so a session
with no events keeps its connection instead of reconnecting mid-session.

#### Scenario: Frames match the measured wire
- **WHEN** the TUI consumes a bridge event stream
- **THEN** each frame is a bare `data:` frame the TUI accepts, and no frame is
  rejected for a missing `event:` line

#### Scenario: The stream survives an idle gap
- **WHEN** the TUI holds an event stream open while no session produces events
- **THEN** the bridge writes a `: heartbeat` comment inside the idle window, the
  comment is not delivered as an event frame, and the TUI does not reconnect
  and re-boot before the composer's next submit

### Requirement: Sandbox transport and host exposure
The bridge SHALL run Maki by spawning `openshell sandbox exec` for the project
sandbox with `--no-login-shell`, the configured workdir, Maki's SDK flags
(`-p --input-format stream-json --output-format stream-json`), and the
configured model, over a stdin/stdout pipe that stays open for the session's
lifetime. The exec invocation MUST NOT pass any `--env` value. The Maki child
command SHALL be overridable through one environment variable so a scripted
process can replace it. The bridge SHALL listen on loopback only by default;
binding to any other address SHALL require a configured password and print a
warning. Bridge logs MUST NOT contain credential material.

#### Scenario: Exec carries no environment values
- **WHEN** the bridge starts a Maki child for a session
- **THEN** the recorded `openshell sandbox exec` argv contains
  `--input-format stream-json`, `--output-format stream-json`, `--no-login-shell`
  and the workdir, and contains no `--env` flag

#### Scenario: A scripted child replaces the sandbox transport
- **WHEN** the Maki child override environment variable points at a scripted
  process that speaks the Maki SDK wire
- **THEN** the bridge drives that process exactly as it drives the sandbox
  child, with no other code path difference

#### Scenario: Default bind is loopback
- **WHEN** the bridge starts with no address configured
- **THEN** it listens only on `127.0.0.1` and the startup output states the URL

#### Scenario: Logs are free of credentials
- **WHEN** a full session has run with bridge logging enabled
- **THEN** the request, SSE, and stdout logs match a credential-pattern scan
  with no finding

### Requirement: Offline verification gate
The repository SHALL provide `make test-bridge`, which runs the bridge's test
suite with no Docker, no gateway, and no network: golden tests asserting the
translated OpenCode frames for recorded Maki SDK fixtures, contract tests
validating bridge response bodies against the vendored OpenAPI 2.0.32 schema
and the measured wire rules, and session API tests driving a full turn
(including a permission round trip) through the `MAKI_CHILD_CMD` seam with a
scripted child. `make test` SHALL remain the POSIX-shell stub suite.

#### Scenario: Suite passes without external services
- **WHEN** a maintainer runs `make test-bridge` on a host with `bun` but no
  running gateway, no Docker, and no network
- **THEN** every test passes and the command exits 0

#### Scenario: A translation regression fails the gate
- **WHEN** a recorded Maki fixture produces a frame sequence that differs from
  the committed golden output (for example, part events reordered)
- **THEN** the suite exits non-zero and names the fixture and the mismatching
  frames

#### Scenario: Contract and wire rules are enforced
- **WHEN** the suite runs against the bridge's emitted responses and SSE bytes
- **THEN** every validated body conforms to the vendored schema, the first SSE
  frame is `server.connected`, all frames are bare `data:` frames, and minted
  ids satisfy the OpenCode patterns

#### Scenario: The permission round trip runs offline
- **WHEN** the scripted child emits a `can_use_tool` control request during a
  session API test
- **THEN** the test answers it through the OpenCode permission endpoints,
  observes the `allow`/`deny` control_response on the child's stdin, and no
  real Maki process or sandbox is involved

### Requirement: Generated compatibility report
The repository SHALL keep `docs/compatibility.md` as a generated artifact with
three lenses: served routes with a status (served-live, served-faked,
deferred, unhandled), wire features with a status (verified, unverified,
degraded, buggy) and a link to the evidence or test that justifies it, and a
version matrix recording the pinned OpenCode version, Maki version, and
transport mode. The report SHALL be rendered by a script from a
machine-readable status file, and `make compat` SHALL regenerate it and exit
non-zero when the committed report differs from the regenerated output.

Where a feature row's evidence depends on a fixture that was authored from the
pinned upstream source rather than captured from a live run, the report SHALL
say so on that row, so a reader can tell a status proved against an observed
run from one proved against a reading of the pin. A feature row SHALL carry the
`contract-only` caveat when its evidence proves the bridge's translation
behavior but not the upstream wire shape that behavior was given.

#### Scenario: Regeneration is a no-op on a clean tree
- **WHEN** a maintainer runs `make compat` with statuses unchanged
- **THEN** the committed `docs/compatibility.md` matches the regenerated file
  and the command exits 0

#### Scenario: A status change fails the gate until the report is refreshed
- **WHEN** a test run flips a feature status (for example, a `buggy` entry
  whose fix now passes its golden test)
- **THEN** `make compat` exits non-zero, and committing the regenerated report
  makes it pass again

#### Scenario: Every row carries its evidence
- **WHEN** a maintainer reads any route or feature row in the report
- **THEN** the row links the capture, log, or test name that produced its
  status, and the version matrix names the pinned OpenCode and Maki versions
  and the sandbox transport

#### Scenario: An authored fixture is visible on the row it proves
- **WHEN** a feature row's evidence consumes a fixture authored from the pinned
  upstream source rather than captured from a live run
- **THEN** the row says the wire shape is source-derived, and a reader can
  distinguish it from a row proved against an observed run

#### Scenario: Contract-only evidence is marked on the row
- **WHEN** a feature's evidence proves the bridge's translation of a wire shape
  but no live run has exercised that shape upstream
- **THEN** the row carries the `contract-only` caveat rather than claiming
  unqualified verification

### Requirement: Contract drift gate
The repository SHALL provide a gated script that re-captures the OpenCode
`/openapi.json` from the installed binary, diffs it against the vendored
2.0.32 copy, and reports added or removed routes and schema changes together
with the installed OpenCode and Maki versions. The script SHALL skip with an
explicit message when the required binaries are absent, and MUST NOT be part
of `make test`.

#### Scenario: Drift is reported with the delta
- **WHEN** the gate runs on a host whose installed OpenCode serves a contract
  that differs from the vendored copy
- **THEN** the output lists the route and schema differences and exits
  non-zero so the mapping and report can be revisited

#### Scenario: Missing binaries skip cleanly
- **WHEN** the gate runs without `opencode` on `PATH`
- **THEN** it prints a skip message naming the missing binary and exits 0
  without touching the vendored copy

### Requirement: Defect inventory and discovery loop
The repository SHALL maintain a machine-checkable defect inventory for the
OpenCode TUI bridge, seeded from the archived `known-defects.md` entries
(message-order inversion and synthesized model name), and SHALL provide a
scripted discovery pass that runs repeatable explorational sessions against
the bridge and appends each newly observed rendering or protocol defect with
its capture reference and a status. Each inventory entry SHALL link the
evidence that reproduces it; fixing an entry belongs to a later change, which
flips its status.

The repository SHALL record, for every fixture the offline suite asserts
against, whether that fixture was captured from a live run or authored from
the pinned upstream source, and SHALL keep that record complete: a fixture
without a recorded provenance, or a recorded provenance naming a fixture that
no longer exists, fails the suite.

#### Scenario: The seed entries are present
- **WHEN** the inventory is read after this change lands
- **THEN** it contains both archived known defects with their capture
  references and a `known` status

#### Scenario: A discovery pass appends findings deterministically
- **WHEN** the scripted discovery pass runs and a session exhibits a rendering
  or protocol surprise not already listed
- **THEN** a new entry is appended with the session capture, and re-running
  without a new surprise adds nothing

#### Scenario: Inventory status feeds the report
- **WHEN** the compatibility report is generated
- **THEN** features with open inventory entries are reported as `buggy` with a
  link to the entry

#### Scenario: A fixture without provenance fails the suite
- **WHEN** a fixture is added to the offline suite without recording whether it
  was captured or authored, or a recorded provenance names a removed fixture
- **THEN** the suite fails and names the fixture, so the stronger claim is
  never the silent default

#### Scenario: A coverage change declares its fixture kind
- **WHEN** a later change adds a fixture to cover a recorded-but-uncovered row
- **THEN** it records that fixture's provenance in the same change, so the
  report can keep distinguishing observed evidence from authored shapes
