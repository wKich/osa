# Bridge test home

Offline verification for the OpenCode TUI bridge: golden translation tests,
contract and wire tests, session API tests over a black-box bridge, a defect
inventory with a scripted discovery loop, and the generated compatibility
report. No Docker, no gateway, no network — `make test` stays the POSIX-shell
stub suite and never comes here.

## Layout

| Path | What it is |
| --- | --- |
| `fixtures/` | Recorded maki jsonl fixtures and the archived wire/body captures, copied from `openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/` (the archive itself stays the historical record) |
| `golden/` | Committed goldens: the projected frame sequence (ids/timestamps stripped) each fixture must produce, plus `want-*.json` desired goldens for open defects |
| `fake-maki.ts` | Scripted maki child, injected through the `MAKI_CHILD_CMD` seam — speaks the SDK wire, runs commands on the host |
| `*.test.ts` | The suite: `golden` (translation), `contract` (OpenAPI + SSE wire rules), `session-api` (black-box session flows), `crosscheck` (statuses ↔ tests ↔ inventory), `smoke` (runner sanity) |
| `discovery.ts` | API-level discovery pass: repeatable explorational matrix, appends new defects |
| `tui-discovery.sh`, `tui-check.ts` | TUI-level discovery pass (`make test-ui`): drives the real `opencode` binary, asserts boot/prompt/permission invariants, records open-defect reproductions |
| `captures/` | Discovery captures — a capture committed here backs an inventory entry; `tui-last.*` are transient run artifacts (gitignored) |
| `api-check.ts`, `validate-bridge.mjs` | Verbatim copies of the archived harness sources the suite was converted from (provenance; their scenarios now live in `session-api.test.ts` and `contract.test.ts`) |
| `../defects.json` | The defect inventory: id, title, `status` (`known` = open, `fixed`), `capture`, optional `golden` + `expectedFailure` marker |
| `../compat/statuses.json` | The machine-readable status file behind `docs/compatibility.md` |

## Running

From the repository root:

```sh
make test-bridge        # the offline suite (skips when bun is absent)
make compat             # regenerate docs/compatibility.md, fail while stale
make compat-drift       # A/B the installed OpenCode contract against the vendored copy
make test-ui            # TUI-level pass; needs opencode + bun, ~75s, else it skips
bun bridge/test/discovery.ts        # API-level discovery pass
bun scripts/gen-compat.ts --check   # report consistency, no write
cd bridge && bun test               # the same suite, directly
cd bridge && UPDATE_GOLDENS=1 bun test  # rewrite goldens after reviewing the diff
```

Golden update rule: regenerate only after you have looked at the diff — a
golden freezes current behavior on purpose, and the defect goldens in
`golden/want-*.json` encode the *desired* behavior, not the current one.

## The defect loop

1. **Run discovery** — `bun bridge/test/discovery.ts` (API level) and, on a
   host with `opencode`, `make test-ui` (TUI level).
2. **Triage appended entries** — new findings land in `../defects.json` with
   `status: "known"` and a capture in `captures/defect-<id>.jsonl`. Re-running
   with nothing new appends nothing: the inventory stays byte-identical and
   known defects simply dedupe.
3. **Open one OpenSpec change per fix** — one defect (or one coherent fix) per
   change; the proposal states the acceptance criteria.
4. **Fix, then flip the inventory** — set the entry's `status` to `fixed` and
   drop its `expectedFailure` marker. That turns its `want-*.json` golden from
   an expected failure into a normal assertion, so the suite fails until the
   fix really produces the desired frames (`crosscheck.test.ts` enforces the
   pairing in both directions; `tui-check.ts` fails an entry that stops
   reproducing).
5. **Regenerate the report** — `make compat` fails while
   `docs/compatibility.md` disagrees with the flipped status (the feature stops
   being forced to `buggy`); the failing run regenerates the file.
6. **Commit together** — the fix, the inventory flip with its marker removal,
   and the regenerated `docs/compatibility.md` land in one commit, so the next
   `make compat` on a clean tree exits 0.

The two seeded defects (message-order inversion, synthesized model name)
were the loop's worked example: both opened as `known` with an
`expectedFailure` marker and are now `fixed`, markers removed, goldens
flipped to positive assertions — and both fixes landed under
`openspec/changes/archive/2026-10-21-fix-bridge-transcript-defects/`.

Test coverage for recorded-but-unverified rows is the other branch of the
loop, handled by the `proposing-coverage-change` skill; it ships tests and
status flips only, never code fixes.
