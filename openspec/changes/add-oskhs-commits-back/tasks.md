# Tasks

## 1. Collect

- [ ] 1.1 Sync: set the commit identity; return the host object ids it
      synced; worktree add with `-B task-<id>`; verify unit tests (identity
      config present, `-B` in the add script)
- [ ] 1.2 `oskhs/src/collect.ts`: auto-commit + `update-ref` + no-change
      detection + in-sandbox bundle with host-supplied prerequisites; verify
      against the local-sandbox runner with real git
- [ ] 1.3 Host side: download into a temp dir, `bundle verify`,
      `list-heads` check, fsck fetch into `refs/heads/oskhs/<id>`, summary
      via `diff --name-status -M`; verify unit tests for the edit/delete/
      rename case, agent commits kept, no changes, and a forged extra ref
- [ ] 1.4 Round + CLI: collect between Maki and worktree removal, only for
      `answer`; `--no-changes`; print `changes`; verify `make test-oskhs` and
      `bunx tsc --noEmit -p oskhs`

## 2. Live exit

- [ ] 2.1 Run a round asking Maki to edit `calc.py`, delete `data.txt`, and
      rename `README.md` to `README.txt`; verify the host branch's tree id
      equals the sandbox worktree's final tree id (captured before removal
      via a log line) and the name-status shows M, D, R; record in
      `evidence/collect-live.md`
- [ ] 2.2 Run a question-only round; verify `changes: null` and no new host
      ref
- [ ] 2.3 Verify no bundle remains in `/sandbox/.oskhs/out` and no
      `task-*` branch remains in the sandbox

## 3. Docs

- [ ] 3.1 `docs/oskhs.md` (changes back, host ref naming, trust checks) and
      roadmap B1.2 done; verify `scripts/check-links.sh docs/oskhs.md
      docs/roadmap.md` and `openspec validate add-oskhs-commits-back --strict`
