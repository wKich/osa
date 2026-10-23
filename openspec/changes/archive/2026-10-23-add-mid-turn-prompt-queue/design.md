# Design

## Context

Pinned behavior, cited before code:

- Maki v0.6.4 `src/sdk_mode.rs` L682–L702: an inbound `user` becomes an
  `AgentInput` and is sent on `handle.input_tx`; L763: the pump ends once the
  session "has answered every prompt stdin queued".
- maki-agent `src/headless.rs` v0.6.4 L365: `while let Ok(input) =
  input_rx.recv_async().await` runs one agent per input, so each prompt is its
  own run with its own `Done` → `result`. L335 and L366–L374: the cancel
  channel is `bounded(1)` and each run subscribes to it, so a cancel sent
  between runs cancels the next run.
- maki-agent `src/types.rs` L604–L611, L732–L735: `Steered` carries
  `MessageRewritten | MessageDropped | Continued` (plugin hooks), not mid-run
  delivery.
- OpenCode v2.0.32: `Session.Inbox.Delivery` is `steer | queue`
  (`schema/src/session-inbox.ts`); `session.inbox.delivered` (L208),
  `.enqueued` (L215), `.cancelled` (L225), `.delivery.changed` (L232) are
  durable v1 (`session-event.ts`).

## Goals / Non-Goals

**Goals**
- A mid-turn prompt keeps both turns intact and ordered.
- The TUI is told the truth about delivery.

**Non-Goals**
- Steering into the running run: no SDK path at the pin.
- `delivered` for prompts that start at once: unchanged (no consumer needs it).
- Interrupt's `resume` parameter.

## Decisions

1. **Write to the child at admission; queue only the bookkeeping.** Maki
   queues the prompt itself, and holding it in the bridge would add a second
   queue that could drift from the child's.
2. **Report `steer` as `queue` with the pinned change event.** The enqueued
   item keeps what was asked; `delivery.changed` says what happened, so the
   frame stream stays a faithful history.
3. **`delivered` only for queued items.** In OpenCode's inbox model a queued
   item is pending until `delivered` (or `cancelled`) settles it. Emitting `delivered` for immediate turns
   would change the frame sequence every golden pins, for no consumer.
4. **Start the next turn from `handleResult`.** Success, failure, and the
   interrupted end all pass through it, so a queued turn follows any end. Child
   exit goes through `abortTurn`, which cancels the queue instead, because no
   child is left to answer it.
5. **The scripted child keeps an early interrupt.** With sequential runs, an
   interrupt can land before its run starts. The pin's bounded(1) channel keeps
   it for that run, and the scripted child does the same.

## Risks / Trade-offs

- [The TUI may render a queued `steer` differently from a steered one] → It is
  told the item is `queue` through the pinned event, so it renders what will
  actually happen. The TUI smoke never prompts mid-turn; contract-only.
- [An interrupt with queued prompts stops only the running turn] → That is the
  pin's behavior (one cancel per run); the queued turn then starts.
