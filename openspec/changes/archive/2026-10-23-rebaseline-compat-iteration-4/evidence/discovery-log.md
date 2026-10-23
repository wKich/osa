# Discovery pass 4: closing record for the current pin

## The passes (after the five iteration-4 slices)

| Pass | Command | Result |
| --- | --- | --- |
| API discovery | `bun bridge/test/discovery.ts` | 5 scenarios, 5 clean, 0 known defects deduped, **0 appended** |
| TUI discovery | `make test-ui` (real `opencode v2.0.32`) | PASS: 37 requests served without 404, PONG rendered, permission round-tripped, 0 open defects; route set identical to the committed capture |
| Pin drift | `bun scripts/compat-drift.ts` | opencode v2.0.32 / maki 0.6.4; no drift against the vendored contract |
| Offline suite | `cd bridge && bun test` | 79 pass, 0 fail, 741 expectations |
| Report consistency | `bun scripts/gen-compat.ts --check` | matches |

## Enumeration

- Routes: 143 pinned operations (`bridge/src/openapi-2.0.32.json`), 143 rows
  in `bridge/compat/statuses.json`, no missing or phantom operation.
- Events: 51 types in `packages/schema/src/session-event.ts` at v2.0.32; the
  bridge emits 23 (`opencode-tui-features.md` event table).

## Scoreboard

Reachable routes: 10 `served-live`, 21 `served-faked`, 1 `deferred`,
0 `unhandled`. Reachable features: 26 `verified`, 4 `degraded` (all
`blockedBy: pin`), 0 `unverified`, 0 untriaged. Out of scope: 111 routes and
2 features. Open defects: 0.

| Non-verified row | Exit | Reason |
| --- | --- | --- |
| `permission-reask` | degraded / pin | `always` is Maki's session-scoped allow; the SDK decoder has no project/global answer (`sdk_mode.rs` L918–L927) |
| `agent-switch-state` | degraded / pin | no `set_agent` among the inbound control subtypes (`sdk_mode.rs` L818–L880) |
| `mid-turn-steering` | degraded / pin | each stdin `user` is answered by its own later run, never steered into the running one (`sdk_mode.rs` L682–L702, L763) |
| `prompt-attachments` | degraded / pin | inbound `user` decodes only text and image blocks; PDFs are dropped (`sdk_mode.rs` L786–L816) |
| `sdk-control-handshake` | out-of-scope | the child serves control requests without a handshake (L818–L827); no TUI behavior depends on it |
| `prompt-file-mentions` | out-of-scope | the bridge reads no host path on a client's behalf; the `@path` stays in the prompt and Maki reads its own workdir |

## Next unblocked reachable items

None: every reachable non-verified row is pin-blocked. Moving any of them
needs a Maki pin bump (out of scope for this burndown).
