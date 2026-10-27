# Design

## Context

See `proposal.md` for why these fixes are planned now. The prior audit was
re-run against `a1c05e9`; the table below is the verification record that drives
the task list. Status is `ACTUAL` (the defect is present), `PARTIAL` (part of
the surface is already correct), or `FIXED` (none remain). Ten findings are
actual, two are partial, and one (finding 8) was fixed by `dd0d032` after the
baseline.

| # | Finding | Status | Current evidence | Smallest fix |
|---|---|---|---|---|
| 1 | Bridge accepts cross-site requests | ACTUAL (WS part PARTIAL) | `bridge/src/bridge.ts:1449-1466` parses the body with no origin check; `:1454-1462` upgrades the PTY socket; `:329` accepts a caller-supplied `ses…` id; `:454` runs the shell; `terminals.ts:154-158` also accepts no ticket. `/connect-token` itself requires `x-opencode-ticket: 1` (`bridge.ts:1298-1301`). | Reject browser-origin HTTP and WS requests before reading a body or upgrading; keep loopback bind and ticket behavior. |
| 2 | File, mention, edit, and VCS reads ignore a worktree | PARTIAL | `vcsInfo` (`bridge.ts:1227-1237`) and terminal cwd (`:1281`) resolve worktrees. `fsList` (`:1325-1343`) and `fsFind` (`:1415-1427`) always read `CANONICAL`; prompt attachments use `CANONICAL` (`:532-566`); edit-result diffs read `CANONICAL` (`:876-877`); `vcsReview` always passes `CANONICAL` (`:1243-1259`). | One root-aware resolver used by every one of these paths. |
| 3 | Bridge replay and session resources grow without bound | PARTIAL | `seenFrames` is an unbounded array (`bridge.ts:101`), pushed on every event (`:123`) and fully replayed (`:165`). Session DELETE (`:999-1006`) removes only the session; `frameChains` (`:851`), `editCalls` (`:861`), and the session's terminals (`terminals.ts:11,119-127`) survive. | Cap replay by frames and bytes; clear per-session maps and terminals on delete. |
| 4 | Git patch batches are unbounded | ACTUAL | `batch()` builds one `sh -c` string (`vcs.ts:30-34`); untracked stats add one command per file (`:225-227`); patches for every changed file are built before the budget is applied (`:269-291`). | Chunk commands into bounded execs and stop patch generation when the total budget is reached. |
| 5 | Dashboard leaks its token and serves reads unauthenticated | ACTUAL | Non-loopback bind requires *a* token but still mints one (`dashboard/src/server.ts:155-166`) and embeds it in `/` (`:417-420`, `page.ts:22-24,105`). Reads such as `/api/sandboxes` and `/api/projects` do not check it (`server.ts:280-363`); read-only mode still serves the token, so logs are reachable. A test codifies the behavior (`dashboard/test/server.test.ts:177-183`). | Require the token for the page and reads only on a non-loopback bind; validate `Host` in both modes; keep loopback behavior unchanged. |
| 6 | Partial upload records a false synced pair | ACTUAL | With a non-workspace destination, `lib/oss-core.sh:2614-2628` uploads only the source, then records the host manifest and a synced pair for the whole workspace; `write_synced_marker` also updates the project fingerprint (`:1138-1154`). | Record baseline, manifest, synced pair, and fingerprint only after a full workspace refresh. |
| 7 | `upload PATH` ignores `PATH` at the default destination | ACTUAL | `src=${1:-.}` (`lib/oss-core.sh:2573`); `refresh_sandbox_workspace` uploads `.` (`:1384-1404`); the non-workspace branch is the only one that uses `$src` (`:2611-2620`). | Treat only no path or `.` as a full refresh; copy an explicit subpath as-is with no state writes. |
| 8 | oskhs rounds cannot pass the helper sync gate | FIXED (`dd0d032`) | `oskhs/src/round.ts:103-119` runs `maki-oss run --no-sync` from an empty temp cwd with `MAKI_OSS_WORKDIR` at the task workspace; `oskhs/src/sandbox.ts:20` runs `maki-oss up` from the caller's cwd. The helper always registers (`lib/oss-core.sh:2239,2287`), always prepares (`:2288`), parks a nonempty workspace (`:1463`), writes a parked marker for `--no-sync` (`:1853-1857`), and fails the registry guard when the caller cwd is reused (`:1054-1059`). | An explicit helper mode for a caller-owned workspace; oskhs uses it for `up` and `run`. |
| 9 | One repository's MR branch is used for every repository | ACTUAL | `sandboxRound.ts:167` passes `branch: withMR[0]?.branchName`; `publish.ts:66-83` resolves one branch and force-pushes every repository to it. | Resolve the branch per repository and force only the repository that owns an existing MR branch. |
| 10 | Cancellation does not reach publication | ACTUAL | `sandboxRound.ts:157-172` calls `publish` without a signal; `publish.ts` has no signal; `gitlab.ts:47-51` calls `fetch` without one; `:116-121` sleeps between retries; `mirror.ts:15-17` runs git without one. | Thread the round signal through publish, Mirror, and GitLab; bound each call and check before each side effect. |
| 11 | Fork boundary can name a message that was not copied | ACTUAL | `bridge/src/history.ts:30-38` assigns `boundary = m.id` before skipping an incomplete assistant message. | Assign the boundary only after a message is copied. |
| 12 | Fish wrappers, install code, and completions drift | ACTUAL | `fish/functions/maki-oss.fish` and `opencode-oss.fish` are near-copies; `bin/maki-oss:510-580` and `bin/opencode-oss:393-463` duplicate install/uninstall; `maki-oss` completions omit `--env-from`; `opencode-oss` completions omit `--discard` and `--no-git-ignore`. | One shared fish wrapper and one core install/uninstall implementation; add the missing completion entries. |
| 13 | The default test command omits most suites and Mongo | ACTUAL | `Makefile:14-15` runs only `tests/run-tests.sh`; `test-bridge` and `test-oskhs` skip when `bun` is absent (`:19-34`); `oskhs/test/store.test.ts:9-12` skips without `OSKHS_TEST_MONGO_URI`; there is no CI configuration. | Add `make test-all` that fails on missing prerequisites and a GitHub Actions job with MongoDB. |

## Goals / Non-Goals

**Goals:**

- Close the two security holes without changing the sandbox trust boundary:
  no host mounts, no credentials through sandbox environment variables, no new
  egress endpoint.
- Make the audit's correctness fixes testable offline, with one command that
  proves the shell, bridge, dashboard, and oskhs suites and the Mongo store path
  all run.
- Keep the normal user-facing helper behavior unchanged; the new helper mode is
  explicit and used only by oskhs.

**Non-Goals:**

- Replacing the loopback bind with a general remote-access story. The bridge
  stays a local, single-project server.
- Adding an authentication framework, session cookies, or a user database to
  the dashboard.
- Reworking how Maki, OpenCode, Claude Code, or Codex run inside the sandbox, or
  changing provider/profile handling.
- Fixing unrelated audit items that were already fixed or that need product
  decisions (for example a full multi-user dashboard).
- Adding fish support to front-ends that do not ship a fish plugin today.

## Decisions

### 1. Bridge rejects browser-origin requests instead of adding a token

The bridge serves a native terminal client, not a browser application. The
native TUI sends no `Origin` header, while a browser page always sends one for
a cross-origin `fetch`, form POST, or WebSocket upgrade. The gate therefore runs
at the top of `handle()`, before the URL is routed, the body is read, or a
WebSocket is upgraded:

- reject any request with an `Origin` header;
- reject `Sec-Fetch-Site: cross-site` even when `Origin` is absent;
- answer `403` with no body and no side effect.

This blocks the reported attack (a page creating a session, running
`/shell`, or opening a terminal) without adding configuration the TUI does not
have. A bearer token would require every TUI invocation to learn a new secret;
an origin allowlist would still trust any page served from a loopback port.
Requests from non-browser clients that forge headers are outside the threat
model, as they can already run commands on the host.

The PTY ticket behavior is kept: `/connect-token` still requires its marker
header, and a ticket remains single-use. The gate is defense in depth for the
upgrade path, not a replacement for the unguessable `pty_` id.

### 2. Dashboard requires a token only when it is reachable remotely

The dashboard is normally a loopback convenience; requiring a token there would
break existing local workflows and tests for no security gain, because a local
process can read the token from the same page. The bind host decides:

- loopback bind: current behavior (page embeds the token, reads are open,
  mutations require the header);
- non-loopback bind: `/` requires `?token=…` before the bootstrap is rendered,
  API reads require `X-Dashboard-Token`, streams require `?token=`, and
  read-only mode still requires the token while rejecting every mutation.

`Host` validation is separate and always on. A loopback bind accepts only
loopback names and the configured port, which closes DNS rebinding even when a
local browser is tricked into resolving an attacker name to `127.0.0.1`. A
concrete non-loopback bind also accepts its own address; a wildcard bind cannot
enumerate the machine's names, so it accepts any hostname but still requires the
token. This is deliberately narrower than "trust the Host because the page has a
token": the token is exactly what a rebinding page would try to read.

### 3. One root-aware checkout resolver for session-scoped reads

`ProjectWorktrees` already knows the main checkout and its linked worktrees.
Add a resolver that returns the root containing a client directory, preferring
the most specific root, and falls back to `CANONICAL` for a host directory or an
unknown path. The resolver is used by:

- `fsList` and `fsFind` (list/search the checkout root, then map the client
  path relative to the requested base);
- prompt attachments and `file://` mentions (read under the session checkout);
- edit-result diffs (relative edit paths join the session directory, absolute
  paths stay absolute);
- `vcsReview` (base, status, and diff use the same directory rule as `vcsInfo`).

The client's `location.directory` in the response stays what the client named;
only the sandbox read root changes. A path outside every known root still
returns no entries, so a worktree session cannot read the host or another
checkout. This is a single resolver rather than five copies of the same
conditional, because the worktree set is dynamic and every copy would have to
stay in sync with it.

### 4. Replay and per-session resources are bounded, and git work is chunked

Replay is a reconnect aid, not a durable log. `seenFrames` gets two bounds: a
frame count and a total JSON byte count. Every push trims the oldest frames
until both fit. This is simpler than a ring buffer and keeps the existing
`data:`-only replay shape the TUI expects.

Session deletion becomes the single cleanup point: remove that session's frames
from the replay buffer, drop its `frameChains` promise and `editCalls` entries,
and remove every terminal whose `sessionID` matches. `editCalls` entries carry
their session id so this is possible; the map also gets a hard entry cap so an
aborted turn cannot grow it forever. The terminal's 2 MiB retained output stays
per terminal; deleting the session is what releases it.

VCS work is split at the exec boundary: `batch()` chunks a command list (by
count and script bytes) and runs the chunks in order. Patch generation processes
chunks only until the total patch budget is reached, then marks the remaining
files capped. This preserves the existing response shape and budgets while
removing the argv-size failure and the "build everything, then discard it"
cost.

### 5. A fork boundary is the last message actually copied

`forkFrom` highlights the last copied message. The incomplete assistant message
at the tail is skipped, so it must not be named. The fix moves the assignment
after the copy; if nothing is copied the boundary is undefined, which is the
honest answer for a fork with no visible history.

### 6. External workspace: already fixed by the caller-owned workspace mode

Finding 8 was fixed after the audit baseline by `dd0d032`
(`realign-oskhs-with-osa-core`): `MAKI_OSS_WORKSPACE=caller` makes `up` and
`run` keep no host-side session state (no registry, no session sync or parking,
no upload on create, no policy advisor), and oskhs already uses it with idle
stop off and without `--no-sync`. That change owns the helper-cli and
oskhs-round requirements for the mode, so this change adds no
`--external-workspace` flag, does not change oskhs's helper calls, and drops
its own spec deltas for them. `--no-sync` keeps its user-facing meaning.

### 7. Upload is either a full workspace refresh or a plain copy

The command has two different jobs and currently conflates them. The split is
by source and destination:

- **full refresh** — no path, or `.` at the workspace destination: capture the
  host baseline, prune files the previous refresh owned, upload the whole
  directory, run the init script, and only then record the manifest, synced
  pair, and fingerprint;
- **plain copy** — an explicit subpath at any destination, or any copy to a
  non-workspace destination: run `openshell sandbox upload SRC DEST` and write
  no baseline, manifest, marker, or fingerprint.

A parked workspace refuses plain copies even with `--discard`, because copying
into unrecovered output can destroy it; `--discard` is meaningful only for a
full refresh. A retained patch still produces a warning and remains available.
This is a deliberate behavior change for `upload notes.txt`: it now copies that
file, as its own success message always claimed, instead of refreshing the whole
tree.

### 8. MR branches belong to repositories, not to the round

`publish` currently receives one optional branch and applies it to every
repository. Replace that with a per-repository `branchName` on each
`PublishRepo`, sourced by project path from `taskRepositories`. For each
repository:

- an existing MR branch is pushed to and force-updated only for that repository;
- a repository without an MR gets a newly chosen branch; when several
  repositories have no MR, the same new branch name may be used for all of them,
  as today;
- `findOpenMR` and the `taskRepositories` update use that repository's branch.

The record shape is unchanged, so `reviewUpdate` continues to merge by
`projectPath`.

### 9. Cancellation is checked before side effects; in-flight calls are bounded

The round's `AbortSignal` is passed into collect, mirror refresh, publish,
GitLab calls, and git runs. `Ctx.run` already kills the local child on abort;
GitLab `fetch` gets the signal combined with a per-request timeout, and the MR
retry sleep becomes abortable. Before each push or MR creation the code checks
the signal; after a retry wait it checks again. A push already in flight may
still reach the remote, but no MR is created once the abort is observed.

Rolling back a completed push would require deleting refs on a remote and is
both racy and destructive; the chosen contract is "no new side effect after
abort", which is what a cancelled task actually needs. The worker still marks
the task cancelled and writes no result.

### 10. Fish code is shared, not copied

Add one fish helper function that resolves the repository binary and forwards
the command, parameterized by command name and environment override. The
`maki-oss` and `opencode-oss` functions become thin calls into it. Move
install/uninstall into `lib/oss-core.sh`, driven by `$PROGRAM` and a list of
entries, and delete the two copies. The completions stay per command (fish
completion is command-specific) but gain the flags the helpers actually accept.

This removes the class of defect where a fix lands in one front-end only. It
does not add fish support to Claude Code or Codex, which do not ship a fish
plugin today.

### 11. One test gate and one CI job

`make test` stays the fast stub-backed shell suite. `make test-all` requires
`bun` and `OSKHS_TEST_MONGO_URI`, runs the shell suite, the bridge, dashboard,
and oskhs suites, and fails on the first missing prerequisite instead of
printing a green skip. CI is a GitHub Actions job using the repository's Bun
setup, a MongoDB service, and the same `make test-all` command. Using the same
command locally and in CI prevents the two paths from drifting.

The Mongo store test keeps its `skipIf` guard for direct `bun test` runs; the
gate is what makes the skip impossible in the verification path.

## Risks / Trade-offs

- **Over-strict origin gate** → A future browser-based TUI or webview would be
  refused. Mitigation: document the rule in the bridge spec; a browser client
  would need an explicit, reviewed exception rather than a silent allow.
- **Dashboard behavior split by bind host** → A user who binds `0.0.0.0` now
  needs `?token=` for the page and a header for scripts. Mitigation: the
  existing token and log hints name the token; the loopback path is unchanged.
- **Wildcard bind Host check is weak** → `0.0.0.0` cannot enumerate legitimate
  hostnames, so only the token protects it. Mitigation: the token is required;
  users who need DNS-rebinding protection should bind a concrete address.
- **`upload PATH` behavior change** → Users accustomed to the old whole-tree
  refresh may be surprised. Mitigation: the success message already named the
  file; document the two modes and keep `upload .` as the full refresh.
- **In-flight push after cancel** → A branch may still appear remotely after a
  cancel. Mitigation: no MR is created after the abort, and the branch can be
  cleaned up by the next round or by hand; rolling back remote refs is more
  destructive than the problem.
- **Replay cap drops old frames** → A client that reconnects very late sees only
  the retained tail. Mitigation: the cap is generous (seconds of normal traffic)
  and the TUI refetches session state after reconnect.
- **Chunking adds exec round trips** → Large repositories may take slightly
  longer for the same work. Mitigation: chunk sizes are tuned to the existing
  transport cost; the budget stop removes far more work than chunking adds.
- **CI Mongo service availability** → The store suite fails if the service is
  not healthy. Mitigation: a health check gates the job, and the URI is passed
  explicitly.

## Migration Plan

1. Land the test gate first so every later change is verified by the same
   command locally and in CI.
2. Land the bridge, dashboard, helper, oskhs, upload, and fish fixes with their
   tests. No data migration is required: the upload change only avoids writing
   false state.
3. For a user who already has a project registered by `maki-oss up` from an
   oskhs server directory, the stale registry entry is harmless; normal
   sessions still refuse to share a sandbox owned by another path. Caller-mode
   `up` (`MAKI_OSS_WORKSPACE=caller`) does not add or rewrite an entry.
4. Existing parked markers remain valid. A partial upload into a parked
   workspace now refuses; the user uses the full `--discard` refresh, which is
   the existing recovery path.
5. Rollback is a normal revert: no schema or state-format change is introduced.
   The replay cap and per-repository branch map are in-memory/request-scoped.

## Open Questions

None. The remaining choices (exact replay limits, chunk sizes, and timeout
values) are constants with safe defaults and can be tuned during implementation
without changing the specs or the task breakdown.
