# Proposal

## Why

`docs/compatibility.md` is generated from `bridge/compat/statuses.json`, but the
`GET /api/session` row's evidence points at
`openspec/changes/archive/2026-10-21-add-opencode-tui-bridge/evidence/api-check.log`.
The repository-wide `*.log` rule in `.gitignore` excludes that file, so a clean
checkout has no such path and `scripts/check-links.sh` fails on the report's
relative link. A working tree hides the rot because the untracked log is still
on the author's disk. The `opencode-tui-bridge` spec already requires every
route row's evidence to be a committed artifact, so the generated page is
currently inconsistent with an existing requirement rather than missing one.

## What Changes

- Replace the `GET /api/session` route row's `evidence` in
  `bridge/compat/statuses.json` with `bridge/test/model-switch.test.ts`. That
  tracked test asserts the route lists the created session with the model the
  scripted child acknowledged, which proves the row's `served-live` claim
  without inventing a new test.
- Regenerate `docs/compatibility.md` with `make compat`. The page is generated;
  hand-editing it is not part of this change.
- Verify the report link resolves in a clean checkout that contains no ignored
  file, and keep the offline evidence check green.
- **Does not** change the bridge, the report generator, the tests, the spec, or
  `.gitignore`. The gitignored log is left in place as a local run artifact.
- **Does not** commit or un-ignore `*.log`, and does not add a redirect or a
  vendored copy of the log.

## Capabilities

### New Capabilities

_None._ This is a tooling/docs fix. It changes no observable runtime behavior,
and the existing `opencode-tui-bridge` requirement "Generated compatibility
report" already demands committed evidence. `.openspec.yaml` therefore sets
`skip_specs: true`.

### Modified Capabilities

_None._

## Impact

- **Edited files:** `bridge/compat/statuses.json`, generated
  `docs/compatibility.md`.
- **Unchanged:** `scripts/gen-compat.ts`, `scripts/check-links.sh`,
  `.gitignore`, `bridge/test/**`, the bridge source, and all specs.
- **Risk:** low. One evidence path changes. If the chosen test is renamed or
  its list assertion is removed, `bridge/test/crosscheck.test.ts` catches a
  missing file and the clean-checkout link check catches the stale link.
