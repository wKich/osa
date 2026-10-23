# Tasks

## 1. Implementation

- [x] 1.1 Rewrite `bridge/test/model-switch.test.ts` (forwarded switch, bare
      id, refused model, no-op re-post, missing fields, unknown session).
      Verify: 4 of 5 original cases fail against the shipped bridge.
- [x] 1.2 `MakiSession.setModel` over a shared `control`; `selectModel` and the
      `controls` ack registry in `bridge/src/bridge.ts`;
      `Translator.announceModel`. Verify: `cd bridge && bun test model-switch`.
- [x] 1.3 Scripted child resolves `set_model` and names the switched model on
      assistant frames. Verify: the full `cd bridge && bun test` stays green.
- [x] 1.4 Gated TUI smoke, since the route is TUI-reachable. Verify:
      `make test-ui` prints `tui-check: PASS`; `bun bridge/test/discovery.ts`
      appends nothing.

## 2. Status, evidence, report

- [x] 2.1 Copy the matrices forward from `add-prompt-attachment-forwarding`;
      refresh the model-switch rows. Verify: `grep -n "(i4)" evidence/*.md`.
- [x] 2.2 `bridge/compat/statuses.json`: `mid-session-model-switch` →
      `verified`, `blockedBy: none`. Verify: `cd bridge && bun test crosscheck`.
- [x] 2.3 Regenerate `docs/compatibility.md`. Verify: `make compat`.

## 3. Wrap-up gate

- [x] 3.1 `make test`, `make test-bridge`, `make compat`, `make lint`,
      `openspec validate add-model-switch-forwarding`. Verify: all exit 0.
