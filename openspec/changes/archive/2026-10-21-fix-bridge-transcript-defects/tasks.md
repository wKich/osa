# Tasks

## 1. Two-sided feature inventory (recorded during capture)

- [x] 1.1 `evidence/maki-sdk-wire-features.md`: Maki v0.6.4 SDK wire —
      outbound/inbound types, subtypes, flags, scenario seeds (verify:
      every row cites a source: `src/sdk_mode.rs` line, fixture file, or an
      explicit "none yet")
- [x] 1.2 `evidence/opencode-tui-features.md`: OpenCode surface — measured
      vs contract-only vs out-of-scope groups over the 119 vendored paths
      (verify: the 33 measured routes from the archived route inventory all
      appear, and out-of-scope groups are named, not dropped)
- [x] 1.3 `evidence/cross-map.md`: every capability joined with a status in
      the report vocabulary and an iteration pointer (verify: no row lacks a
      status; the two `buggy` rows match `bridge/defects.json` ids)

## 2. Pin the user-message event shape from evidence

- [x] 2.1 Establish the shape the real server emits for a user prompt
      (decision 1 order: archived `sse-events.jsonl` / `tui-run.typescript`,
      then the vendored OpenAPI event schemas; a gated live capture only if
      both fail) and record the conclusion with its source in
      `evidence/cross-map.md` (verify: the cross-map's transcript-order row
      names one concrete frame shape and the file it was read from — or
      records that no source confirms one, in which case task 3 stays open)

## 3. Fix the two transcript defects

- [x] 3.1 Emit the user-role representation synchronously in the prompt
      handler, before the child is written to, so Q-A-Q-A interleaves within
      and across turns (verify: `bun bridge/test/discovery.ts` reports
      `ok message-order-inversion`, the flipped golden
      `want-prompt-order.json` passes, and the TUI smoke capture shows the
      prompt above its answer)
- [x] 3.2 Route the child's announced model (`system.init.model`,
      `assistant.model`; parse `provider/id` on first `/`, fallback
      `{providerID:"maki", id:<raw>}`) into `/api/model`, session state, and
      `session.step.started`, keeping synthesis only before a live
      announcement (verify: discovery reports `ok synthesized-model-name`,
      the flipped golden `want-model-identity.json` passes, and the
      contract/session suites stay green)

## 4. Close the loop's records

- [x] 4.1 `bridge/defects.json`: both entries flip to `status: "fixed"` with
      their `expectedFailure` markers removed (entries kept, not deleted)
      (verify: `bridge/test/crosscheck.test.ts` passes — markers pair with
      open entries only)
- [x] 4.2 `bridge/compat/statuses.json`: `transcript-order` and
      `model-identity` flip to `verified` with their tests as evidence, and
      the cross-map's new rows (api-retry tolerance, interrupt round trip,
      model switch, steering, sdk control handshake, subagent nesting) are
      added as `unverified`/`deferred` linked to this change's evidence
      (verify: `make compat` regenerates `docs/compatibility.md` with no
      `buggy` rows and the new rows present)

## 5. Verification pass and wrap-up

- [x] 5.1 Rerun the scripted discovery pass end to end (verify:
      `bun bridge/test/discovery.ts` prints `ok` for all five scenarios and
      `0 appended`)
- [x] 5.2 One-pass gate: `make test`, `make test-bridge`, `make compat`,
      `make lint`, `openspec validate "fix-bridge-transcript-defects"` all
      exit 0 (verify: five commands in one shell pass, no failures)
- [x] 5.3 Archive-path reminder: this change's evidence links in
      `statuses.json` point into `openspec/changes/fix-bridge-transcript-defects/`
      and must be rewritten to the dated archive path during archive, as the
      previous change did (verify: the archive step's diff touches those
      evidence keys)
