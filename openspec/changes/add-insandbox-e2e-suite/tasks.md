# Tasks

## 1. Harness

- [ ] 1.1 Create `tests/e2e/run.sh` in the shape of the existing harness: per-case functions, `RUN_ONLY` selection, named skip reasons, and a summary. Verify: `RUN_ONLY='test_nothing*' tests/e2e/run.sh` reports zero cases and exits 0.
- [ ] 1.2 Add the scope line to the summary: orchestration is covered; isolation, policy, egress, and credential brokering are not. Verify: a passing and a failing run both print it, and the suite's output contains no boundary verdict.
- [ ] 1.3 Start and stop the plane once per run, with its private `PATH` prefix and state root, and tear it down on any exit. Verify: after a failing run, no listener remains (`lsof -i` finds nothing on the recorded port).

## 2. Scripted agents

- [ ] 2.1 Add scripted `maki`, `opencode`, `claude`, and `codex` fixtures that edit, create, and delete files, print their working directory, and record their argument vector. Verify: running each twice produces identical changes and identical argv records.
- [ ] 2.2 Add failure variants: a non-zero exit, a slow child that can be signalled, and a no-op run. Verify: each is exercised by the case that needs it.

## 3. Session outcomes

- [ ] 3.1 Cover `up` then a run then outcome collection for each front-end, asserting workspace contents, registry entry, and markers. Verify: a case per front-end passes, and a deliberately broken plane run fails on the workspace assertion.
- [ ] 3.2 Assert the agent ran in the sandbox workdir. Verify: the case fails if the recorded working directory is anywhere else.
- [ ] 3.3 Cover `upload` and `download` explicitly, including a non-empty destination. Verify: the download round-trip case asserts content and refuses a silently empty result.

## 4. Caller mode

- [ ] 4.1 Cover `sync-in` then `collect-patch`, asserting the patch applies cleanly, the JSON file list and status letters, and no host `.git` metadata in the workdir. Verify: the case applies the patch to a scratch git tree and diffs the result.
- [ ] 4.2 Cover the empty patch and the missing-baseline refusal with their documented exit codes. Verify: both cases assert the exit codes and that no file is written on refusal.

## 5. Pending work and lifecycle

- [ ] 5.1 Cover `resolve` apply, branch, and drop, asserting the state tree and exit code for each. Verify: three cases, each asserting the pending marker's absence or presence afterwards.
- [ ] 5.2 Cover `rm` refused while work is pending, and succeeding once resolved. Verify: both cases assert the sandbox's existence and the message.
- [ ] 5.3 Cover `status`, `list`, `logs`, `doctor`, `policy`, `provider`, `start`, and `stop` against real plane state. Verify: each case asserts the observed phase or record, not just the exit code.

## 6. Interrupt and idle

- [ ] 6.1 Interrupt a running session, then assert no lock remains, pending work is listed, and a following session starts. Verify: the case fails if the lock file survives or the next run refuses.
- [ ] 6.2 Cover idle stop with the shortest documented idle value and assert the observed phase change. Verify: state-polling with a bounded deadline, no fixed sleep as the assertion.

## 7. Determinism and offline

- [ ] 7.1 Run one case twice and compare normalized artifacts. Verify: the two artifact trees are byte-identical after normalization.
- [ ] 7.2 Run the suite with egress unavailable. Verify: every case completes and none reports a network error.
- [ ] 7.3 Add any stable-only-on-the-plane case to an exclusion list with a stated reason, and report the count. Verify: the summary prints recorded, excluded, and not-applicable counts.

## 8. Real-agent smoke

- [ ] 8.1 Add the one opt-in real-agent case: a single headless turn, asserted only as a successful exit and a changed workdir. Verify: with no provider attached the case is skipped by name with its reason.
- [ ] 8.2 Confirm the case cannot alter the verdict. Verify: a run with the case skipped and a run with it forced report the same overall outcome when every other case passes.

## 9. Host comparison

- [ ] 9.1 Record the scenario set once on a host against a real gateway and commit the normalized transcripts. Verify: the recorder reports no credential value in any transcript.
- [ ] 9.2 Compare the in-sandbox run with those transcripts through the parity mechanics. Verify: a matching run reports identical; a deliberately altered plane operation reports the case and field and exits non-zero.

## 10. Targets and documentation

- [ ] 10.1 Add `make test-e2e-local` and `make test-e2e`, each skipping cleanly with a named reason, and neither joining `make test`. Verify: `make test` runs unchanged; each target prints its skip reason when its prerequisites are absent.
- [ ] 10.2 Document the suite and point at the claim table. Verify: `scripts/check-links.sh` passes and the page states the layer the suite covers.
