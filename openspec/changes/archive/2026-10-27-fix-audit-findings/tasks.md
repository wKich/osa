# Tasks

## 1. Test gate

- [x] 1.1 Add `make test-all` that requires `bun` and `OSKHS_TEST_MONGO_URI` and runs `tests/run-tests.sh`, the bridge suite, the dashboard suite, and the oskhs suite; verify it exits non-zero naming the missing prerequisite when either is absent, and exits 0 with all suites when both are present.
- [x] 1.2 Add a GitHub Actions workflow that installs Bun and the bridge/oskhs dependencies, starts a MongoDB service with a health check, sets `OSKHS_TEST_MONGO_URI`, and runs `make test-all`; verify the YAML parses and the job invokes the same command.
- [x] 1.3 Make the oskhs store tests run under the gate instead of skipping; verify the gate output includes the `MongoTaskStore` tests and no `store: skipped` line.

## 2. Bridge request gate

- [x] 2.1 Reject requests carrying an `Origin` header or `Sec-Fetch-Site: cross-site` at the top of `handle()`, before routing, body reads, or WebSocket upgrades; verify a new bridge test gets 403 for foreign-origin `POST /api/session`, `/api/session/<id>/shell`, the terminal route, and the PTY upgrade, and gets the normal response for a headerless request.
- [x] 2.2 Require a live session for `POST /api/experimental/session/{sessionID}/terminal`; verify a test posts an unknown session id, gets 404, and no terminal appears in the list or snapshot routes.

## 3. Bridge checkout routing

- [x] 3.1 Add a root-aware checkout resolver to `ProjectWorktrees` and use it in `fsList` and `fsFind`; verify a worktree test lists a worktree-only file and does not list a main-checkout-only file.
- [x] 3.2 Use the resolver for prompt attachments, `file://` mentions, edit-result diffs, and `vcsReview`; verify tests read a worktree file with the same relative path as a different main-checkout file, produce a worktree edit diff, and return the worktree's VCS changes.

## 4. Bridge memory and VCS work

- [x] 4.1 Bound the SSE replay buffer by frame count and total bytes and trim oldest frames on every push; verify a test emits more than the bound, reconnects, and receives only the retained frames while the buffer stays within both limits.
- [x] 4.2 Clear a deleted session's replay frames, frame chain, edit calls, and terminals; verify a test deletes a session with a live terminal, gets 404 for its snapshot afterwards, and sees no replay frames for that session.
- [x] 4.3 Chunk git command batches by count and script bytes and stop patch generation when the total patch budget is reached; verify a large-repository test observes more than one bounded exec, returns status for every file, and marks later patches capped without generating them.

## 5. Bridge fork boundary

- [x] 5.1 Assign the fork boundary only to a message that was copied; verify a test forks a parent whose tail is an incomplete assistant message and asserts the boundary names the preceding copied message.

## 6. Dashboard access control

- [x] 6.1 Validate the `Host` header on every request: loopback names only on a loopback bind, the configured address on a concrete bind, and any host on a wildcard bind; verify a loopback test with `Host: evil.example` gets 403 before the page or any API route is served.
- [x] 6.2 Require `?token=` for the page and streams and `X-Dashboard-Token` for API reads on a non-loopback bind; verify a test binds a wildcard host, gets 403 with no token in the body for `/` and `/api/sandboxes`, and gets the page or data with the correct token.
- [x] 6.3 Keep read-only mode refusing every mutation while requiring the token for remote page, reads, and logs; verify a remote read-only test gets 403 for an unauthenticated log stream and a mutation, and 403 for a mutation even with the token.
- [x] 6.4 Update the existing dashboard tests and `dashboard/README.md` for the loopback/remote split; verify `cd dashboard && bun test` passes.

## 7. External workspace mode

- [x] 7.1 Confirm finding 8 is already fixed by `dd0d032` (`MAKI_OSS_WORKSPACE=caller`, owned by `realign-oskhs-with-osa-core`) and that oskhs `ensureSandbox` and `runMaki` use it; no `--external-workspace` flag is added; verify `cd oskhs && bun test test/round.test.ts test/sandbox-round.test.ts test/core.test.ts` passes.

## 8. Upload semantics

- [x] 8.1 Split `upload` into a full workspace refresh (no path or `.`) and a plain copy (explicit subpath or non-workspace destination); verify a shell test uploads `notes.txt` at the default destination, sees only that file copied, and sees no synced marker or fingerprint written.
- [x] 8.2 Refuse a plain copy into a parked workspace even with `--discard`, and allow `--discard` only for a full refresh; verify shell tests keep the parked marker after the refused partial copy and clear it after `maki-oss upload . --discard`.
- [x] 8.3 Update `docs/helper.md` and any upload usage text for the two modes; verify the documented examples match the tests and the success messages no longer claim a baseline for plain copies.

## 9. oskhs publishing and cancellation

- [x] 9.1 Resolve the MR branch per repository in `publish` and `sandboxRound`; verify a two-repository follow-up test pushes `g/a` to its own branch and `g/b` to its own branch and updates both `taskRepositories` entries.
- [x] 9.2 Thread the round signal through collect, mirror refresh, publish, GitLab requests, and retry waits, and bound each GitLab call with a timeout; verify tests abort before publish, abort during a mirror refresh, and abort during an MR retry, and see no second request or MR creation after the abort.
- [x] 9.3 Verify the worker still marks a cancelled round cancelled and writes no result while publication is aborted; run `cd oskhs && bun test test/worker.test.ts test/publish.test.ts`.

## 10. Fish integration

- [x] 10.1 Replace the two near-copy fish functions with one shared resolver parameterized by command name and environment override; verify `fish -n` on the plugin files and a fish test that both `maki-oss` and `opencode-oss` resolve and print usage.
- [x] 10.2 Move fish install/uninstall into `lib/oss-core.sh` and delete the per-front-end copies; verify shell tests install both front-ends twice, report idempotence, and leave a foreign function file untouched on uninstall.
- [x] 10.3 Add the missing completion entries (`--env-from` for `maki-oss`, `--discard` and `--no-git-ignore` for `opencode-oss`) and the missing help flag; verify a fish completion test lists each flag after `run --` or `upload --`.

## 11. Final verification

- [x] 11.1 Run `OSKHS_TEST_MONGO_URI=… make test-all` with a reachable MongoDB and record the shell, bridge, dashboard, oskhs, and Mongo test results; verify the command exits 0 with no skipped suite.
- [x] 11.2 Run `make lint`, `fish -n` on `fish/functions` and `fish/completions`, and `openspec validate fix-audit-findings --strict`; verify all pass.
- [x] 11.3 Re-check the security invariants in the changed code and docs: no bind mount, no credential value through `--env`/`--env-from`, no new egress endpoint, and no literal placeholder spelling; verify with a targeted grep and the existing isolation checks.
