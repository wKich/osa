# Tasks

## 1. Envelope coverage

- [x] 1.1 Add `bridge/test/envelope.test.ts` asserting that every outbound
      frame in the captured fixtures (`maki-plain`, `maki-tool`,
      `maki-precheck`, `maki-permission`, `maki-stream-live`,
      `maki-subagent-live`) carries a non-empty top-level `session_id` and a
      hyphenated UUID `uuid`. Verify: `cd bridge && bun test envelope`
      passes, and the companion negative test (a frame missing `session_id`,
      then a malformed `uuid`) fails the same assertion.
- [x] 1.2 Stamp the captured envelope (`session_id: "fake-maki-session"` and a
      fresh hyphenated UUID `uuid`) on every frame `bridge/test/fake-maki.ts`
      emits, leaving its behavior unchanged, and add the end-to-end case to
      `bridge/test/envelope.test.ts`: start the bridge with the scripted
      child, create a session, prompt once, and assert every event's
      `data.sessionID` and every durable `aggregateID` is the minted `ses_`
      id while the child's envelope id is `fake-maki-session`. Verify:
      `cd bridge && bun test envelope` passes and prints no frame carrying
      `fake-maki-session`.

## 2. Status and report

- [x] 2.1 Retitle the `maki-wire-envelope` row to the tested behavior and
      flip it `unverified` → `verified` with evidence
      `bridge/test/envelope.test.ts`; keep every other row untouched. Verify:
      `cd bridge && bun test crosscheck` passes.
- [x] 2.2 Regenerate `docs/compatibility.md` and confirm the row reads
      `verified` with the test link. Verify: `make compat` exits 0.
- [x] 2.3 Make `scripts/gen-compat.ts` match provenance notes on whole
      fixture names, so `maki-stream-live` does not imply the authored
      `maki-stream`. Verify: `bun scripts/gen-compat.ts --check` passes and
      the `maki-wire-envelope` row carries no authored-fixture caveat while
      the golden rows keep theirs.
- [x] 2.4 Confirm no row this change touches points its evidence into the
      change directory, so archiving needs no path rewrite. Verify:
      `grep -n "add-wire-envelope-coverage" docs/compatibility.md
      bridge/compat/statuses.json` prints nothing.

## 3. Wrap-up gate

- [x] 3.1 Run the full gate in one pass: `make test`, `make test-bridge`,
      `make compat`, `make lint`, and
      `openspec validate "add-wire-envelope-coverage"`. Verify: all five
      exit 0. `make compat`'s `git diff` half needs the regenerated report
      staged; this tree also carries the uncommitted discovery pass, so run
      it against a temporary index containing `docs/compatibility.md`
      (`GIT_INDEX_FILE=<tmp> git add docs/compatibility.md`) rather than
      altering the real index.
