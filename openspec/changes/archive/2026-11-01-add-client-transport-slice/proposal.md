# Proposal

## Why

`add-openshell-sdk-transport` built the typed gateway client and proved it
against a fake gateway server, but no command calls it: `agent/gateway.rs`
`run_gateway` still spawns `openshell` at all 26 call sites. The remaining work
is not a mechanical swap of one call for another. Today every command forwards
the CLI's stdout to the user and lets `openshell` do the formatting; the client
returns typed structs, so converting a command also means deciding what it
prints.

There is no evidence for that decision. `list` — the simplest read-only command
in the set — has exactly one assertion in the suite, that `openshell` was
invoked, and none on its output. So neither the size of the remaining
conversion nor the wisdom of doing it at all can be estimated today; both are
guesses.

This change converts one command end to end, `list`, and treats the result as a
measurement: what it costs to replace a forwarded output with a rendered one,
and whether byte-for-byte parity with the CLI is even attainable.

## What Changes

- Wire the client into the command context: construct `Arc<dyn Gateway>` once
  from the discovered endpoint and make it reachable from the commands. This is
  the first time the production binary holds a client at all.
- Convert `list` (a shared front-end command, `SHARED_COMMANDS` in
  `agent/cli.rs:21`, dispatched at `agent/cli.rs:177`) from
  `run_gateway(&["sandbox", "list"])` to the client's sandbox listing, and
  render its output in the core.
- Treat output parity as the experiment: capture what the CLI printed for a
  given state, decide whether the core reproduces it byte for byte or diverges
  deliberately, and record which.
- Let the conformance suite run a case against a real gateway process: start
  `stub-gateway` on an ephemeral port and report that port through the CLI stub,
  so discovery stays CLI-owned and a converted case does not depend on a shell
  stub that pretends to be a server.
- Let the client present a client certificate, named by `--tls-dir`, so a
  gateway that requires mutual TLS is reachable — the ordinary local
  arrangement, and one the client's own configuration cannot express. Without a
  certificate the failure names that flag, because gateway discovery reports
  `auth: null` for an mTLS gateway and the client cannot otherwise tell the
  difference.
- Record the measurement as revised sizing for `add-openshell-sdk-transport`'s
  conversion section, so the remaining 25 call sites are planned on evidence
  instead of the estimate that exists now.

**Out of scope:** no other command converts; no conformance comparison verdict;
no renderer abstraction beyond what `list` needs; no work on the recording
transport, the log path, or provider and rule conversion.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `helper-cli`: `list` reports sandboxes the helper renders from the typed
  listing instead of forwarding the gateway's stdout, so what the command prints
  becomes a requirement the helper owns rather than an artifact of the gateway's
  formatter; and a gateway that requires a client certificate is reachable
  through an explicitly named one.
- `helper-conformance`: the suite starts its own in-process gateway for a case
  whose command reaches the gateway through the typed client, so a case set can
  hold both transports and the suite still runs with no gateway provisioned on
  the host.

## Impact

- Modified: `agent/context.rs` (carries the client and reads the certificate),
  `agent/commands.rs` `list`, `agent/cli.rs` and `agent/config.rs` (the
  `--tls-dir` flag and its config key), the four `agent/usage/*.txt` texts,
  `gateway/sdk.rs` (a channel that carries a client identity), the case
  `status` in `tests/run-tests.sh`, and the golden
  `tests/conformance/golden/test_status_list_logs__status.log`.
- New: `gateway/tls.rs` (the certificate type and a directory loader whose
  `Debug` prints no material), and the captured table the renderer is checked
  against at `osa-core/crates/osa-core/tests/fixtures/sandbox-list.txt`.
- New: harness startup and teardown of the `stub-gateway` binary, whose port the
  CLI stub already reports as `http://127.0.0.1:8080`; and a `list` test that
  asserts the rendered output, replacing the invocation assertion being lost.
- Risk: converting `list` removes the only check it has. The replacement must
  assert the output's shape, or the command becomes less verified after the
  conversion than before it. This change adds that assertion rather than keeping
  the invocation check it replaces.
- Risk: byte-for-byte parity may be unattainable without reproducing the
  gateway's table layout. If it is, the finding is that
  `add-openshell-sdk-transport`'s `transport-changed` scenario needs a stated
  tolerance for output, and the conversion is materially larger than that change
  assumes. The `helper-cli` requirement states the minimum content (name and
  phase per sandbox) separately from parity, so that outcome still leaves a
  specifiable command.
- Depends on `add-openshell-sdk-transport` for the client and the stub gateway,
  both in flight and unarchived. This change implements one slice of that
  change's `helper-conformance` delta; its comparison verdict stays there.
- Security: `list` involves no provider credential, adds no endpoint, and
  discovery still asks the CLI once per process; egress stays deny-by-default.
  The client-certificate key is treated as a credential: it is read from a file
  the caller names, never from an argument, never printed, and no path disables
  certificate verification. mTLS support is a declared non-goal of
  `add-openshell-sdk-transport`, which this change supersedes for the client.
