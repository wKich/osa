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

#### Scenario: Server info names the bridge and offers no terminal
- **WHEN** the TUI reads `GET /api/info`
- **THEN** the body is schema-valid, reports the pinned version, the bridge's
  own pid and a parseable listen URL, and `capabilities.persistentPty: false`,
  so the TUI offers no persistent terminal the bridge cannot serve

#### Scenario: Boot lists carry no fabricated rows
- **WHEN** the TUI reads the plugin, reference, shell, command, MCP server,
  or MCP resource lists, or a session's persistent terminal list, and nothing
  backs that surface in the bridge
- **THEN** each answers a schema-valid body with an empty list, and the agent
  list holds exactly one primary agent, `build`, with no synthesized
  permission rule

### Requirement: Maintain one Maki session behind one OpenCode session
The bridge SHALL run one Maki SDK session per OpenCode session — Maki running
inside the project sandbox, reached over `openshell sandbox exec` stdio — and
SHALL mint and map OpenCode-shaped ids (`ses_`, `msg_`, `per_`, `evt_`) to and
from Maki's ids. Concurrent sessions SHALL stay independent: a frame belongs
to the session whose child produced it, an admitted prompt appears only in its
own session's transcript, and each session's child is created and torn down
with that session alone.

#### Scenario: Session lifecycle maps one-to-one
- **WHEN** the TUI lists, reads, creates, or deletes a session
- **THEN** the bridge performs the corresponding operation on the Maki session
  it owns and returns ids that satisfy the OpenCode id patterns

#### Scenario: Minted ids are stable within a session
- **WHEN** the bridge emits multiple event frames for one turn
- **THEN** the assistant message id is the same minted `msg_` in every part
  event for that turn, and each frame carries a distinct `evt_` id

#### Scenario: Concurrent sessions do not share a transcript
- **WHEN** two sessions are open and both receive a prompt while both turns
  are in flight
- **THEN** each prompt is admitted exactly once under its own session id, each
  session's assistant output renders only under that session, and no emitted
  frame names a session the bridge does not know

#### Scenario: Deleting one session spares the others
- **WHEN** one of two open sessions is deleted
- **THEN** only that session's Maki child exits, that session reads back 404,
  and the other session's child stays alive and still runs its next turn

### Requirement: Translate the prompt into an OpenCode transcript
The bridge SHALL accept a prompt on the OpenCode prompt endpoint and emit SSE
event frames covering reasoning, text, tool, step, and execution boundaries as
Maki reports them, for both streamed and non-streamed Maki output. Streamed
parts SHALL be rendered from the child's `stream_event` frames as they arrive,
whether the delta variant is carried on the frame itself or nested in a
`content_block_delta` wrapper with its own `delta.type` (the captured wire
shape). The transcript SHALL be causally ordered: a frame representing the
user's prompt precedes every assistant frame the prompt caused, within a turn
and across turns.

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

#### Scenario: A failed turn reports the failure, not success
- **WHEN** the `result` frame carries the pinned error subtype
  `error_during_execution` (`is_error: true`, its `result` field carrying the
  failure message)
- **THEN** the turn's parts still render, `session.step.ended` carries
  `finish: "error"`, and `session.execution.failed` carries the wire's
  message — with no `session.execution.succeeded` for that turn

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
- **WHEN** a recorded Maki turn replays whose parts arrive as `stream_event`
  frames (`content_block_start`, then `content_block_delta` frames carrying
  `text_delta` / `thinking_delta` / `input_json_delta` on `event.delta.type`,
  then `content_block_stop`) followed by the buffered `assistant` message
  carrying the same parts
- **THEN** the projected transcript emits each part's `started`, one delta
  frame per streamed chunk, and `ended` carrying the full text — and the
  buffered message adds no duplicate part frames, with `message_*` frames
  emitting nothing

#### Scenario: The authored delta spelling still renders
- **WHEN** a fixture replays the same parts with the delta variant on the frame
  itself (`subtype`) and a flat `delta` string
- **THEN** the projected transcript emits the same started/delta/ended sequence,
  so neither accepted spelling depends on the other

#### Scenario: Deltas reach the stream through the shipped bridge
- **WHEN** a child that emits `stream_event` frames is run behind the bridge
  with the SDK flags the bridge passes
- **THEN** the SSE stream carries `session.text.delta` frames for the chunks
  before the buffered message, the buffered message adds no duplicate part
  frames, and removing the partial-message request from the child's flags
  fails this scenario

### Requirement: Fail an in-flight turn when the Maki child exits
The bridge SHALL end a turn that is in flight when its Maki child process
exits unexpectedly — crash, kill, or exit without a `result` frame — by
emitting `session.execution.failed` with the error shape
`{type: "Error", message}`, the message identifying the child's exit, and
SHALL NOT emit `session.execution.succeeded` for that turn. Parts already
emitted for the turn SHALL remain in the transcript. A prompt submitted to a
session whose child has exited SHALL be refused with a 503
service-unavailable answer and SHALL NOT open a new turn or write to the dead
child.

#### Scenario: Child exit fails the in-flight turn
- **WHEN** the Maki child emits assistant output and then exits without a
  `result` frame
- **THEN** the assistant parts already emitted remain in the transcript, the
  turn ends with exactly one `session.execution.failed` whose
  `error.type` is `Error` and whose message identifies the child's exit, and
  no `session.execution.succeeded` follows for that turn

#### Scenario: A prompt to a dead child fails closed
- **WHEN** a prompt is submitted to a session whose Maki child has already
  exited
- **THEN** the bridge answers 503 with a service-unavailable error and emits
  no `session.execution.started` for the rejected prompt

### Requirement: Tolerate recorded Maki wire frames with no OpenCode counterpart
The bridge SHALL consume outbound Maki frames it cannot render without
disturbing the in-progress turn: frames with no OpenCode representation SHALL
leave the emitted transcript identical to the same turn replayed without them.
A `system{subtype:"api_retry"}` frame with `attempt`, `retry_delay_ms`, and
`error` (Maki SDK wire v0.6.4) has a pinned OpenCode counterpart and SHALL be
surfaced as one durable `session.retry.scheduled` event carrying the turn's
`assistantMessageID`, the frame's positive `attempt`, an epoch-millisecond
`at`, and the frame's error as `{type, message}`. Retry frames MUST NOT open,
close, or reorder the turn: they add no part frames, the turn still ends with
its single `session.execution.succeeded`, and every frame around them keeps
its order.

#### Scenario: A mid-turn api_retry surfaces as session.retry.scheduled
- **WHEN** a recorded Maki fixture replays a plain turn with two
  `system{subtype:"api_retry"}` frames interleaved between its assistant and
  result frames
- **THEN** exactly two `session.retry.scheduled` events are emitted, in
  arrival order and before the result, each carrying the turn's assistant
  message id, the frame's `attempt`, a non-negative `at`, the frame's error
  message with type `Error`, and a durable envelope aggregated on the session

#### Scenario: A mid-turn api_retry leaves the transcript undisturbed
- **WHEN** the projected frame sequence for that fixture is compared with the
  committed plain-turn golden after excluding `session.retry.scheduled`
- **THEN** the two sequences match exactly — no extra, dropped, or reordered
  part frames — and the turn still ends in `session.execution.succeeded`

#### Scenario: A frame with no representation leaves no event
- **WHEN** a recorded fixture carries outbound frames the bridge does not
  render, such as `driver.exit` and `control_response`
- **THEN** no event frame is emitted for them and the committed golden for
  that fixture still matches

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
(`-p --input-format stream-json --output-format stream-json
--include-partial-messages`), and the configured model, over a stdin/stdout
pipe that stays open for the session's lifetime. The child SHALL be asked for
partial output so streamed turns reach the transcript incrementally rather
than only at completion. The exec invocation MUST NOT pass any `--env` value.
The Maki child command SHALL be overridable through one environment variable
so a scripted process can replace it. The bridge SHALL listen on loopback only
by default; binding to any other address SHALL require a configured password
and print a warning. Bridge logs MUST NOT contain credential material.

#### Scenario: Exec carries no environment values
- **WHEN** the bridge starts a Maki child for a session
- **THEN** the recorded `openshell sandbox exec` argv contains
  `--input-format stream-json`, `--output-format stream-json`,
  `--include-partial-messages`, `--no-login-shell` and the workdir, and
  contains no `--env` flag

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

#### Scenario: Sandbox state is read through the same exec transport
- **WHEN** a route answers from sandbox state — the TUI lists its directory
  through `GET /api/fs/list`
- **THEN** the bridge runs a read-only `openshell sandbox exec -n <sandbox>
  --no-login-shell --workdir <workdir> -- …` with no `--env` value, answers
  with the sandbox workdir's entries under the directory the client named,
  lists nothing for a path outside that directory, reads no host directory,
  and answers an empty list when no sandbox is configured

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

Every route and feature row in the status file SHALL carry a `scope` (`reachable|out-of-scope`)
and a `blockedBy` (`pin|none`). `reachable` means a route is measured in the
committed request captures or served live, and a capability is on the
translation surface for the pin;
`out-of-scope` means the pinned upstream has no counterpart or the repository
has decided not to serve it. Reachability SHALL be derived from the committed
request captures rather than assumed from the contract, and a route present in
a capture SHALL NOT be reported `out-of-scope`. `blockedBy: pin` marks a row
whose remaining gap cannot be closed without an upstream wire change.

The report SHALL render a burndown over the reachable surface before the full
tables: reachable route counts by status, reachable feature counts split by
`blockedBy`, the number of open defect-inventory entries, up to three
reachable feature rows that are neither `verified`, nor `blockedBy: pin`, nor
`out-of-scope`, the number of untriaged reachable routes, and up to three of
them. The full route and feature tables SHALL remain in the report so every
row stays auditable.

Every reachable `served-faked` route SHALL either carry a triage decision or be
counted as untriaged. A route row MAY carry a `feature` naming an existing
feature row that makes the route real or records why it cannot be, or a
`fakeReason` stating why synthesized data is correct by design, but not both.
A `fakeReason` SHALL appear only on a `served-faked` route. A route whose
linked feature is `verified` and not `blockedBy: pin` SHALL be `served-live`.
A reachable `served-faked` route with neither field, or whose linked feature
is neither `verified` nor `blockedBy: pin`, is untriaged. Untriaged routes are
a work queue reported by the burndown; a malformed triage field fails the
offline suite. The report SHALL show each reachable route's decision: live
through its feature, deferred, accepted with its reason, pin-blocked through
its feature, in progress through its feature, or untriaged. A `served-live`
route SHALL be `reachable`.

The route lens SHALL be enumerated from the pinned OpenAPI contract rather
than sampled from observed traffic: every operation the pinned contract
defines for the served API surface SHALL carry exactly one row, whatever the
bridge does with it, so a route the bridge neither implements nor answers
truthfully is reported rather than absent. A row SHALL NOT name a route the
pinned contract does not define. Each enumerated row's evidence SHALL be a
committed artifact that exists in the repository — the pinned contract itself,
or the bridge source that answers the route — so the row is auditable without
re-deriving it.

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

#### Scenario: The route lens is complete against the pin
- **WHEN** every operation the pinned OpenAPI defines for the served API
  surface is compared with the route rows in the status file
- **THEN** each pinned operation has exactly one row, and every row's route
  appears in the pinned contract

#### Scenario: A row is auditable without re-deriving it
- **WHEN** a maintainer reads an enumerated route row
- **THEN** its evidence resolves to a committed file — the pinned contract or
  the bridge source that answers the route — rather than to a measurement that
  would have to be repeated

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

#### Scenario: Every row declares its scope and blocker
- **WHEN** the status file is read
- **THEN** every route and feature row has a `scope` of `reachable` or
  `out-of-scope` and a `blockedBy` of `pin` or `none`, and a row with neither
  fails the offline suite

#### Scenario: A measured route is never out of scope
- **WHEN** a route appears in a committed TUI or bridge request capture
- **THEN** its status row reports `scope: reachable`, and a captured route
  with no row or an `out-of-scope` row fails the offline suite

#### Scenario: The burndown reports the reachable surface
- **WHEN** the report is regenerated
- **THEN** it lists reachable route counts by status, reachable feature counts
  split by `blockedBy`, the open defect count, and up to three next items, none
  of which is `verified`, `blockedBy: pin`, or `out-of-scope`

#### Scenario: Out-of-scope rows leave the denominator
- **WHEN** a route or feature is marked `out-of-scope`
- **THEN** it stays listed with its status and evidence but is excluded from
  the burndown counts and from the next-item list

#### Scenario: An untriaged reachable fake is counted, not hidden
- **WHEN** a reachable `served-faked` route has neither a `feature` nor a
  `fakeReason`
- **THEN** the burndown counts it as untriaged and may list it as a next
  route, and the route table shows it as untriaged

#### Scenario: An accepted fake carries its reason
- **WHEN** a reachable route is served faked by design (for example, the
  server info that must report the pinned version)
- **THEN** its row carries a `fakeReason`, the route table shows the reason,
  and the route leaves the untriaged count

#### Scenario: A malformed triage field fails the offline suite
- **WHEN** a route row names a `feature` that has no feature row, carries
  both `feature` and `fakeReason`, or carries a `fakeReason` while not
  `served-faked`
- **THEN** the offline suite fails and names the row

#### Scenario: A verified feature makes its route live
- **WHEN** a route's linked feature is `verified` and not `blockedBy: pin`
- **THEN** the route is `served-live`, and a row left `served-faked` or
  `deferred` fails the offline suite

#### Scenario: A live route is never out of scope
- **WHEN** a route row is `served-live`
- **THEN** its `scope` is `reachable`, and an `out-of-scope` live row fails
  the offline suite

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

The same loop SHALL diff its recorded matrices against the pinned upstream
contract and source, and SHALL treat as a finding any matrix row whose route
or capability the pinned upstream does not define, not only rows that are
missing or that contradict a later status flip.

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

#### Scenario: A matrix row naming an absent upstream route is a finding
- **WHEN** the discovery diff compares a recorded route row against the pinned
  contract and finds no such route at the pin
- **THEN** the row is reported as a finding for removal or correction, and a
  row is not left standing merely because no test references it

### Requirement: Keep the child's wire envelope from rebinding the session
Maki wraps every outbound message in a per-message envelope: the variant's
fields plus a top-level `session_id` (`SessionRef`) and a hyphenated UUIDv7
`uuid` (Maki SDK wire v0.6.4). The bridge SHALL accept that envelope on the
frame types it consumes and SHALL continue to address the OpenCode session it
minted for the child: the envelope's `session_id` is transport metadata and
MUST NOT replace or reroute the minted `ses_` id. The bridge MAY record the
id announced on `system.init`, but a frame SHALL NOT be attributed to a
different OpenCode session because of it.

#### Scenario: Captured frames carry the per-message envelope
- **WHEN** the captured Maki fixtures are read
- **THEN** every outbound frame carries a non-empty top-level `session_id` and
  a hyphenated UUID `uuid` beside its variant fields

#### Scenario: The child's envelope does not rebind the session
- **WHEN** a child announces a `session_id` different from the OpenCode
  session's minted `ses_` id and then emits a turn
- **THEN** every emitted event and every durable frame's aggregate stays under
  the minted `ses_` id, and no event adopts the child's id

### Requirement: Answer deferred session read surfaces without fabricating rows
The bridge SHALL answer the pinned session read routes it does not implement
from Maki — message history (`GET /api/session/{id}/message`), inbox
(`GET /api/session/{id}/inbox`), and forms (`GET /api/session/{id}/form`) —
with the pinned contract's success shape and an empty `data` list, so a
synthesized sample message, inbox item, or form never reaches the TUI as a
phantom transcript row. For a session id the bridge does not know, each route
SHALL answer `404` with `SessionNotFoundError` instead of an empty success.

#### Scenario: Deferred read surfaces stay empty
- **WHEN** the TUI reads a live session's message history, inbox, or forms
  through the bridge
- **THEN** each route answers `200` with a schema-valid body whose `data` list
  is empty, and the bridge emits no event frame for the read

#### Scenario: An unknown session is not an empty success
- **WHEN** the TUI reads message history, inbox, or forms for a session id the
  bridge does not know
- **THEN** each route answers `404` with `SessionNotFoundError` rather than a
  `200` empty list

### Requirement: Record mid-session agent selection without retasking the child
The bridge SHALL accept the OpenCode agent-selection route for an open session
and report the selected agent consistently: on the session object, on the
session list, and on the `agent` field of every `session.step.started` frame
emitted for that session after the selection. The bridge MUST answer `404`
`SessionNotFoundError` for an unknown session instead of recording a
selection. Because the pinned Maki wire exposes no inbound `set_agent`
subtype, the bridge MUST NOT claim to have re-tasked the child: the child
keeps the agent it started with, and no agent-control frame is sent as a
result of the selection.

#### Scenario: Selection is reported on the session and its next turn
- **WHEN** the TUI posts an agent to an open session and then submits a prompt
- **THEN** the route answers `204`, the session read and session list report
  the selected agent, and the next `session.step.started` carries that agent

#### Scenario: The child is not re-tasked
- **WHEN** an agent selection is recorded for an open session
- **THEN** the bridge sends the Maki child no agent-control frame and the
  transcript makes no claim that the running agent changed

#### Scenario: An unknown session is not a silent success
- **WHEN** the agent route names a session the bridge does not know
- **THEN** it answers `404` with `_tag: "SessionNotFoundError"` and records no
  selection

### Requirement: Forward an interrupt to the Maki child
The bridge SHALL answer `POST /api/session/{sessionID}/interrupt` for an open
session. When a turn is in flight, it MUST write one `control_request` with
subtype `interrupt` (the pinned Maki wire's cancellation message) to that
session's child and answer `200` with `interrupted` set to `true`. When no turn
is in flight, it MUST answer `200` with `interrupted` set to `false` and write
nothing to the child. A permission ask still pending when the interrupt arrives
MUST be answered `deny` before the interrupt is written and reported to the TUI
as `permission.replied` with reply `reject`. The interrupted turn's result
SHALL end the execution with `session.execution.interrupted` and reason
`user`, never `session.execution.succeeded` or `session.execution.failed`.
The bridge MUST answer `404` `SessionNotFoundError` for an unknown session.

#### Scenario: An idle session is a no-op
- **WHEN** the TUI interrupts a session with no turn in flight
- **THEN** the route answers `200` with `{interrupted:false}` and no frame is
  written to the child

#### Scenario: An in-flight turn is cancelled
- **WHEN** the TUI interrupts a session whose turn is still running
- **THEN** the route answers `200` with `{interrupted:true}`, the child
  receives exactly one `control_request` with subtype `interrupt`, and the turn
  ends with one `session.execution.interrupted` frame with reason `user` and
  neither a succeeded nor a failed execution frame

#### Scenario: A parked permission ask is settled first
- **WHEN** the TUI interrupts a turn that is waiting on a permission ask
- **THEN** the child receives a `deny` answer for that ask before the
  `interrupt` request, the TUI sees `permission.replied` with reply `reject`,
  and the session's pending permission list is empty

#### Scenario: The session keeps working
- **WHEN** a new prompt is sent after an interrupted turn
- **THEN** the turn runs to `session.execution.succeeded` and a later interrupt
  of the idle session answers `{interrupted:false}`

#### Scenario: An unknown session is not a silent success
- **WHEN** the interrupt route names a session the bridge does not know
- **THEN** it answers `404` with `_tag: "SessionNotFoundError"` and no frame is
  written to any child

### Requirement: Round-trip tool permissions in Maki's answer vocabulary
The bridge SHALL forward each Maki `can_use_tool` control request to the TUI as
a permission request, block that tool call until the TUI answers, and map the
TUI's reply onto the pinned Maki answer. Each answer SHALL be written to the
child exactly once per ask and SHALL name the `request_id` Maki sent. A reply
of `once` SHALL be a bare `allow`. A reply of `always` SHALL be an `allow`
carrying `updatedPermissions`, which Maki applies as a session-scoped rule; the
bridge SHALL NOT cache the decision itself. A reply of `reject` SHALL be a
`deny`, carrying the reply's `message` when it is a non-empty string. The
permission request SHALL list the tool name in `save`, the patterns the TUI
names under "Always allow". A reply whose decision is not `once`, `always`, or
`reject` SHALL fail closed: the bridge answers Maki with a bare `deny`, drops
the pending request, and answers the route 400.

#### Scenario: User allows one call
- **WHEN** Maki requests permission and the user answers "allow once"
- **THEN** the bridge answers Maki `behavior: allow` and the tool executes

#### Scenario: User rejects
- **WHEN** the user rejects the request
- **THEN** the bridge answers Maki `behavior: deny` and Maki reports the call
  as rejected

#### Scenario: Always becomes Maki's session rule
- **WHEN** the user answers "always"
- **THEN** the child receives `behavior: allow` with `updatedPermissions`, a
  later matching call in that Maki session is not asked again, and a gated call
  in another session still reaches the TUI

#### Scenario: A rejection reason reaches the model
- **WHEN** the user rejects with a non-empty `message`
- **THEN** the child receives `behavior: deny` with that `message`; an empty
  or null `message` leaves a bare `deny`

#### Scenario: An invalid reply fails closed
- **WHEN** the TUI replies to a pending permission request with a decision
  outside `once`/`always`/`reject`
- **THEN** the bridge answers Maki `behavior: deny`, answers the route 400,
  clears the pending request, and the target the tool would have touched stays
  untouched

#### Scenario: The wire answer names Maki's request
- **WHEN** the TUI answers a pending permission request
- **THEN** the child receives exactly one `control_response` named by the
  `request_id` Maki sent, with no field outside `request_id`, `behavior`,
  `updatedPermissions`, and `message`

### Requirement: Forward image attachments to the Maki child
The bridge SHALL translate each prompt `files[]` entry whose `uri` is a base64
`data:` URI of type `image/png`, `image/jpeg`, `image/gif`, or `image/webp`
into a Maki inbound image content block
(`{type:"image", source:{type:"base64", media_type, data}}`) after the prompt's
text block. The admitted prompt's `payload` and the `session.inbox.enqueued`
user item SHALL list exactly the forwarded files as inline
`Prompt.FileAttachment` entries (`data`, `mime`, `source:{type:"inline"}`, and
`name`/`description` when given), and SHALL carry only the text when nothing
was forwarded. Entries the pinned wire cannot carry (PDF and other `data:`
types, malformed base64) and `file://` URIs MUST NOT reach the child in any
form; the bridge MUST NOT read a host path named by a `file://` URI. An
unknown session SHALL answer `404` `SessionNotFoundError` and write no frame
to any child.

#### Scenario: An image attachment reaches the child
- **WHEN** the TUI submits a prompt with a `data:image/png;base64,…` entry in
  `files[]`
- **THEN** the child's `user` frame carries the text block followed by one
  base64 image block with media type `image/png` and the same data, and the
  admitted payload and inbox item list that file as an inline attachment

#### Scenario: Undeliverable attachments are dropped
- **WHEN** `files[]` also carries a PDF `data:` URI, a `file://` URI, an
  unsupported image type, or malformed base64
- **THEN** none of them appears in the child's frames or in the admitted
  payload, and no host file is read

#### Scenario: A prompt without attachments is unchanged
- **WHEN** a prompt carries no deliverable file
- **THEN** the admitted payload and inbox item carry only the text, and the
  child receives exactly one text content block

#### Scenario: An unknown session is not a silent success
- **WHEN** an attachment-bearing prompt names a session the bridge does not
  know
- **THEN** the route answers `404` with `_tag: "SessionNotFoundError"` and no
  frame is written to any child

### Requirement: Forward mid-session model selection to the Maki child
The bridge SHALL answer the OpenCode model-selection route for an open session
with `204` for a selection naming a provider and a model, and `400`
`InvalidRequestError` when either is missing, writing nothing to the child.
When the selection differs from the model the session currently reports, the
bridge MUST write one `control_request` with subtype `set_model` whose `model`
is `<providerID>/<id>`, or the bare `id` when the provider is `maki` (the
bridge's label for ids announced without a provider). Only the child's success
`control_response` SHALL change the model reported on the session object, on
the session list, and on later `session.step.started` frames, and the bridge
SHALL then emit `model.updated` for the session. A refused selection MUST leave
the reported model unchanged. Re-posting the model the session already reports
SHALL send nothing. The bridge MUST answer `404` `SessionNotFoundError` for an
unknown session and record no selection.

#### Scenario: A selection is forwarded and the acked model is reported
- **WHEN** the TUI posts a different model to an open session and the child
  acks `set_model` with success
- **THEN** the route answers `204`, the child received exactly one `set_model`
  naming `<providerID>/<id>`, `model.updated` is emitted, and the session read,
  the session list, and the next `session.step.started` report the new model

#### Scenario: A refused model is never claimed
- **WHEN** the child acks `set_model` with an error
- **THEN** the session keeps reporting the model it reported before, and no
  `model.updated` is emitted for the selection

#### Scenario: Re-posting the current model is not a switch
- **WHEN** the TUI posts the model the session already reports
- **THEN** the route answers `204` and no `set_model` reaches the child

#### Scenario: An unknown session is not a silent success
- **WHEN** the model route names a session the bridge does not know
- **THEN** it answers `404` with `_tag: "SessionNotFoundError"` and records no
  selection

### Requirement: Queue a prompt sent while a turn runs
The bridge SHALL admit a prompt posted while the session's turn is still
running and write it to the Maki child at once, but SHALL start its turn
(`session.execution.started` and `session.step.started` with a new assistant
message) only after the running turn's result, in admission order, preceded by
`session.inbox.delivered` for that item. Because the pinned Maki SDK answers
each stdin prompt in its own later run and offers no delivery into a running
one, a prompt requested with delivery `steer` MUST be reported as queued: the
`session.inbox.enqueued` item keeps the requested delivery, the bridge emits
`session.inbox.delivery.changed` with delivery `queue`, and the route's
admitted item carries delivery `queue`. A prompt requested with `queue`
SHALL emit no delivery change. A prompt on an idle session SHALL start its
turn at once with its requested delivery and no `session.inbox.delivered`.
When the child exits with a turn in flight, every prompt still queued behind
it SHALL be reported with `session.inbox.cancelled` and SHALL NOT start a
turn.

#### Scenario: A steer prompt mid-turn is queued
- **WHEN** the TUI posts a `steer` prompt while a turn runs
- **THEN** the route answers `200` with delivery `queue`, the bridge emits
  `session.inbox.delivery.changed` with delivery `queue`, and no second
  `session.execution.started` appears before the running turn succeeds

#### Scenario: The queued turn runs next with its own message
- **WHEN** the running turn's result arrives
- **THEN** the bridge emits `session.inbox.delivered` for the queued item,
  then the queued turn's `session.execution.started` and
  `session.step.started`, and the queued turn's parts carry a different
  assistant message id from the first turn's

#### Scenario: A prompt on an idle session is unchanged
- **WHEN** the TUI posts a prompt with no turn running
- **THEN** the turn starts at once with the requested delivery and no
  delivery change or delivered frame is emitted

#### Scenario: A queued prompt is cancelled when the child dies
- **WHEN** the child exits while a turn runs and a prompt is queued behind it
- **THEN** the running turn fails, the queued item gets one
  `session.inbox.cancelled`, and no turn starts for it

### Requirement: Answer workspace routes from the sandbox checkout
The bridge SHALL answer the branch and project routes the TUI reads at
boot — `GET /api/vcs`, `GET /api/project` and `GET /api/location` — from the
git state of the sandbox workdir, read over the sandbox exec transport. The
branch SHALL be read on every `GET /api/vcs`. The project id SHALL be the
repository's first root commit, or `global` when the workdir is not a
repository, and every answer that names a project, including session objects,
SHALL carry that same id.

#### Scenario: The footer branch is the sandbox branch
- **WHEN** the sandbox workdir has `feature/route-queue` checked out from a
  clone whose origin's default branch is `main`
- **THEN** `GET /api/vcs` answers `{provider: "git", branch: {current:
  "feature/route-queue", default: "main"}}`, and a later checkout in the
  sandbox shows on the next read

#### Scenario: One project id everywhere
- **WHEN** the TUI reads the project list and its location and creates a
  session in a repository workdir
- **THEN** each names the repository's root commit as the project id, and the
  project carries the workdir as `canonical`, its basename as `name` and
  `vcs: "git"`

#### Scenario: A workdir outside git
- **WHEN** the sandbox workdir is not a git repository
- **THEN** `GET /api/vcs` answers an empty `branch` object and the project id
  is `global` with no `vcs`

### Requirement: Report sessions with a turn in flight as active
The bridge SHALL answer `GET /api/session/active` with every session whose
Maki child has a turn in flight mapped to `{type: "running"}`, and with no
entry for an idle session. A reconnecting TUI SHALL then show a running
session busy, with its interrupt control.

#### Scenario: Running only while the turn runs
- **WHEN** one session has a prompt whose turn is still running and another
  session is idle
- **THEN** the active map holds only the running session as
  `{type: "running"}`, and after the turn's result the map is empty

### Requirement: List the sandbox's MCP servers with their observed state
The bridge SHALL answer `GET /api/mcp` with the MCP servers Maki would load in
the sandbox workdir: the `[mcp.<name>]` tables of the sandbox user's global
`maki/mcp.toml`, then the project's `.maki/mcp.toml`, with a project server
replacing a same-named global one. These SHALL be read over the sandbox exec
transport. Each server's status SHALL be:
- `disabled` when its config sets `enabled = false`;
- `connected` when a Maki child advertised a `<name>__…` tool on
  `system.init`;
- `pending` when no child has advertised its tools yet, or the child defers
  MCP tools behind `tool_search`;
- `failed` otherwise.

Without a sandbox or a config file, the list SHALL be empty.

#### Scenario: Configured servers before any child
- **WHEN** the sandbox config names servers and no session has started
- **THEN** each enabled server is listed `pending`

#### Scenario: Advertised tools decide the state
- **WHEN** a child advertised `context7__resolve-library-id` and
  `github__search`, the global config disables `github`, and the project
  config re-enables it and adds `local`
- **THEN** `context7` and `github` are `connected`, and `docs` and `local` are
  `failed` with an error naming the missing tools

#### Scenario: Disabled and deferred servers
- **WHEN** a server is disabled, and the child advertised `tool_search`
- **THEN** the disabled server is `disabled`, and enabled servers without an
  advertised tool are `pending` rather than `failed`

### Requirement: List the skills the Maki child discovers
The bridge SHALL answer `GET /api/skill` with the skills Maki's skill plugin
discovers in the sandbox, read over the sandbox exec transport. Each
`<dir>/<name>/SKILL.md` is read from these places, in this order:
1. the sandbox user's Maki config `skills` directory;
2. the home `.claude/skills`, `.config/opencode/skills` and `.agents/skills`;
3. the workdir and each ancestor up to the first one containing `.git`, using
   `.maki/skills`, `.claude/skills`, `.opencode/skills` and `.agents/skills`.

A later skill with the same name SHALL replace an earlier one. A skill with an
empty body SHALL be skipped. A skill without frontmatter SHALL be named after
its directory. Without a sandbox, the list SHALL be empty.

#### Scenario: Discovered skills with Maki's precedence
- **WHEN** the config dir and the repository root both define `release`, the
  home defines `review`, the workdir holds a frontmatter-less `plain-notes`
  and an empty `empty`, and a directory above the git root defines `outside`
- **THEN** the list is `plain-notes`, the repository's `release` and
  `review`, each with its absolute `SKILL.md` path, description and body, and
  neither `empty` nor `outside` appears
