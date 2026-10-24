# Tasks

## 1. Pin and fix the prompt-delivery regression

- [ ] 1.1 Reproduce `send-prompt-stream-reply` against the current bridge and
  record the Maki-side final screen and frames beside the journey. Verify:
  `maki-frames.jsonl` shows a complete turn and the `streamed` checkpoint has
  no assistant text; the failure is recorded, not inferred.
- [ ] 1.2 Add an `inbox-delivery-not-emitted` entry to
  `bridge/defects.json` with the journey capture and a desired golden. Verify:
  `bun bridge/test/discovery.ts` names the entry and
  `bridge/test/crosscheck.test.ts` pairs its expected-failure marker.
- [ ] 1.3 Emit `session.inbox.delivered` in the common turn-start path (not
  only for a queued turn) in `bridge/src/translator.ts`. Verify: a golden or
  session test shows `enqueued -> delivered -> text` for an immediately
  started prompt, and `cd bridge && bun test` passes.
- [ ] 1.4 Close the defect and restore the affected feature rows:
  `bridge/defects.json` status `fixed` with no expected-failure marker,
  `transcript-order` and `stream-deltas` back to `verified` with the new test
  or journey evidence. Verify: discovery prints `ok`, crosscheck passes, and
  `make compat` is regenerated.
- [ ] 1.5 Re-record the pilot and verify the `streamed` checkpoint renders
  `PONG`; the journey no longer fails for a missing reply.

## 2. Make the harness production-shaped and self-explaining

- [ ] 2.1 Confirm the `add-journey-harness` harness core is present
  (`record.ts`, `driver.ts`, `render.ts`, `normalize.ts`, `diff.ts`); if not,
  apply that change's harness core first. Verify:
  `cd bridge && bun test test/journeys` passes.
- [ ] 2.2 Run the Maki side with `OPENMAKI_CWD` = the journey workdir and
  `MAKI_MODEL` = the scripted model. Verify: the Maki snapshot footer has no
  repository branch and the model line names the scripted model before
  normalization.
- [ ] 2.3 Derive model labels from the actual `/api/model` and `/api/provider`
  responses instead of the hardcoded `makiModels` list. Verify: a unit test
  normalizes the reference and Maki model lines to the same `<MODEL>` tokens,
  and a wrong model still survives as a difference.
- [ ] 2.4 Assert `opencode --version` equals
  `bridge/compat/journeys.json.pin.opencode` before either side starts.
  Verify: a fake `opencode` wrapper reporting another version aborts with both
  versions named and no catalog change.
- [ ] 2.5 Pass the journey row's `acceptedDiffs` into `diffCheckpoints` by
  checkpoint id. Verify: a unit test accepts a documented difference and a
  missing reason still yields `diverges`.
- [ ] 2.6 Save the final screen and the error for an unreached checkpoint
  beside the journey evidence. Verify: a forced timeout writes the checkpoint
  screen and error, and `diff.json` names the checkpoint `unreached`.
- [ ] 2.7 Introduce a harness-failure path for version mismatch, bridge boot
  failure, missing binary, and PTY failure. Verify: each aborts non-zero and
  leaves `bridge/compat/journeys.json` unchanged; a step timeout still records
  `broken`.
- [ ] 2.8 Remove the `/tmp` debug copy and any other out-of-tree writes from
  `record.ts`. Verify: a run leaves no file outside the journey directory and
  its scratch root.
- [ ] 2.9 Make the fake Maki script mode consume one turn per prompt (or a
  turn cursor) instead of replaying the whole script on every prompt. Verify:
  a two-prompt fixture emits each turn exactly once.
- [ ] 2.10 Run each pilot twice and verify byte-identical reference and
  Maki-side snapshots and diffs. Verify: `git diff --exit-code` on the
  journey directories after the second run.

## 3. Make the journey the report's oracle

- [ ] 3.1 Add a reverse journey link to the report: each `verified` feature
  lists the reachable journeys that exercise it and is labeled
  `journey-verified` or `unit-verified only`. Verify:
  `bun scripts/gen-compat.ts` renders the column from
  `journeys[].features`.
- [ ] 3.2 Enforce the oracle in `crosscheck.test.ts`: a feature listed by a
  `broken` journey, or by a `diverges` journey without an accepted difference,
  cannot be `verified` unless it is `buggy` with an open defect or the report
  marks it unit-verified only. Verify: temporary bad rows fail with the
  feature and journey named.
- [ ] 3.3 Re-triage the pilot's features and routes: `transcript-order` and
  `stream-deltas` are `buggy` while the defect is open, then `verified` after
  the fix; any route the pilot calls but the captures miss becomes reachable.
  Verify: `crosscheck` and `bun scripts/gen-compat.ts --check`.
- [ ] 3.4 Record the accepted session-title difference with a written reason
  in the journey row, and verify the report prints the reason. Verify: the
  row is not `parity` while an unaccepted difference remains.
- [ ] 3.5 Re-record `send-prompt-stream-reply`, `allow-permission-once`, and
  `resume-session-history`; update their statuses and evidence truthfully.
  Verify: `make test-journeys` completes and the offline re-diff matches each
  committed status.
- [ ] 3.6 Add every `bridge/test/journeys/*/maki-requests.jsonl` to the
  measured route set. Verify: a route only a journey calls becomes `reachable`;
  `GET /api/session/{sessionID}/message` enters the route queue from the
  `resume-session-history` log.
- [ ] 3.7 Regenerate `docs/compatibility.md` and verify `make compat` exits 0
  with the journey and feature lenses consistent.

## 4. Wire the offline gate

- [ ] 4.1 Add `make test-journeys`, gated on `opencode` and `bun` like
  `make test-ui`. Verify: without `opencode` it prints a skip and exits 0
  without changing a file; with it, the three scripts record.
- [ ] 4.2 Extend `crosscheck.test.ts` to re-diff every committed journey
  snapshot and assert the row's status. Verify: a temporary status edit fails
  and names the journey and checkpoint.
- [ ] 4.3 Check each script's checkpoint ids against its catalog row, in
  order, including the planned step index. Verify: a temporary bad script
  fails and names the journey and checkpoint.
- [ ] 4.4 Check accepted differences and report labels against the journey
  status. Verify: a temporary accepted diff without a reason fails.
- [ ] 4.5 Verify the default offline suite still touches no gateway, Docker,
  network, or credential: `make test`, `make test-bridge`, `make compat`, and
  `make lint` in one pass.

## 5. Update the discovery skills

- [ ] 5.1 Update `.claude/skills/discovering-tui-journeys/SKILL.md`: the
  journey is the oracle, a golden is not native proof, a broken journey is
  triaged before coverage, harness fidelity and failure evidence are required,
  and the live smoke comes before scaling. Verify: the skill states each rule
  and its status machine matches `journeys.json`.
- [ ] 5.2 Update `.claude/skills/running-feature-discovery/SKILL.md`: the done
  condition includes zero broken or diverging reachable journeys without an
  accepted difference, and the report separates unit-only from
  journey-verified features. Verify: the finish checklist names both.
- [ ] 5.3 Update `.claude/skills/proposing-coverage-change/SKILL.md`: a
  capability slice that changes event shapes or ordering includes a journey or
  journey-level test; a unit-only row is labeled as such. Verify: the process
  and rules name the journey evidence.
- [ ] 5.4 Update `.claude/skills/proposing-fix-change/SKILL.md`: a defect
  names the journey checkpoint that exposed it, and a TUI-visible fix re-runs
  the journey and records the new status. Verify: the process and rules name
  the journey re-run.
- [ ] 5.5 Cross-check the four skills for contradictions with
  `docs/compatibility.md`, `bridge/compat/journeys.json`, and
  `scripts/gen-compat.ts`. Verify: a manual pass finds no rule that still
  treats a route/feature count as native.

## 6. Live smoke and wrap-up

- [ ] 6.1 Run one real-Maki smoke in a throwaway sandbox: one scripted prompt,
  one streamed reply, and the bridge's `openshell sandbox exec` transport.
  Verify: the TUI renders the reply; the evidence records the Maki and image
  versions; no sandbox is left behind and no egress, provider, or credential
  is added.
- [ ] 6.2 Reconcile the change with `add-journey-harness` and
  `add-journey-live-run`: apply the harness core first and this change as the
  corrective pass, or fold these tasks into that change. Verify: no duplicate
  or contradictory task remains in the two open changes.
- [ ] 6.3 Run the full gate in one pass: `make test`, `make test-bridge`,
  `make compat`, `make lint`, `make test-journeys` (when `opencode` is
  present), and `openspec validate "fix-journey-oracle" --strict`; all exit 0.
- [ ] 6.4 Note the archive-path rewrite for any statuses evidence that points
  into this change directory, so archiving does not leave a dead link.
  Verify: `openspec validate --archived` after the archive.
