# Tasks

## 1. Implementation

- [x] 1.1 Add `bridge/test/steering.test.ts` (steer → queue, queued turn
      order and message ids, `queue` delivery, idle prompt, cancel on child
      exit). Verify: 3 of 4 fail against the shipped bridge.
- [x] 1.2 Translator turn queue (`beginTurn` returns the real delivery,
      `startNext` after every result, `abortTurn` cancels the queue); the route
      reports the delivery. Verify: `cd bridge && bun test steering`.
- [x] 1.3 Scripted child: one prompt at a time, early interrupt kept. Verify:
      the full `cd bridge && bun test` is green on two consecutive runs.
- [x] 1.4 Gated TUI smoke and discovery. Verify: `make test-ui` prints
      `tui-check: PASS`; `bun bridge/test/discovery.ts` appends nothing.

## 2. Status, evidence, report

- [x] 2.1 Copy the matrices forward from `add-model-switch-forwarding`; correct
      the steering rows (queued, not steered) and record the finding. Verify:
      `grep -n "(i4)" evidence/*.md`.
- [x] 2.2 `bridge/compat/statuses.json`: `mid-turn-steering` → `degraded`/`pin`
      with `bridge/test/steering.test.ts` and the L682–L702/L763 citation.
      Verify: `cd bridge && bun test crosscheck`.
- [x] 2.3 Regenerate `docs/compatibility.md`. Verify: `make compat`.

## 3. Wrap-up gate

- [x] 3.1 `make test`, `make test-bridge`, `make compat`, `make lint`,
      `openspec validate add-mid-turn-prompt-queue`. Verify: all exit 0.
