# Proposal

## Why

The inherited audit's findings were re-checked against the current `osa` tree at `a1c05e9`: eleven are still actual and two are partially fixed. Two are security holes (the bridge accepts cross-site requests; the dashboard hands its token to any caller), and the oskhs worker still cannot run a real round because `maki-oss run --no-sync` parks its external workspace before Maki starts. The remaining items are upload/sync correctness, bridge memory and worktree routing, cancellable publishing, per-repository MR branches, a fork boundary bug, duplicated fish installation, and a test gate that omits every Bun suite and the Mongo tests.

The project has moved on since the first review (shared `osa` state, a project registry, Claude Code and Codex front-ends, dashboard project actions), so the fixes must be recorded against the current specs before code changes begin.

## What Changes

- **Bridge access control.** Reject HTTP and WebSocket requests that carry a browser `Origin` header or `Sec-Fetch-Site: cross-site`, so a visited web page cannot create a session or run a sandbox shell. Keep the loopback-only bind and the existing no-`--env` transport.
- **Dashboard token confidentiality.** On a non-loopback bind, require the token before serving the page or any read route, and validate `Host` so a rebound DNS name cannot read the token or mutate the gateway. Read-only mode keeps gating logs with the token and still refuses every mutation.
- **External workspace round.** Already fixed after the audit baseline by `dd0d032` (`MAKI_OSS_WORKSPACE=caller`, change `realign-oskhs-with-osa-core`); no change here.
- **Publishing correctness.** Give each changed repository its own MR branch (no shared `withMR[0]` branch and no force push to another repo's branch), and pass cancellation through collect, mirror, publish, GitLab requests, and retry sleeps so a cancelled task starts no new push or MR after the abort.
- **Upload correctness.** `upload PATH` sends `PATH` even when the destination is the default workspace; only a whole-workspace refresh records the synced pair and fingerprint. A partial copy-in never claims the workspace is current.
- **Bridge quality and memory.** Resolve file, mention, and VCS reads against the session's checkout (main worktree or a known worktree); cap SSE replay and release a deleted session's maps and terminals; chunk git patch batches so large repositories do not exceed the exec argument limit; record a fork boundary only on a message that was copied.
- **Fish and verification.** Share the fish install/uninstall and wrapper code across front-ends, add the missing completion flags, and add one verification gate (`make test-all` plus CI with a Mongo service) that runs the shell, bridge, dashboard, and oskhs suites.

## Capabilities

### New Capabilities

- `test-gate`: one repository-level verification command and CI job that runs every offline suite and the Mongo-backed store tests.

### Modified Capabilities

- `opencode-tui-bridge`: request access control, session-checkout routing for file/VCS routes, bounded SSE replay and session cleanup, chunked VCS batches, and a fork boundary that names a copied message.
- `dashboard`: token confidentiality and authenticated remote reads, Host validation, and read-only stream gating.
- `oskhs-round`: per-repository MR branches, and cancellation that reaches collect/publish/mirror work.
- `oskhs-worker`: cancellation must stop external publication, not only result writes.
- `helper-cli`: `upload PATH` semantics and partial-upload baseline safety.
- `fish-integration`: install/uninstall and completions for every front-end, including the missing flags.

## Impact

- `bridge/src/bridge.ts`, `history.ts`, `vcs.ts`, `mentions.ts`, `sandbox.ts`, `terminals.ts`, and their tests.
- `dashboard/src/server.ts`, `page.ts`, `app.js`, and `dashboard/test`.
- `lib/oss-core.sh`, `lib/osa-state.sh`, `bin/*-oss`, `oskhs/src/round.ts`, `kiss/sandboxRound.ts`, `kiss/publish.ts`, `kiss/gitlab.ts`, `kiss/mirror.ts`, `worker.ts`, and oskhs tests.
- `fish/functions`, `fish/completions`, `bin/maki-oss`, `bin/opencode-oss`, and the shell test suite.
- `Makefile`, a new CI configuration, and `oskhs/test/store.test.ts` wiring.
- No new host bind mounts, no secrets through sandbox environment variables, no new egress endpoints, and no new runtime dependencies.
