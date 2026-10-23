# Tasks

## 1. Implementation

- [x] 1.1 Rewrite `bridge/test/interrupt.test.ts` for the forwarded contract
      (idle no-op, in-flight cancel, parked ask, follow-up turn, unknown
      session). Verify: it fails against the shipped bridge (3 of 5 red).
- [x] 1.2 Add `MakiSession.interrupt()` (`control_request`/`interrupt`),
      `Translator.inTurn`/`markInterrupted`, the interrupted end in
      `handleResult`, and the interrupt arm in `sessionRoute`. Verify:
      `cd bridge && bun test interrupt` passes.
- [x] 1.3 Teach `bridge/test/fake-maki.ts` the pinned interrupt (ack, kill the
      running command, `error_during_execution` result). Verify: the full
      `cd bridge && bun test` stays green.

## 2. Status, evidence, report

- [x] 2.1 Copy the iteration-3 matrices forward into `evidence/`, refresh the
      interrupt rows, and record the iteration-4 triage table. Verify:
      `grep -n "(i4)" evidence/*.md` lists the refreshed rows.
- [x] 2.2 `bridge/compat/statuses.json`: `interrupt-round-trip` → `verified`
      (title rewritten), interrupt route → `served-live`. Verify:
      `cd bridge && bun test crosscheck` passes.
- [x] 2.3 Regenerate `docs/compatibility.md`. Verify: `make compat` exits 0
      with the regenerated report staged in a temporary index.
- [x] 2.4 Confirm no statuses row cites this change dir. Verify:
      `grep -n add-interrupt-forwarding bridge/compat/statuses.json` prints
      nothing.

## 3. Wrap-up gate

- [x] 3.1 `make test`, `make test-bridge`, `make compat`, `make lint`,
      `openspec validate add-interrupt-forwarding`. Verify: all exit 0.
