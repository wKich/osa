# Proposal

## Why

The session, tools, and permission areas have journeys the archived harness
cannot script: a turn must still be running when the user interrupts, queues,
or backgrounds (`interrupt-running-turn`, `queue-prompt-while-running`,
`manage-queued-prompts`, `background-blocking-tools`); the model must fail or
be retried (`see-failed-turn-error`, `see-provider-retry`); and the agent must
call tools other than the shell (`see-file-reads-and-searches`,
`see-file-edit-diff`, `open-subagent-session`, `answer-agent-question`). The
script's turn vocabulary has only an instant text turn and a shell call.

Separately, every home-screen snapshot carried `/update to install v2.1.4`:
the TUI asks the OpenCode release feed for updates on both sides, so the
reference run had a network peer beyond the loopback provider (contradicting
the "reference run needs no credentials" scenario's loopback-only rule) and a
new OpenCode release would change every such snapshot.

## What Changes

- Turn vocabulary (one script, both sides):
  - a text turn's `delayMs` paces its stream chunks; the mock provider
    streams them with that delay and stops when the client hangs up, and the
    scripted Maki child streams them the same way and, interrupted, ends with
    the pinned cancelled result and no buffered message;
  - a `call` turn names a tool call per side (OpenCode's name and input, and
    Maki's with the result the pinned Maki tool returns, which the scripted
    child replays and the live run checks against real Maki);
  - a `fail` turn answers the model call with an HTTP error; the scripted
    child emits the pinned retry notice for 429/5xx and the pinned failed
    result otherwise.
- The harness environment sets `OPENCODE_DISABLE_AUTOUPDATE=1`
  (`cli/src/services/updater.ts` v2.0.32 L534) on both sides.
- All recorded journeys re-recorded offline and live.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the one-script requirement names the turn kinds and
  the update-check switch.

## Impact

`bridge/test/journeys/harness/{journey,mock-provider,standalone-provider,record}.ts`,
`bridge/test/fake-maki.ts`, their tests, and re-recorded journey snapshots.
No bridge runtime, sandbox, egress, provider, or credential change; the live
sandbox still reaches only its in-sandbox loopback mock.
