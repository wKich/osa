# Tasks

## 1. Implementation

- [x] 1.1 `MakiSession.answer` takes `updatedPermissions`/`message` extras;
      `replyPermission` maps `always` and a reasoned `reject`; `save` lists the
      tool name. Verify: `cd bridge && bun test permission-egress` passes.
- [x] 1.2 `bridge/test/fake-maki.ts` models `AllowSession` (session rule for
      `<word> *`). Verify: `cd bridge && bun test session-api` passes.
- [x] 1.3 Update `bridge/test/api-check.ts` 5.3 to expect no re-ask after
      `always` (live harness; not in the offline gate). Verify: the file parses
      under `bun build --no-bundle`.

## 2. Status, evidence, report

- [x] 2.1 Copy the matrices forward from `add-interrupt-forwarding`; refresh
      the permission rows and record the iteration-4 findings. Verify:
      `grep -n "(i4)" evidence/*.md`.
- [x] 2.2 `bridge/compat/statuses.json`: `permission-reply-vocabulary` →
      `verified`; `permission-reask` → `degraded`/`pin` with the
      `sdk_mode.rs` L918–L927 citation; `control-response-emission` title
      drops "bare". Verify: `cd bridge && bun test crosscheck`.
- [x] 2.3 Regenerate `docs/compatibility.md`. Verify: `make compat`.
- [x] 2.4 Rerun the gated TUI smoke, since `save` is TUI-visible. Verify:
      `make test-ui` prints `tui-check: PASS`.

## 3. Wrap-up gate

- [x] 3.1 `make test`, `make test-bridge`, `make compat`, `make lint`,
      `openspec validate add-permission-session-scope`. Verify: all exit 0.
