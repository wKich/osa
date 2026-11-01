# Design

## Context

See `proposal.md` — Why.

State of the code that shapes this approach:

- `osa-core` already has a complete typed client (`gateway/sdk.rs`), discovery
  (`gateway/discover.rs`), a typed error set, and a fake gateway server crate
  whose binary prints `stub-gateway listening on http://<addr>` and reads
  `STUB_STATE_DIR` and `STUB_LOG` — the same two variables the shell stub
  `tests/stub/openshell` reads, over the same directory layout.
- `discover()` always shells out to `openshell gateway info --output json`; an
  explicit `--gateway`/`OPENSHELL_GATEWAY` value becomes `-g NAME` rather than
  short-circuiting the call. The shell stub already answers that command with a
  `server` field, currently hardcoded to `http://127.0.0.1:8080`.
- No command holds a `Gateway`. `Context` (`agent/context.rs`) exposes
  `gateway()` for the explicit name and nothing else.
- `commands::list` is one line: `ctx.run_gateway(&["sandbox", "list"])`, whose
  stdio is inherited, so the gateway's own output is the user-visible output.
- The conformance case `test_status_list_logs` asserts `assert_log_has "list"`,
  reading the stub's argv log. Nothing in the suite asserts what `list` prints.

## Goals / Non-Goals

**Goals:**

- Make the production binary construct and use a real client for exactly one
  command, without changing any other command's behavior or prerequisites.
- Produce a defensible answer to "how much work is one converted command", in
  files touched, lines added, and whether output parity held.
- Keep discovery CLI-owned, so the transport swap does not quietly invent a
  second endpoint resolution path.

**Non-Goals:**

- A renderer abstraction, a format module, or a second converted command. The
  measurement decides whether those are worth designing.
- Changing what `list` shows, filters, or orders.
- Per-case transport declaration, a parity verdict, or recording per transport:
  those stay in `add-openshell-sdk-transport`. This change only has to let one
  case reach a gateway.

## Decisions

### D1. The client is built lazily from the Context, not at startup

`Context` gains a `OnceLock<Result<Arc<dyn Gateway>, …>>`-shaped accessor that
resolves discovery and connects on first use. A command that never touches the
gateway — `osa projects`, registry reads, `help` — must not run discovery, must
not require the CLI, and must not fail because no gateway is reachable.

*Alternative rejected:* constructing the client in `main`. It would make every
command pay for discovery and would turn a registry-only command into a
gateway-dependent one, which is a behavior change the proposal does not ask for.

*Alternative rejected:* threading the client through every command signature.
Same objection as the parent change's D1: it makes the command layer generic
over the transport for one converted call site.

### D2. One rendering function, not a renderer layer

`list` renders from `Vec<Sandbox>` in a single function that emits the same rows
the CLI emitted. No trait, no per-command formatter table, no format module.

*Why:* the parent change's cost estimate is exactly the unknown this function
measures. Designing the abstraction first, for one consumer, would encode a
guess; the second converted command is the earliest point at which the real
shared shape is visible.

### D3. Parity is captured before the conversion, not after

Before `list` changes, a test records what `openshell sandbox list` prints for a
fixed stub state (two sandboxes, distinct phases) and commits that as the
expectation. The converted command is then compared against the captured text.

*Why:* after the conversion there is no oracle — the CLI invocation is gone, and
the conformance case never asserted output in the first place. Capturing first
is what turns "does it look right" into a diff.

*Alternative rejected:* defining a fresh output format and treating the change as
a deliberate output improvement. It would silently change what users see while
claiming a transport swap, and the capture is nearly free.

### D4. The harness gives the case a gateway on an ephemeral port, discovered the same way

The suite starts the `stub-gateway` binary with `STUB_GATEWAY_PORT=0`, reads the
`http://<addr>` it prints on stdout, and exports it to the CLI stub, which
reports that value as `server` in `gateway info`. Discovery is untouched: the
core still asks the CLI, and the CLI stub is what knows the port.

The gateway runs only for the case that uses the client. A process started for
the whole run changed two unrelated tests: the suite's `pkill`-driven SIGINT
cases stopped seeing their signal and failed as an escalated kill, reproducibly,
while passing on their own. Scoping the process to the one case keeps every other
case's environment exactly as it was, and costs one start per affected case.

*Alternative rejected:* pinning the stub gateway to the port the CLI stub
hardcodes (8080). It works until the port is taken, and a suite that fails on a
busy port is a suite that gets skipped.

*Alternative rejected:* teaching discovery to accept a URL from the environment
and skip the CLI. That is a different change to a different decision (the parent
change's D2 and task 1.4), and it would remove the CLI from the endpoint path
while other commands still depend on it.

### D5. The case keeps a transport assertion, replacing the one it loses

`assert_log_has "list"` becomes two assertions: no `openshell sandbox list`
invocation was recorded, and the output carries the expected rows. The inverse
assertion is deliberate — without it, a regression that quietly routes `list`
back through the CLI would pass.

*Alternative rejected:* deleting the assertion. It would leave the converted
command with strictly less coverage than the unconverted one, and "no invocation"
is precisely the property this change is about.

### D6. The measurement is recorded inside this change, and names what it revises

The result — files and lines per converted command, whether parity held and
where it did not, and which parent-change tasks the number changes — is written
into this change's own artifacts. The parent change's sizing is updated when this
archives, so the two changes are not edited in parallel.

*Alternative rejected:* a separate report document. The consumer of the number
is the parent change's task list, and a report nobody links is a report nobody
reads.

### D7. The listing carries the creation time, read through `raw_grpc`

The CLI's table has three columns — `NAME`, `CREATED` (`YYYY-MM-DD HH:MM:SS`,
UTC), `PHASE` — and it reads creation time from the sandbox's protobuf
`metadata.created_time`. The curated `list_all_sandboxes` call returns
`SandboxRef`, which has no creation time at all, so the listing reads
`raw_grpc().list_sandboxes` and maps the protobuf directly. The typed `Sandbox`
gains `created_ms`, defaulting to `0` where a transport does not report one,
which is exactly the CLI's own fallback (`unwrap_or_default()` then
`format_epoch_ms(0)` → the epoch string).

*Why not drop the column instead:* the requirement is parity with the CLI, and a
two-column table is a visible output change smuggled in under a transport swap.
The cost of adding it is itself one of the numbers this change exists to
measure.

*Known residual difference:* the CLI colors the phase column when stdout is a
terminal, and this path prints plain text. Parity is therefore exact for piped
output — which is what the capture, the conformance case, and any script
consume — and differs for a person reading a terminal. That difference is
recorded as a finding rather than fixed here, because a color decision belongs
with the rest of the rendering story.

### D8. A client certificate is supplied explicitly, never guessed

A gateway that requires mutual TLS is the ordinary local arrangement, and the
client cannot express it: its configuration has a CA but no client identity, and
`openshell gateway info --output json` reports `auth: null` even when the gateway
requires mTLS (the registry's `metadata.json` records `auth_mode: mtls`, which
this change does not read). So the certificate arrives from an explicit
directory — `--tls-dir`, `MAKI_OSS_TLS_DIR`, or the config key `tls_dir` — holding
`ca.crt`, `tls.crt`, and `tls.key`, and the channel is built here and handed to
the client through `from_parts`.

*Why not read OpenShell's own `mtls/` directory by default:* it would make the
default work on this host and quietly break on the next gateway layout change,
which is the objection the parent change's D2 already makes about the registry.
An explicit path is one flag, and the failure message names it.

*Why the failure must name the flag:* without a certificate the connection fails
as an anonymous TLS handshake. Discovery cannot see the mode, so nothing else in
the code knows mTLS is in play; the message is the only place the user can learn
it, and a bare "unreachable" would send them looking at the gateway service
instead.

*Rejected:* `insecure_skip_verify`. It is the shortest path to a green
connection and it removes the only integrity check on the hop.

## Risks / Trade-offs

- **Two stubs, one state tree** (the shell stub and the gateway service read the
  same `STUB_STATE_DIR`) → they already agree on the layout by construction, and
  the converted case must keep asserting state through that shared tree, so a
  divergence surfaces as a failing case rather than as a passing one.
- **Parity may be unattainable** (the CLI's table layout is undocumented) → the
  capture in D3 makes the differences explicit, and the `helper-cli`
  requirement separates minimum content from parity so the finding still yields
  a specifiable command.
- **A converted command with no output assertion** → D5 replaces the invocation
  assertion rather than dropping it, and the captured expectation is committed.
- **The port export is a new harness coupling** (the suite now parses one line
  of stdout from a process it starts) → the line is printed before the server
  accepts connections, the harness fails loudly if it never appears, and the
  process is stopped on every exit path.
- **`list` still needs the CLI present** (discovery shells out) → intended and
  documented: this change tests the transport, not the removal of the CLI from
  endpoint resolution.

## Findings

The measurement this change exists to produce, from the work above.

**The rendering is small and mechanical.** 26 non-test lines: one function that
formats the rows, plus a UTC date formatter. Reaching parity needed one field on
the typed listing (`created_ms`) and moving that one operation from the curated
`list_all_sandboxes` call to `raw_grpc`, because the curated `SandboxRef` carries no
creation time. With its tests the block is 99 lines.

**Parity held exactly** for non-terminal output: the rendered table is
byte-identical to `openshell sandbox list` against the host gateway (`diff`
empty), and the captured bytes are pinned at
`osa-core/crates/osa-core/tests/fixtures/sandbox-list.txt`. The residual
difference is colour — the CLI colours the phase column on a TTY, this path does
not — which is recorded, not fixed.

**The rendering was not the obstacle.** The client could not connect to the host
gateway at all: its registry records `auth_mode: mtls`, `openshell gateway info`
reports `auth: null`, and the client has no client-identity support. Closing
that took 60 non-test lines in `gateway/tls.rs`, a 58-line `connect_with`, a
27-line context path, a flag, an environment name, a config key, four usage
texts, and a new `tonic` feature — more code than the command it was meant to
unblock, and invisible from inside the change that planned the conversion.

**The conformance recording moved one block**: `sandbox list` became
`gateway info --output json`, 4 insertions and 2 deletions in a single golden,
with no other line changed. Five `list` runs in the case produced five discovery
calls, so one discovery per process holds in practice.

**Two harness interactions worth remembering.** The suite's interrupt cases run a
bare `wait`, so a long-lived gateway must not be its child — it is started from a
subshell and killed by pid. And a gateway alive for the whole run was a
suspicion, not a cause: the real reason two signal-timing cases failed in early
runs was that those runs were backgrounded (`nohup … &`), and a POSIX shell sets
SIGINT to ignored for asynchronous children, so the tests' own `kill -INT` never
landed. Run in the foreground, the same suite is 329 passed, 0 failed, 0
mismatched. Scoping the gateway to the one case is kept because it costs nothing
and keeps every other case's environment unchanged.

**What this means for the remaining nine conversions.** The rendering cost
generalizes: one function and one capture per command, and the capture must be
taken from a live gateway before the conversion, because the offline stub prints
JSON where the CLI prints a table. The authentication cost was a one-time seam.
The real per-command risk is whether its output has an oracle at all — `list`
had none, and create, start, and exec are richer.

## Migration Plan

1. Capture the CLI output for a fixed state and commit it as the expectation.
2. Teach the harness to start and stop the gateway service and export its port
   to the CLI stub; run the suite unchanged and confirm no case is affected.
3. Add the lazy client to `Context`; confirm no command other than `list`
   touches it, and that registry-only commands work with the CLI off `PATH`.
4. Convert `list`, render it, and diff against the capture.
5. Update the `status` case and its golden; the diff must be exactly the removed
   `sandbox list` invocations.

Rollback is a one-line revert of the call site plus the harness startup; no
on-disk format and no recorded state changes, so nothing needs migrating back.

## Open Questions

One, for the parent change rather than this one. The generalization question
is answered above in
Findings at the granularity this change can answer it: a read-only command costs
one render function and one capture. Whether a state-changing command's progress
output behaves the same way is the first thing the parent change's next
conversion should measure, not something this change can settle.
