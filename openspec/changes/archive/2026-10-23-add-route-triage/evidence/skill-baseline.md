# Skill baseline (RED) — route triage

Baseline run for design decision 6: a fresh subagent given the pre-change
`.claude/skills/running-feature-discovery/SKILL.md` and the triage prompt
below. Recorded verbatim; the expected failure is that `GET /api/vcs` is not
triaged as live work.

- Date: 2026-10-23
- Skill: `.claude/skills/running-feature-discovery/SKILL.md` at `cca6a69`
- Subagent session: `ses_e96ad067dffeHBQ9c4iAu5bPo3`

## Prompt

> You are working in the repository /Users/ki/Projects/experiments/maki-openshell.
>
> Read `.claude/skills/running-feature-discovery/SKILL.md` first, in full, and
> follow it as your instructions for this task.
>
> Task: triage the reachable `served-faked` routes `GET /api/vcs` and
> `GET /api/info` from `bridge/compat/statuses.json`.
>
> Do not edit any files. When you are done, reply with, for each route:
>
> - the decision/action you chose under the skill's triage rules,
> - the exact `statuses.json` fields you would write for it,
> - your rationale, in your own words,
> - the next hand-off (if any).

## Response (verbatim)

I read the skill in full, then grounded in `statuses.json`, `defects.json`, the iteration‑5 matrices, the vendored OpenAPI, and the bridge source. **No files were edited and no generators were run.**

Both routes are confirmed reachable by the current capture (`bridge/test/captures/tui-last-requests.jsonl` lines 1/22 for info, line 7 for vcs), and both fall through to `synthesize()` in `bridge/src/spec-answers.ts` — the bridge builds no state for them.

## `GET /api/info`

**Decision:** `accept` (deliberately faked; correct by design).

**`statuses.json` fields I would write** — current vocabulary: none. The row already carries `scope: reachable`, `blockedBy: none`, `evidence: bridge/test/fixtures/bridge-requests.jsonl`; the decision belongs in the change's evidence matrix as `accept` + one line. If the `fakeReason` encoding is in force, the exact row is:

```json
{ "route": "GET /api/info", "status": "served-faked", "scope": "reachable", "blockedBy": "none", "evidence": "bridge/test/fixtures/bridge-requests.jsonl", "fakeReason": "the TUI only compares the server version and warns on a mismatch, so the bridge must report itself as the pinned 2.0.32; pid/urls/paths describe an OpenCode server that does not exist inside the sandbox" }
```

**Rationale:** the only load-bearing field is `version`, and `spec-answers.ts:24-26,128` deliberately pins it to `PINNED_VERSION` precisely because a mismatch makes the TUI warn. The other fields (`pid: 0`, `urls: ["sample"]`, `paths.tmp: "sample"`) have no truthful counterpart — there is no OpenCode server in the sandbox to describe. Synthesized data here is *correct*, not a placeholder standing in for something implementable, so this is the one faked route where `accept` is the real answer rather than an evasion.

**Next hand-off:** none beyond the doc/matrix edit. Nothing to fix, nothing to test, no capability to open.

## `GET /api/vcs`

**Decision:** `accept` — but only because the skill's capability test blocks anything else.

**`statuses.json` fields I would write:** none, deliberately. Specifically **no `fakeReason`**: `branch.current: "sample"` is not correct-by-design (the TUI renders the branch in its location/project flow), so a reason justifying the fake would be false. **No `feature` link to `openapi-contract`** either — it would satisfy "verified, unblocked" and the crosscheck would then demand `served-live`, which would be a false claim: that feature covers body *shape*, not real branch state. So the row stays exactly as it is.

**Rationale:** the behavior the TUI wants (the real branch of the requested location) is missing, and the TUI does call the route. The blocker is the capability clause's "both pins support it": VCS is not in Maki's wire at `v0.6.4` (no git/vcs row in the wire matrix, nothing in `sdk_mode.rs`/`cli.rs`), so under the skill as written the route cannot enter the capability branch, and "a `served-faked` route with no feature row is a scope statement, not debt" closes the inquiry.

That is a real finding, not just a formality: a real answer is plausibly reachable without violating any invariant — the image ships `git` (`examples/maki-image/Dockerfile:25`), the project lives at `/sandbox/project`, and the bridge already reads sandbox state through its existing transport for `GET /api/fs/list`. Reading sandbox git state adds no host path, no bind mount, and no new transport. So the data source is the *sandbox*, which the skill's "both pins" wording does not admit as a source at all (design decision 4 names exactly this misreading, and design decision 6 predicts this baseline: vcs lands as accept).

**Next hand-off:** none under the current rules. Two recorded consequences:
- The decision is unsatisfiable in data as the file stands: "accept" with no field derives as `untriaged`, so `GET /api/vcs` stays in the burndown queue (`docs/compatibility.md:51`, queue currently 21). Accepting in the matrix while the report keeps saying untriaged is the gap `fakeReason`/`feature` exist to close.
- If the capability clause is broadened to admit sandbox-sourced data, this becomes a `capability` hand-off to `proposing-coverage-change` with a new feature row (e.g. real branch/`data.branch` for a requested location, `scope: reachable`, `blockedBy: none`) and the route linked via `feature`; the row would flip to `served-live` with the new test as evidence in the same change.

## Net effect on the scoreboard

No rows changed, no defects appended, no capabilities newly transcribed. Reachable fakes stay 21/21 untriaged: `info` is accept-able but unencodable without `fakeReason`, and `vcs` is genuine debt the triage table routes to `accept` because the capability test excludes the sandbox as a data source.

Skipped: I did not verify whether `openshell sandbox upload` ships `.git` into `/sandbox/project` (it filters by gitignore), which is what would decide whether real VCS data is available at all — that belongs to the capability change, not to this triage. Risk: `paths.tmp: "sample"` in the info payload is a relative path; if any TUI build ever writes temp files through it, the fake becomes a defect rather than a correct answer.

## Baseline check

`GET /api/vcs` was triaged `accept` under the old skill ("a `served-faked`
route with no feature row is a scope statement, not debt") and **not** as live
work: no feature row, no hand-off, no route change. RED confirmed.
