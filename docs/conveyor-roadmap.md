# Roadmap: Conveyor as the sandboxed orchestration layer

Planning document. Conveyor-side work happens in the Conveyor repository
(`/Users/ki/Projects/kontur/conveyor.ai`); this document is the cross-repo
plan. Paths under `src/Conveyor.*` and `web/` refer to that repository.
Sandbox-side work lands here. Implementation goes through OpenSpec changes,
one per slice; nothing here ships without its spec delta.

**Status:** draft, 2026-10-26. Research basis: Conveyor commit `d1838c6`,
OpenShell v0.1.5, Maki v0.6.5 (headless and ACP docs read 2026-10-26).
Item IDs (`C`, `W`, `D`, `R`) are stable references.

Companion: [roadmap.md](roadmap.md) covers maki-oss sessions and kiss
orchestration; this track does not change its items.

## Why this track

Conveyor's runner is the closest match among the surveyed tools: an
outbound-only worker runs agents in git worktrees, streams events to a
server, and leaves results as a GitLab branch/MR. The sandbox is the
runner's machine, so there is no host bind mount, no SSH relay, and no
host-side agent process. The web UI is role-scoped — developer, analyst,
tester, project manager — which is the non-technical UX none of the coding
ADEs provide.

The cost is that Conveyor was built for a trusted developer laptop. This
track converts "runner machine" into "OpenShell sandbox" without weakening
either product's security model.

## Target goals

- **G1 — Sandbox is the runner.** A Conveyor task executes entirely inside
  an OpenShell sandbox: clone, worktree, agent, self-check, diff, commit,
  push. The host never sees a repository path.
- **G2 — No new secret inside the sandbox.** The runner token, git push
  credential, and model keys reach the sandbox only as provider-profile
  stand-ins bound to narrow hosts and paths. Conveyor's GitLab API token
  stays on the API server.
- **G3 — Role workflows survive the move.** Analyst, tester, and project
  flows run on a sandboxed runner with the same approvals, versions, and
  audit trail; their artifacts remain downloadable from Conveyor.
- **G4 — More than one agent.** Maki is a first-class agent host alongside
  Claude Code, Codex, and Cursor; a route step can pin a runner with a
  specific agent.
- **G5 — Operable.** A team can start, stop, upgrade, and observe sandbox
  runners without a shell; reconnects and failures are explicit.
- **G6 — Invariants unchanged.** No host bind mounts, deny-by-default
  egress, uid/gid 1500, no `maki auth login` or equivalent inside the
  sandbox, credentials only through provider profiles.

## Non-goals

- One sandbox per agent *turn*. Isolation granularity is a decision (D1),
  not a default.
- Running arbitrary CLI agents without a host implementation. Conveyor's
  agent hosts are compiled in; adding Gemini or another CLI is a new slice,
  not configuration.
- A desktop wrapper for Conveyor. It is a web app; that is an advantage for
  non-technical users.
- Replacing Conveyor's pipeline, state machine, or UI language. The mode
  is additive.
- Per-task microVMs, live migration, or a second orchestrator.
- Hosting Conveyor as multi-tenant SaaS.

## Milestone rules

- **Every milestone ends in a demo a person can run**, not a document or a
  decision. Spikes live inside the milestone they de-risk.
- **C0 is a stop/go gate.** If either C0.1 or C0.2 fails, stop and fall
  back to the Orca-over-SSH + thin role shell plan; do not start C1.
- **One OpenSpec change per slice.** A slice too large is split; each piece
  still ships a working exit.
- **Docs ship with the feature**: playbook, policy example, glossary, and
  a `docs/verification-log.md` entry for every milestone.
- **Conveyor-side changes follow that repository's rules**: Russian docs,
  UI, comments and commits; xUnit tests; `dotnet build Conveyor.slnx`,
  `dotnet test`, and `npm --prefix web` green.
- **Estimates are engineer-days for one engineer who knows both codebases**;
  add 30–50% otherwise. They are planning ranges, not commitments.

## Workstreams

| ID | Workstream | Where |
|---|---|---|
| W1 | Runner mode, policy, domain, UI | Conveyor `src/Conveyor.Domain`, `Conveyor.Api`, `web/` |
| W2 | Sandbox image, policy, lifecycle | this repo: `examples/environments/`, `examples/policies/`, `bin/` |
| W3 | Credentials: runner token, git push, model | OpenShell providers + Conveyor `Auth/`, `RunnerHub` |
| W4 | Agent hosts and parsers | Conveyor `src/Conveyor.Runner/Agents/` |
| W5 | Role flows and artifacts | Conveyor `src/Conveyor.Application`, `web/` |
| W6 | Ops, CI, documentation | both repos, `docs/` |

## Decisions to make

**D1 — Isolation granularity** (blocks C2, C5).

- (a) Runner per user/team, shared `/sandbox`: cheapest; tasks share the
  clone and the uid.
- (b) Runner per task: strongest; costs image pull + clone + registration
  per task.
- (c) Warm clone sandbox + ephemeral task sandbox: later.
- **Recommendation:** (a) for the pilot; decide before C5 whether the data
  warrants (b).

**D2 — Trust anchor for "sandboxed"** (blocks C1).

- (a) Profile checkbox: weak; an admin can mark a laptop.
- (b) Server-side flag on the runner token: recommended.
- (c) Gateway-signed attestation: strongest; later.
- **Recommendation:** (b) now; revisit (c) if OpenShell exposes a signed
  sandbox identity.

**D3 — Git push credential transport** (blocks C0.2).

- (a) `GIT_CONFIG_*` → `http.extraHeader` (precedent: `docs/oskhs.md`).
- (b) Credential helper.
- (c) Server-side push: bigger product change.
- **Recommendation:** (a) first, (b) if git versions differ, stop before
  (c).

**D4 — Default agent and model routing** (blocks C3).

- Maki first for the sandbox story; Claude stays the existing default;
  per-runner model via the provider profile.
- **Recommendation:** Maki for new sandbox profiles, Claude unchanged for
  laptop runners.

**D5 — Ownership of the Conveyor changes** (blocks C1).

- (a) Upstream the sandbox mode to Conveyor master.
- (b) Long-lived branch with a named maintainer.
- **Recommendation:** (a); do not start C1 without one.

**D6 — Auth and ownership of shared runners** (blocks C5).

- Auth on + per-sandbox token; owner = task owner; shared pools need a
  service-owned profile.
- **Recommendation:** auth on from C1; shared pools in C5.

**D7 — Artifact boundary** (blocks C4).

- Diffs, prompts, and analytics files go to the Conveyor API (trusted,
  internal); repository contents leave only via GitLab; model context goes
  to the provider.
- **Recommendation:** as stated; write it into the analyst and tester
  guides.

## Sequencing

| Demo | Milestones | Days |
|---|---|---|
| Proof: simulated task in a sandbox | C0 | 3–5 |
| Pilot: real repo, branch, MR | C0–C2 | 10–15 |
| Multi-agent pilot: Maki and Claude/Codex | C0–C3 | 13–20 |
| Role workflows: analyst, tester, reviewer | C0–C4 | 18–28 |
| Rollout: pool, tenancy, upgrade, dogfood | C0–C5 | 22–34 |

Critical path: C0.1 → C0.2 → C1 → C2 → C3. C4 can start after C2 — its role
flows do not depend on Maki. W2 (image and policy) starts on day 1; W4 (Maki
host) starts after C0.3.

## Architecture

```
Conveyor web (trusted) ── users, browser only
      │ HTTPS
Conveyor API + MongoDB (trusted) ── GitLab API token, YouTrack, Confluence
      │ SignalR /hubs/runner over WSS, allowlisted
┌─────┴──────────────────────────────────────────────────────────────┐
│ OpenShell sandbox (untrusted, uid/gid 1500)                        │
│   Conveyor.Runner ── /sandbox/repos/<name> ── git worktrees        │
│        │                    │                                      │
│        │                    └── agent CLI (Maki / Claude / Codex)  │
│        │                              │ provider stand-in        │
│        └── self-check, diff, commit    ▼                           │
└───────────────────────────────────────┼────────────────────────────┘
                                        ▼ model API (allowlisted)
                     GitLab smart HTTP (allowlisted, bound credential)
```

## Track C

### C0 — Feasibility gates (W1–W4) — 3–5 days

Three spikes, in order. Each is a recipe plus a verification-log entry; no
product code merges before the gate passes.

- **C0.1 — Runner in the sandbox, simulated.**
  Build an environment image with the .NET 10 runtime, git, and the runner;
  start it as uid 1500 with `Runner:WorktreeRoot=/sandbox/.conveyor/worktrees`,
  `Runner:RepoRoot=/sandbox/repos`, `Runner:AnalyticsRoot=/sandbox/analytics`;
  allow one WebSocket rule to the dev API; seed a bare repo and a clone
  inside `/sandbox`; run a `simulated` task end to end. Proves image, paths,
  filesystem policy, SignalR transport, and lifecycle. Fallback if WS is
  refused: SignalR long polling over the same REST rule.
- **C0.2 — Git round trip with a bound credential.**
  Clone a real GitLab repo inside the sandbox, run a task, commit, push via
  the D3 mechanism, open the MR from the UI. Prove the real credential
  appears in no file, argv, remote URL, or log; the sandbox sees only the
  stand-in; the credential works only on that project's smart-HTTP paths;
  the API's GitLab token never reaches the sandbox. Fallback order:
  `http.extraHeader` → credential helper → server-side push (stop and
  re-scope).
- **C0.3 — Maki through the pipeline.**
  `MakiAgentHost` using `--print --output-format stream-json --verbose`,
  reusing `ClaudeStreamParser` if the event shape matches; `--allowed-tools`
  / `--disallowed-tools` for read-only roles; `--yolo` only for developer;
  `--trust`; `-r` / `--fork-session`; model through the provider stand-in.
  Prove planner → developer → reviewer, and that a reviewer cannot write.

**Exit:** three recorded demos and a short ADR covering D1–D3. **Stop/go:**
if C0.1 or C0.2 fails with no fallback, stop this track.

**OpenSpec:** one `add-conveyor-sandbox-feasibility` change carrying the
recipes, policy example, and verification entries. No production behavior.

### C1 — Sandbox runner mode (W1–W3) — 3–4 days

- **C1.1 — Safe mode.** `AgentModes.IsSafe` currently accepts only Docker,
  GeoFront, and simulated; `RunnerAccessPolicy.BlockReason` therefore
  refuses a plain `claude`/`codex`/`maki` runner unless `UnsafeMode` is on.
  Add an isolation dimension to the runner profile (D2) so a sandboxed
  runner is safe by construction, and show it in the runner list.
- **C1.2 — Trust anchor.** If D2 is (b): `Auth:RunnerTokens` becomes a map
  of token → `{sandboxed, owner}`; the launcher registers the token
  server-side with `sandboxed: true`; the UI never sets the flag. If D2 is
  (c), defer attestation and say so in the UI.
- **C1.3 — Bootstrap and lifecycle.** Start the runner with the sandbox,
  register, heartbeat, stop on sandbox stop, and surface "runner offline"
  instead of an opaque failure. No systemd: a supervised console process in
  `/sandbox` is enough.
- **C1.4 — UI copy.** Russian labels for the new mode, an isolation badge on
  the runner card, and a warning when `UnsafeMode` is enabled for a
  non-sandboxed runner.

**Exit:** with `UnsafeMode` off, an admin cannot mark a laptop runner as
sandboxed; a sandboxed runner runs simulated tasks and shows the badge; a
non-sandboxed `claude` runner is still refused.

**OpenSpec:** `add-conveyor-sandbox-runner`.

### C2 — Repository round trip (W1–W3) — 4–6 days

- **C2.1 — Clone-if-missing.** `GitWorkspace.EnsureSnapshotAsync` and
  `EnsureInPlaceAsync` throw `RepoNotFound`; add a clone on first use from
  the repository profile's origin into `RepoRoot`, serialized by the
  existing per-repo lock. The spec needs the origin URL — add it to
  `WorkspaceSpec` (the server knows the GitLab project) or to the repository
  profile. Keep the current error as the fallback.
- **C2.2 — Credential plumbing.** Install the D3 mechanism in the image or
  the runner entrypoint; scope the token to one project and push-only; never
  write it to `.git/config` or the remote URL. Configure `safe.directory`
  for `/sandbox`.
- **C2.3 — Push and MR.** Productize C0.2: branch name, push-as, MR draft,
  `refs/merge-requests/*/head` for review, and a retry when GitLab has not
  yet seen the branch. The MR call stays server-side.
- **C2.4 — Failure and recovery.** API restart mid-run → reconnect and
  explicit outcome; sandbox restart → a task says "workspace lost" and can
  be restarted; worktree cleanup on task delete; disk quota check before a
  run.

**Exit:** a fresh sandbox with no clone completes a task and opens an MR;
no real credential is inside; kill/restart tests pass.

**OpenSpec:** `add-conveyor-repository-flow`.

### C3 — Maki as a first-class agent (W4) — 3–5 days

- **C3.1 — Host and parser.** Ship `MakiAgentHost`, mode `maki`, executable
  path, and reuse or adapt `ClaudeStreamParser`; tests cover the stream
  shape, a failing CLI, cancellation, and a missing binary.
- **C3.2 — Roles and permissions.** Read-only roles must not write; the
  developer role may edit but not commit/push; `--yolo` only for developer;
  `--trust` for project config; no `maki auth login` path.
- **C3.3 — Sessions.** `-r`, `--fork-session`, and one-process-per-session
  behavior; a resume of a missing session fails explicitly.
- **C3.4 — Limits probe.** `AgentLimitsReader` is best-effort; disable it
  for Maki and for sandboxed runners unless it works through the provider
  stand-in.
- **C3.5 — Route integration.** Maki appears in the runner profile and the
  route editor; a route step can pin the Maki runner.

**Exit:** the same task template completes on Maki and on Claude (or Codex);
the read-only role test fails closed; a resume works after a sandbox
restart.

**OpenSpec:** `add-maki-agent-host`.

### C4 — Role workflows on a sandboxed runner (W5) — 5–8 days

Depends on D7. Ship in the order that proves the non-technical UX earliest.

- **C4.1 — Analyst.** YouTrack link → context → spec versions → review →
  download; the analytics folder is ephemeral, and the server already
  receives every file (`AnalyticsFilesReady`), so the UI becomes the source
  of truth. Confluence publishing stays server-side and out of this track.
  No git vocabulary in the analyst area.
- **C4.2 — Tester.** MR link → impact map → checklist → pass/fail → bug
  draft; code is read-only on a detached worktree at the MR SHA; the
  checklist survives a new MR revision.
- **C4.3 — Reviewer and duty.** MR review and duty replies on a sandboxed
  runner; read-only permissions; the "Discuss" flow still forks the session.
- **C4.4 — Project and planning.** Numbers stay server-side; the optional
  explanation agent runs in the sandbox and reads only what it is given.
- **C4.5 — Artifacts and attachments.** Attachment download through the
  runner token; analytics file round trip; size caps; no repository
  contents in Conveyor unless a role is allowed to see them.

**Exit:** an analyst and a tester each complete their main scenario in a
sandbox with zero shell commands; the artifacts are visible in the UI; the
UI never shows a branch, commit, worktree, or MR in those areas.

**OpenSpec:** `add-conveyor-role-flows`.

### C5 — Operations and rollout (W6) — 4–6 days

- **C5.1 — Runner pool.** A launcher that creates N sandbox runners from the
  environment image, labels them by agent/capacity, and removes them on
  stop; `maki-oss conveyor pool up/down/status` or an equivalent documented
  command.
- **C5.2 — Tenancy.** D6: auth on, per-sandbox token, owner checks; a shared
  pool uses a service-owned profile; document who can see which task.
- **C5.3 — Observability.** Runner logs via `openshell logs`; a doctor check
  for API reachability, git reachability, model stand-in, clone presence,
  and disk; a failure names the missing rule, not "connection refused".
- **C5.4 — Upgrade and recovery.** Image version in the runner card;
  draining a runner before upgrade; a task on a draining runner is requeued
  or fails explicitly; the API version and runner version are compatible.
- **C5.5 — Hardening.** Threat model for the in-sandbox runner (prompt
  injection, cross-task worktree reads, stand-in misuse); isolation
  checklist; Linux CI for the runner; a week of dogfooding with 3–5 users;
  `docs/verification-log.md` entry.
- **C5.6 — Rollout.** One-page user guide for analysts/testers/project
  managers, an admin runbook, and a rollback plan to the laptop runner.

**Exit:** a team uses the sandboxed runners for a week; a gateway restart, an
API restart, and an image upgrade each have a tested recovery; the audit
trail is complete; rollback is documented.

**OpenSpec:** `add-conveyor-operations`.

## Risks

| ID | Risk | Mitigation | Gate |
|---|---|---|---|
| R1 | SignalR/WebSocket through the OpenShell proxy is refused or unstable | Long polling over the same REST rule; measure reconnect time | C0.1 |
| R2 | Git smart HTTP cannot use a bound credential | `http.extraHeader` → credential helper → server-side push; stop before a fork | C0.2 |
| R3 | The Linux runner has Windows assumptions beyond WSL | Linux CI, path tests, `runner-wsl.sh` as the baseline; fix one bug per slice | C0.1, C2 |
| R4 | Maki's headless flags or permissions differ enough to break read-only roles | Dedicated host, fail-closed tests, no executable swap | C0.3 |
| R5 | Conveyor's product model assumes a trusted laptop | Sandbox mode is explicit in the domain, UI, and docs; never rely on `UnsafeMode` | C1 |
| R6 | Shared sandbox weakens per-task isolation | D1; per-task runners if the data warrants it; document the chosen boundary | C2, C5 |
| R7 | Conveyor changes die on a branch | D5: upstream first, named maintainer, or don't start | C1 |
| R8 | The sandbox is slower than a laptop (image pull, clone, .NET start) | Warm pool, preinstalled runtime, shallow clone option, measure time-to-first-event | C1, C5 |

## Success metrics

- A non-technical user completes an analyst or tester scenario with zero
  shell commands.
- Every task artifact leaves as a GitLab branch/MR or a Conveyor document;
  no host copy exists at any point.
- The isolation checklist and `openshell policy get --full` show no secret
  material and no wildcard egress in the runner sandbox.
- A sandboxed runner survives an API restart and an image upgrade with an
  explicit outcome for every in-flight task.
- Time from "take task" to "agent started" is under two minutes with a warm
  pool.
- Two agents (Maki and Claude or Codex) complete the same task template.

## Out of scope, revisit later

- Gateway-signed sandbox attestation (D2c).
- Warm clone sandbox + ephemeral task sandbox (D1c).
- Gemini or other agent hosts.
- A Conveyor plugin API for agent hosts.
- Publishing analytics specs to Confluence from the sandbox.
- Mobile or desktop wrappers.
