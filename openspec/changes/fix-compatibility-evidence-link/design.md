# Design

## Context

See `proposal.md` — Why. The mechanics that shape the fix:

- `scripts/gen-compat.ts` renders every route row's `evidence` string as a
  relative Markdown link (`docs/compatibility.md:39` today). The only source of
  truth is `bridge/compat/statuses.json`; the Markdown is a build product.
- `.gitignore:3` ignores `*.log` repository-wide. `git check-ignore -v` confirms
  the `api-check.log` path is excluded, and `git ls-files` shows the rest of the
  archive's `evidence/` directory is tracked (`.jsonl`, `.txt`, `.md`, and the
  harness sources). The `.log` is a local run artifact.
- `bridge/test/crosscheck.test.ts` validates every evidence path with
  `existsSync`, so it passes on a working tree that still holds the ignored log.
  It is therefore not the oracle for this class of rot; a clean checkout is.
- `scripts/check-links.sh <path>` resolves each relative link from the linking
  file's directory against the filesystem. Run against a fresh worktree, it
  fails today with `FAIL docs/compatibility.md: relative link ... -> ...`.
- Candidate tracked targets for the row:
  - `bridge/test/model-switch.test.ts` — its model-switch test fetches
    `GET /api/session` and asserts the listed entry carries the model the
    scripted child acknowledged (L86–L87). That is live state, not a synthesized
    payload, and the file is already evidence for the
    `mid-session-model-switch` feature, so it adds no new coupling.
  - `bridge/test/session-title.test.ts` — also asserts the list contains the
    created session, with its live title (L44–L46). An equivalent alternative.
  - `bridge/test/session-api.test.ts` — the canonical session suite, but its
    `GET /api/session` check only asserts a 2xx among boot routes. That is
    weaker than the row's `served-live` claim unless a list assertion is added.
  - `bridge/test/fixtures/bridge-requests.jsonl` — tracked capture, but it has
    no list call (only session-by-id, permission, and form reads), so it cannot
    back this row.
  - The archive's `api-check-frames.jsonl` — tracked, but it is the harness's
    frame log, not the list-response check. Wrong evidence.

## Goals / Non-Goals

**Goals:**

- Every relative link in `docs/compatibility.md` resolves from a checkout that
  contains only tracked files.
- The `GET /api/session` row keeps its `served-live` status and its evidence
  continues to prove real state.
- The change reaches the minimum files: the status source and its generated
  report.

**Non-Goals:**

- Changing the bridge, the generator, the tests, or `.gitignore`.
- Committing the log, un-ignoring `*.log`, or copying the log into a tracked
  name.
- Making `crosscheck.test.ts` require tracked paths (`git ls-files`) or adding
  CI. Both are useful hardening but not needed to fix this link; see Open
  Questions.
- Auditing every other evidence path; the clean-checkout link run covers the
  generated page.

## Decisions

### Decision: use `bridge/test/model-switch.test.ts` as the row's evidence

It is the closest tracked proof of the claim the archived log made ("list
contains the owned session") and, unlike a 2xx smoke check, it asserts the list
returns the live state the child acknowledged. `session-title.test.ts` is an
equally valid fallback; `session-api.test.ts` would need a new assertion before
it could carry a `served-live` claim, which would widen a tooling/docs fix into
test work. Rejected alternatives:

- **Commit the log / un-ignore `*.log` / rename it to `.txt`.** Forces a
  transient run artifact into history and either widens the ignore rule or adds
  a misleading tracked copy. The archive is the historical record; the current
  evidence should point at durable verification.
- **Hand-edit `docs/compatibility.md`.** The file is generated; `make compat`
  would overwrite the edit and fail its drift gate.
- **Point at `bridge/test/session-api.test.ts` without changing it.** The link
  would resolve but the evidence would be weaker than the `served-live` label.
- **Drop the link / blank the evidence.** Violates the generator's "every row
  must carry an evidence key" and removes audibility.

### Decision: edit the source, regenerate the report

Change only the one `evidence` value in `bridge/compat/statuses.json`, then run
`bun scripts/gen-compat.ts` (or `make compat`) and commit the regenerated
`docs/compatibility.md`. The generator already escapes and relativizes paths;
no generator change is needed. `make compat` is the drift gate and must pass on
the staged/committed report.

### Decision: verify in a fresh Git worktree, not the working tree

`git worktree add --detach <tmp> HEAD` materializes only tracked files at the
commit, which is exactly the clean-checkout condition. Running
`scripts/check-links.sh docs/compatibility.md` there reproduces the failure
before the fix and proves it after. Scanning only the generated page avoids
network dependency from unrelated external links.

### Decision: no spec delta (`skip_specs: true`)

`openspec/specs/opencode-tui-bridge/spec.md` already requires every enumerated
row's evidence to be a committed artifact that exists in the repository. This
change brings one row into compliance; it does not change the requirement. A
spec delta would restate existing behavior.

## Risks / Trade-offs

- **The chosen test is refactored or renamed** → the link rots again.
  `crosscheck.test.ts` flags a missing evidence file on the next local run, and
  the clean-worktree link check catches it before publication. The path is
  already cited by the `mid-session-model-switch` feature, so it is a durable
  target rather than a new dependency.
- **`make compat` is run before the report is staged** → it exits non-zero on
  `git diff --exit-code` even though regeneration succeeded. Mitigation: run
  `bun scripts/gen-compat.ts --check` as the immediate check, then stage both
  files and run `make compat` (or run it after the commit).
- **No CI runs `check-links.sh`** (the repository has no `.github/`) → the
  clean-checkout run is a manual gate. Mitigation: keep it in the task list and
  in this change's verification record; a future CI job can adopt the same
  command.
- **`make compat-drift` needs bun and an installed `opencode`** → it may skip.
  It is not a gate for this evidence-only change; a skip is acceptable and
  should be reported as such.

## Migration Plan

1. Reproduce: create a detached worktree at the current HEAD and run
   `scripts/check-links.sh docs/compatibility.md`; it fails on the
   `api-check.log` target.
2. Edit the single `GET /api/session` row in `bridge/compat/statuses.json` so
   `evidence` is `bridge/test/model-switch.test.ts`.
3. Regenerate: `bun scripts/gen-compat.ts`; inspect `git diff
   docs/compatibility.md` and confirm only that row's Evidence cell changed.
4. Stage both files, then `make compat`; it exits 0 (regeneration is a no-op and
   the drift diff is clean).
5. Run the offline evidence check and the clean-worktree link check.
6. Remove the temporary worktree and merge normally.

**Rollback:** `git revert <commit>` (or
`git checkout <previous> -- bridge/compat/statuses.json docs/compatibility.md`).
That restores the broken link and is only appropriate if the chosen evidence is
rejected; no runtime state, data, or deployed service is involved.

## Open Questions

- Should `crosscheck.test.ts` verify that evidence paths are tracked (for
  example `git ls-files --error-unmatch`), so a locally ignored file cannot
  satisfy the committed-artifact rule? Deferred: the clean-checkout link run is
  the oracle for this change, and tightening the suite is a separate
  hardening task.
