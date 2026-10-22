# Tasks

## 1. Enumerate the pinned contract

- [x] 1.1 Script the route enumeration from `bridge/src/openapi-2.0.32.json`
      (every operation whose path is under `/api/`, keyed `METHOD /path`) into
      `evidence/route-enumeration.md`, and verify the file lists 142
      operations and reproduces the 108-without-a-row and 1-phantom figures
      quoted in proposal.md
- [x] 1.2 Copy the iteration-1 evidence matrices forward from
      `openspec/changes/archive/2026-10-21-fix-bridge-transcript-defects/evidence/`
      (`maki-sdk-wire-features.md`, `opencode-tui-features.md`,
      `cross-map.md`) into this change's `evidence/` directory, and verify no
      file under `openspec/changes/archive/` was modified (`git status` shows
      the archive clean)
- [x] 1.3 Extend the copied matrices with the wire message kinds and control
      request subtypes found in Maki `sdk_mode.rs` at pin v0.6.4 and the SSE
      event envelopes in OpenCode `session-event.ts` at tag v2.0.32, and
      verify each added row cites a file and line at the pin, never a
      versionless doc URL

## 2. Classify and record the route rows

- [x] 2.1 Determine how the bridge answers each of the 108 unrecorded
      operations by reading `bridge/src/bridge.ts` dispatch, and verify the
      determination against one `bun bridge/test/discovery.ts` pass whose
      request log records `matched` per route
- [x] 2.2 Add one row per operation to `bridge/compat/statuses.json` with
      `served-faked` (the `synthesize` fallthrough), `deferred`, or
      `unhandled` per D3, each carrying the evidence artifact per D4, and
      verify `bun scripts/gen-compat.ts --check` passes and every evidence key
      resolves (`crosscheck.test.ts` green)
- [x] 2.3 Remove the phantom `GET /api/session/{sessionID}/terminal` row, and
      verify no row's route is absent from the pinned contract by re-running
      the 1.1 enumeration script in diff mode against `statuses.json`
- [x] 2.4 Add the feature rows the extended matrices show upstream but
      missing from `statuses.json`, each at `unverified` or `deferred` with a
      pinned citation as evidence, and verify no new row is `verified` (which
      `crosscheck.test.ts` would reject for a non-test evidence path)

## 3. Teach the loop the phantom-row class

- [x] 3.1 Add the two-line finding class to
      `.opencode/skills/running-feature-discovery/SKILL.md` — a matrix row
      whose route or capability the pinned upstream does not define is a
      finding, alongside "present upstream but missing" and status-flip
      staleness — and verify the edit is a diff `git diff` shows against the
      tracked skill file, with no other skill text changed

## 4. Regenerate and verify

- [ ] 4.1 Run `bun scripts/gen-compat.ts` and verify `make compat` exits 0
      with the committed `docs/compatibility.md` matching the regenerated
      output, and that the report's route section grew to ~140 rows with the
      three lenses still separate
- [x] 4.2 Run `make test`, `make test-bridge`, `make lint`, and
      `openspec validate "rebaseline-compat-enumeration"` in one pass, and
      verify all exit 0 with no bridge source change (`git diff --stat
      bridge/src` empty)
- [x] 4.3 Confirm the report's provenance by spot-checking three rows — one
      `served-faked`, one `deferred`, one `unhandled` — against the live
      bridge, and verify each row's stated status matches what the bridge
      actually returns

## 5. Wrap-up

- [x] 5.1 Record this change's evidence paths in a wrap-up note, and verify
      it names the dated archive path each row must be rewritten to at
      archive time, so `crosscheck.test.ts` stays green after the archive
      commit
