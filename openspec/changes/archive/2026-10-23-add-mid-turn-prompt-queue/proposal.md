# Proposal

## Why

`mid-turn-steering` was `unverified` with `blockedBy: none`. Reading the pin
settles what the child does with a prompt sent while it works: Maki v0.6.4
sends each inbound `user` to the session's input queue (`src/sdk_mode.rs`
L682–L702), the headless session runs one queued prompt at a time, each to its
own result (maki-agent `headless.rs` L365; `sdk_mode.rs` L763 "answered every
prompt stdin queued"), and `AgentEvent::Steered` is a plugin rewrite/drop, not
mid-run delivery. OpenCode v2.0.32 models this directly: delivery
`steer | queue` (`schema/src/session-inbox.ts`) with
`session.inbox.delivery.changed`, `.delivered`, and `.cancelled`
(`session-event.ts` L208–L237). The bridge did neither: a mid-turn prompt
opened a second turn over the running one. The capability, queueing the turn
the way the child does, is missing and both pins support it. True steering is
the pin-blocked remainder.

## What Changes

- The translator queues a turn admitted while one runs. Its inbox item is
  enqueued at admission; a `steer` is reported as `queue`
  (`session.inbox.delivery.changed`). The turn starts with
  `session.inbox.delivered`, `execution.started`, and `step.started` when the
  running turn's result lands.
- The prompt route's admitted item carries the delivery the item really gets.
- A child exit cancels queued items (`session.inbox.cancelled`).
- The scripted child answers stdin prompts one at a time, and keeps an
  interrupt that lands before its run starts, like the pin's bounded(1) cancel
  channel (`headless.rs` L335, L366–L374).
- `mid-turn-steering` → `degraded`, `blockedBy: pin`, cited from
  `sdk_mode.rs` L682–L702 and L763.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `opencode-tui-bridge`: adds "Queue a prompt sent while a turn runs".

## Impact

- Runtime: `bridge/src/translator.ts` (turn queue, inbox lifecycle frames),
  `bridge/src/bridge.ts` (admitted delivery).
- Tests: `bridge/test/steering.test.ts` (new), `bridge/test/fake-maki.ts`
  (sequential runs, kept cancel), `bridge/test/api-check.ts` (comment).
- Report data: `bridge/compat/statuses.json`, `docs/compatibility.md`.
- TUI smoke (`make test-ui`) passes; it never prompts mid-turn.
