# Discovery pass 5: closing check for the current pin

## The passes

| Pass | Command | Result |
| --- | --- | --- |
| API discovery | `bun bridge/test/discovery.ts` | 5 scenarios, 5 clean, 0 known defects deduped, **0 appended** |
| TUI discovery | `make test-ui` (real `opencode v2.0.32`) | PASS: 37 requests served without 404, PONG rendered, permission round-tripped, 0 open defects; normalized route set identical to the committed capture |
| Pin drift | `bun scripts/compat-drift.ts` | opencode v2.0.32 / maki 0.6.4; 119 routes / 293 schemas; no drift against the vendored contract |
| Offline suite | `cd bridge && bun test` | 79 pass, 0 fail, 742 expectations |
| Report consistency | `bun scripts/gen-compat.ts --check` | matches |

## Enumeration (from source at the pins)

- Routes: 143 pinned operations (`bridge/src/openapi-2.0.32.json`) = 143 rows
  in `bridge/compat/statuses.json`; none missing, none phantom.
- Events: 51 types in `packages/schema/src/session-event.ts` at v2.0.32, all
  51 with a row in `opencode-tui-features.md`.
- Wire: every inbound kind, control subtype, outbound kind and `stream_event`
  delta in `src/sdk_mode.rs` at v0.6.4 has a row in
  `maki-sdk-wire-features.md` (see the cross-map's iteration-5 findings).

## Scoreboard

Reachable routes: 10 `served-live`, 21 `served-faked`, 1 `deferred`,
0 `unhandled`. Reachable features: 26 `verified`, 4 `degraded` (all
`blockedBy: pin`), 0 `unverified`, 0 untriaged. Out of scope: 111 routes and
2 features. Open defects: 0 (3 entries, all `fixed`). Rows added to
`statuses.json`: 0.

| Non-verified row | Exit | Reason |
| --- | --- | --- |
| `permission-reask` | degraded / pin | `always` is Maki's session-scoped allow; the SDK decoder has no project/global answer (`sdk_mode.rs` v0.6.4 L918–L927) |
| `agent-switch-state` | degraded / pin | no `set_agent` among the inbound control subtypes (`sdk_mode.rs` v0.6.4 L818–L880) |
| `mid-turn-steering` | degraded / pin | each stdin `user` goes to the input queue and is answered by its own later run (`sdk_mode.rs` v0.6.4 L682–L702, L763) |
| `prompt-attachments` | degraded / pin | inbound `user` decodes only text and image blocks; PDFs are dropped (`sdk_mode.rs` v0.6.4 L786–L816) |
| `sdk-control-handshake` | out-of-scope | the child serves control requests without a handshake (L818–L827); no TUI behavior depends on it |
| `prompt-file-mentions` | out-of-scope | the bridge reads no host path on a client's behalf; the `@path` stays in the prompt and Maki reads its own workdir |

## Next unblocked reachable items

None. Every reachable non-verified row is pin-blocked.
