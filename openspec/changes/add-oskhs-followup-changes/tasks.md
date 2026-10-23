## 1. Implementation

- [x] 1.1 `reportedNoChanges` / `claimsChanges` from the result block (kiss's flags)
- [x] 1.2 Follow-ups on tasks without an MR run as code rounds; no-changes rounds publish nothing
- [x] 1.3 Worker: a follow-up's MRs move the task to `review` (replyMessage cleared); later follow-ups see the MR
- [x] 1.4 Follow-ups on an open MR push onto its branch with commit links; merged/closed MRs answer with kiss's warning
- [x] 1.5 Tests: follow-up opens the first MR; follow-up commits onto an open MR; merged MR warns; no_changes with edits publishes nothing
- [x] 1.6 docs/oskhs.md

- [x] 1.7 MR creation retries GitLab's late-branch 400 with kiss's delays

## 2. Verification

- [x] 2.1 `bun test`, lint, `openspec validate --strict`
- [x] 2.2 Live: a follow-up "save it to a file" in the dev channel opens an MR linked in the thread
