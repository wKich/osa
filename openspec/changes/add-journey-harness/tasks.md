# Tasks

## 1. Reference side spike

- [x] 1.1 Find how OpenCode 2.0.32 configures an OpenAI-compatible provider
  (package name, base-URL settings key) from the pinned source and the
  vendored `Config.ProviderEncoded` schema, and whether first use fetches
  anything over the network; record findings with citations in
  `evidence/provider-spike.md`. Verify by booting `opencode` in an isolated
  XDG home against a stub server on loopback and confirming one completion
  request reaches the stub, with no other outbound connection
  (`lsof -i -P` on the process during the run, logged in the evidence file).

## 2. Harness core

- [x] 2.1 Add `@xterm/headless` and `@xterm/addon-serialize` at pinned
  versions to `bridge/package.json`; verify `bun install --frozen-lockfile`
  succeeds after updating `bun.lock`.
- [x] 2.2 Implement `harness/mock-provider.ts` (design decision 3); verify a
  unit test streams a text turn and a tool-call turn in OpenAI chunk format
  and serves turns in order.
- [x] 2.3 Add the `FAKE_MAKI_SCRIPT` mode to `bridge/test/fake-maki.ts`;
  verify a unit test that the same turn list produces stream deltas, a
  permission-gated tool use, and a result, and that existing fake-maki tests
  still pass.
- [x] 2.4 Implement `harness/driver.ts` (Bun PTY, fused writes, `waitFor`
  with idle settling and bounded timeout) and `harness/render.ts`
  (headless xterm, 120×40 text screens); verify a test that drives
  `sh -c 'printf ...; read x; printf ...'` through a scripted wait and
  snapshot, and that a missing screen text fails with the step name.
- [x] 2.5 Implement `harness/normalize.ts` (design decision 6) with one unit
  test per token class and a test that a non-volatile difference survives.
- [x] 2.6 Implement `harness/diff.ts` and the verdict rule (design decision
  7); verify unit tests for `equal`, `differs`, `unreached`, accepted
  differences, and that `broken` cannot be accepted.
- [x] 2.7 Implement `harness/record.ts` and the reference isolation in design
  decision 4: fresh XDG/HOME/workdir, cleared provider env, loopback-only
  provider config; verify a test that the spawned env has no `*_API_KEY` or
  `OPENCODE_*` variable and that the config names only the loopback provider.

## 3. Targets and gate

- [x] 3.1 Add `make test-journeys` (gated like `test-ui`, skip message
  without `opencode`/`bun`); verify it exits 0 and changes no file with
  `opencode` removed from `PATH`.
- [x] 3.2 Extend `bridge/test/crosscheck.test.ts`: script checkpoint ids match
  the catalog; re-diffing committed snapshots reproduces each journey's
  status; every `maki-requests.jsonl` joins the measured route set. Verify
  each with a temporary bad edit that fails and names the journey or route,
  then `cd bridge && bun test` passes.

## 4. Pilots

- [x] 4.1 Write scripts for `send-prompt-stream-reply` and
  `allow-permission-once`; run `make test-journeys` twice and verify both
  runs produce byte-identical snapshots, then commit snapshots, diffs, logs,
  and the catalog status and evidence the target wrote.
- [x] 4.2 Write the script for `resume-session-history`; record it, and
  verify its verdict is committed with evidence and that
  `GET /api/session/{sessionID}/message` is now `reachable` in
  `bridge/compat/statuses.json` and listed as untriaged in the regenerated
  burndown.
- [x] 4.3 Triage each pilot's differences with the
  `discovering-tui-journeys` hand-off table and record the hand-offs in
  `evidence/pilot-triage.md` (defect entries or route-queue rows are recorded,
  not fixed); verify every differing checkpoint has exactly one hand-off.

## 5. Gate

- [x] 5.1 Run in one pass: `make test`, `make test-bridge`, `make compat`,
  `make lint`, `make test-journeys`, `openspec validate "add-journey-harness"
  --strict`; all exit 0, and `bun bridge/test/discovery.ts` followed by `git
  diff --exit-code bridge/defects.json` shows only defect entries recorded by
  task 4.3.
