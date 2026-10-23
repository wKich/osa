# Tasks

## 1. Implementation

- [x] 1.1 Rewrite `bridge/test/prompt-attachments.test.ts` for forwarding
      (image block, dropped PDF/`file://`/malformed, text-only prompt, unknown
      session). Verify: the image case fails against the shipped bridge.
- [x] 1.2 `promptImages` in `bridge/src/bridge.ts`, image blocks in
      `MakiSession.prompt`, files on the inbox payload. Verify:
      `cd bridge && bun test prompt-attachments` passes and the full suite
      stays green.

## 2. Status, evidence, report

- [x] 2.1 Copy the matrices forward from `add-permission-session-scope`;
      refresh the attachment rows, add the missing OpenCode-side attachment
      row, and triage `prompt-file-mentions`. Verify:
      `grep -n "(i4)" evidence/*.md`.
- [x] 2.2 `bridge/compat/statuses.json`: `prompt-attachments` →
      `degraded`/`pin` with the L786–L816 citation; add
      `prompt-file-mentions` (`out-of-scope`, reason in the title). Verify:
      `cd bridge && bun test crosscheck`.
- [x] 2.3 Regenerate `docs/compatibility.md`. Verify: `make compat`.

## 3. Wrap-up gate

- [x] 3.1 `make test`, `make test-bridge`, `make compat`, `make lint`,
      `openspec validate add-prompt-attachment-forwarding`. Verify: all exit 0.
