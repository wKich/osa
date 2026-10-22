# Roadmap: portable sandboxed agent sessions and kiss orchestration

Planning document. Implementation goes through OpenSpec changes, one per
roadmap item; nothing here ships without its spec delta. Item IDs (`G`, `A`,
`B`, `P`) are stable references for discussion.

**Status:** draft, 2026-10-22. Research basis: OpenShell v0.1.5, Maki v0.6.4,
kiss repo survey (same date). Restructured the same day into two independently
numbered tracks of vertical slices; see [Renumbering](#renumbering) for the
mapping from the earlier M0–M8 draft.

## Target goals

- **G1 — Host mobility.** A live sandboxed agent session survives moving
  between machines: start at work, reattach at home, transfer back. Loss is
  explicit and documented, never silent.
- **G2 — Multi-gateway management.** maki-oss treats gateways as a first-class
  resource: register/list/select local and remote gateways, per-project
  gateway choice, doctor reports gateway health. Intuitive for an end user in
  one screen of output.
- **G3 — kiss as an OpenShell orchestrator.** A Mattermost thread maps to a
  task maps to a sandbox on a chosen gateway, via a small adapter (`oskhs`)
  that keeps database credentials outside every sandbox.
- **G4 — Runtime portability.** The session lifecycle (attach, export,
  transfer, resume, kiss rounds) is defined once and parameterized per agent:
  maki first, then opencode, claude, and others.
- **G5 — Invariants unchanged.** OpenShell remains the security boundary:
  no host bind mounts, no secrets in sandboxes, deny-by-default egress,
  non-root sandbox user, credentials only through provider profiles.

## Non-goals

- Live process migration between gateways (snapshot-and-resume only; in-flight
  turns are lost by design).
- A standalone TUI or Maki plugin for session management (host-side
  subcommands first; revisit only if `sessions` output outgrows a table).
- A self-owned gateway registry in maki-oss (reuse OpenShell's registration;
  kiss-side advertisement reuses the proxy-registry pattern if needed).
- Streaming MM relays inside sandboxes (kiss's round/DB-mediated contract
  stays as-is).

## Milestone rules

- **Every milestone ships something working.** Its exit is a demo a person
  can run, not a document or a decision. Spikes live inside the milestone
  they de-risk.
- **Docs ship with the feature.** Each milestone's exit includes its
  playbook, glossary, and reference updates, link-checked.
- **One OpenSpec change per milestone or slice.** A milestone too large for
  one change is split into slices (`B1.1`, `B1.2`, …), each with its own
  working exit.

## Workstreams

| ID | Workstream | Area |
|---|---|---|
| W1 | Gateway management | `bin/maki-oss`, `docs/` |
| W2 | Attach + transferable sessions | `bin/maki-oss`, `examples/maki-image/`, `docs/` |
| W3 | OpenShell kiss adapter (`oskhs`) | subproject here (B1–B3), kiss repo (B4+) |
| W4 | Agent runtimes for oskhs (maki, then others) | subproject here, then kiss repo |
| W5 | Additional coding agents in maki-oss | `bin/maki-oss`, `examples/` |

## Track A — maki-oss

### A1 — Multi-gateway foundation (W1) — 1½ sessions

- **P1** — `maki-oss gateway list/add/remove/select/info` as a thin wrapper
  over `openshell gateway …` (OpenShell owns the registry at
  `~/.config/openshell/gateways`; maki-oss does not copy it); `gateway`
  config key per project (plumbing exists: `config_gateway`,
  `MAKI_OSS_GATEWAY`, `--gateway`); doctor shows active + registered
  gateways and reachability.
- **P2** — Remote-gateway image reachability: docs recipe
  (`docker save | ssh box docker load`, registry push) plus a doctor warning
  when the active gateway is remote and the agent image is absent there.

**Exit:** two gateways registered from one machine, `maki-oss --gateway <name>`
creates and runs a session on each; `doctor` output explains the topology.

### A2 — Transferable sessions (W2) — 2–2½ sessions

- **P0a** (first step, inside one container) — does `maki --resume` survive a
  cwd mismatch or absence (the session header records the absolute cwd)?
  The answer sets P5's state-install step and the cwd policy.
- **P5** — `maki-oss session export DIR` / `session import DIR`: stage the
  sandbox's Maki state dir into the workdir, move project + state through
  `sandbox download/upload`, install state on the far side. Gateway-agnostic,
  testable with one sandbox and a local directory. Ships `docs/transfer.md`
  with the loss matrix (lost: in-flight turn, shells, forwards, scrollback;
  kept: transcript, queued messages, flags, session id, policy, project files;
  not propagated: deletions — merge-only; guardrail: source sandbox is
  stopped first so one history is never driven by two agents).
- **P6** — `maki-oss session transfer --to <gateway>` = export → stop source
  (mandatory) → ensure sandbox on target → import → print resume hint.
  Reverse direction is the same command; source kept stopped by default,
  `--delete` opt-in.

**Exit:** a real session moved work-gateway → home-gateway → back, resumed
with `--continue` each time, caveats printed by the command itself.

A1 → A2 is the fastest path to the original work→home question; transfer
does not depend on attach.

### A3 — Session durability and attach (W2) — 1½–2 sessions

- **P0b** (first step) — does an `exec`-launched process survive connection
  drop, i.e. is the canonical-process redesign required for attach?
- **P3** — ADR: agent-lifetime model, prototyped in a scratch sandbox.
  Canonical process (`sandbox create --detach -- launcher` + `sandbox
  connect`, gains 1 MiB replay and sleep/wake recovery) vs tmux-in-sandbox.
  Decision gated on P0b.
- **P4** — `maki-oss attach` reattaches to the live TUI; terminal death no
  longer kills the in-flight turn; per-invocation flags (`--continue`,
  `--resume`) still work via the launcher's flags file.

**Exit:** kill a terminal mid-task on an always-on gateway, `attach` from
another machine, observe replayed output and an uninterrupted turn.

### A4 — Session management UX (W1+W2 closure) — 1 session

- **P7** — `maki-oss sessions` lists sandboxes across all registered
  gateways with phase and live session ids; `attach`, `session transfer`,
  `resume`, `stop` reachable from one place.
- **P8** — Dogfood: a real work→home→work transfer recorded in
  `docs/verification-log.md`.

**Exit:** G1 + G2 demonstrably done; a new user performs the full flow from
docs alone.

### A5 — Additional coding agents, maki-oss side (W5) — ~1 session

- An agent manifest (state dir, launch flags, resume flags) so
  attach/export/transfer work beyond maki; image variants under `examples/`
  (multi-ARG build rather than per-agent copies); headless round support for
  claude/opencode in the sandbox.
- Open scoping item: opencode's local bridge mode has no attach story today
  (bridge runs on the host). Either accept local-only for opencode or design
  `opencode --server` inside the sandbox exposed via `openshell service
  expose` — decide during A5, not before.

**Exit:** at least one non-maki agent completes attach/export/transfer
locally.

## Track B — kiss orchestration (oskhs)

### Architecture

The kiss task process cannot run inside a sandbox. `DockerAgentRunner` boots
the kiss image with `MONGO_CONNECTION_STRING` in its env; the in-container
task process loads every other secret from `SecretStore` and runs Pi
in-process. Running that image in a sandbox puts the database URI inside it
(violates G5), and provider-profile placeholder substitution cannot protect
it — Mongo's wire protocol is not HTTP.

So the task process moves to the host and only the agent runs in the
sandbox:

```
┌─ kiss host (trusted: Mongo URI, SecretStore, git creds) ───────────────────┐
│ KissHostService ── claim ──► OpenShellAgentRunner.runTask(X)               │
│                                │ spawns host process: kiss --task-id X     │
│                                ▼                                           │
│ TaskExecutor + GitLabAgent  (unchanged: clone, prompt, commit/MR, Mongo)   │
│        │ runtime = MakiService (replaces PiService)                        │
│        │   1. upload workspace ──► sandbox                                 │
│        │   2. maki-oss run "<prompt>"  (maki --print --output-format json) │
│        │   3. patch/bundle back ──► workspace, parse JSON result           │
└────────┼───────────────────────────────────────────────────────────────────┘
         ▼  openshell gateway
┌─ sandbox kiss-task-X (untrusted) ──────────────────────────────────────────┐
│ maki + project copy; model key via provider profile placeholder;           │
│ deny-by-default egress; no Mongo, no git creds                             │
└────────────────────────────────────────────────────────────────────────────┘
```

kiss's existing pipeline (prompt building, attachments, branch/MR, task
status, subtasks, Mattermost replies) is reused, not reimplemented.
maki-oss drives the sandbox (ensure, policy, provider profiles,
upload/download, headless run); `MakiService` calls it as a CLI, and may
switch to calling `openshell` directly later if that hurts.

**Code location.** Track B starts as a subproject in this repository,
depending on kiss through a path/git dependency (kiss is not a published
package). It reaches into kiss internals (`KissHostService`, `AgentTask`,
`IAgentModelRuntime`, `TaskExecutor`), so it breaks when those change; the
runner and runtime move into the kiss repo as part of B4.

### B1 — First sandboxed round (W3+W4) — 2½–3½ sessions, four slices

- **B1.1 — One maki round as a library** (½–1). A Node/TS subproject here
  wrapping `maki-oss upload/run/download`: parses `--output-format json`,
  maps errors and timeouts to an `AgentResult`. No kiss, no Mongo.
  **Exit:** `run-round <dir> "<prompt>"` runs maki headless in a sandbox on
  the local gateway and prints the parsed result.
- **B1.2 — Correct file return** (½). Maki works on a git checkout in the
  sandbox; the host receives a patch or bundle and applies it, replacing the
  merge-only download (which would resurrect deleted files into the commit).
  **Exit:** a prompt that edits, deletes, and renames files leaves the host
  workspace identical to the sandbox's, checked by `git diff`.
- **B1.3 — maki inside kiss's task pipeline** (1). Minimal
  `MakiService implements IAgentModelRuntime`: `executeWithRetry` real,
  save/restore no-ops, `fork` throws (best-effort self-review is skipped);
  `'maki'` added to the `AgentRuntime` union, the `AgentTask` session schema
  enum, and `resolveAgentSessionInfo` (own formatVersion, never masquerade as
  Pi); the factory honors its `runtime` argument; a per-project or env switch
  selects maki. Also: kiss runs on the host without its image. Riskiest
  slice — if `TaskExecutor` bypasses the runtime interface or host setup
  fights back, split into "host process with Pi" then "switch runtime".
  **Exit:** `kiss --task-id X` on the host, no KHS, completes a dev-Mongo
  task with maki: branch/MR created, result in Mongo.
- **B1.4 — Host service drives it** (½–1). `OpenShellAgentRunner`
  implementing kiss's de-facto runner surface (`healthCheck`,
  `getRunningCount`, `getMaxConcurrent`, `runTask`, `inspectTask`,
  `cleanup`): `runTask` spawns the host task process for sandbox
  `kiss-task-<id>`; counts and cleanup over processes + `maki-oss list`;
  restricted-network tasks refused fail-closed. `KissHostService` already
  accepts a runner by constructor; wired behind config.
  **Exit:** a dev-stand Mattermost message gets a reply produced by maki in a
  sandbox; the sandbox has no Mongo URI and no egress to Mongo; prod
  untouched.

### B2 — Conversations that survive (W4) — 1½–2 sessions

- Rounds = headless `maki-oss run --resume` in a persistent sandbox (maki's
  flock is free between rounds); between rounds the orchestrator drives
  `AgentSubTask` input exactly as today; idle-stop honors `idleTtlMs`.
- `saveSession` = Maki state tar → GridFS via kiss's `GridFSPersistentStore`
  (the host task process moves it; the sandbox never touches Mongo);
  `restoreSession` = download + install into a fresh sandbox. Starts with a
  minimal tar; converges on the A2 (P5) export format when it exists.

**Exit:** a Mattermost thread drives multi-round maki work; deleting the
sandbox mid-conversation and continuing restores it from GridFS.

### B3 — Feature parity (W4) — 1½–2 sessions

The runtime interface has 14 members; B1/B2 deliberately skip most of them
(reference: `PiService` is ~1.4k lines).

- `ensureSkills` (project skills into the sandbox), project MCP servers (path
  from sandbox to MCP — open question 3), `fork` (self-review),
  `switchModelProvider`, `getPerfMetrics`.

**Exit:** an existing project's config (skills, MCP, self-review, model
switch) works unchanged under maki.

B2 and B3 can swap if parity matters more than durability.

### B4 — Routed and in production (W3+W4) — 1½–2 sessions

- Claim affinity: extend `claimTask` with an optional runner selector
  (project/channel → gateway tag) and a heartbeat registry doc, following the
  `networkProxyInstances` precedent (TTL heartbeat, ~40-line model). Until
  this exists, an oskhs poller competes for *every* queued task — dev stand
  only.
- Deployment (the bulk): cloud-side adapter holding the Mongo URI, registered
  to the home OpenShell gateway with `--remote` (mTLS or Tailscale); secrets
  only via kiss's `SecretStore`; runner and runtime moved into the kiss repo;
  docs.

**Exit:** a named channel's tasks route to a chosen gateway; prod Mongo never
reachable from home networks; G3 demonstrably done.

### B5 — Second agent through oskhs (W4) — ~1 session

- `AgentRuntime` union extended per agent, factory selection by task/project
  config, per-runtime session format handling. Uses A5's headless round
  support for that agent.

**Exit:** a non-maki agent runs rounds through oskhs; with A5, G4
demonstrably done.

## Sequencing

```
Track A (maki-oss):  A1 ─► A2 ─► A3 ─► A4 ─► A5
Track B (kiss):      B1.1 ─► B1.2 ─► B1.3 ─► B1.4 ─► B2 ─► B3 ─► B4 ─► B5
Cross:               A1 ─► B4   (routing uses gateway selection)
                     A2 ┄► B2   (soft: session tar converges on P5's format)
                     A5 ─► B5   (headless rounds for the second agent)
```

The tracks run in parallel. B1.1–B1.2 need neither kiss nor Track A and can
start immediately against the local gateway.

| Track | Milestones | Sessions |
|---|---|---|
| A | A1 1½, A2 2–2½, A3 1½–2, A4 1, A5 ~1 | 7–8 |
| B | B1 2½–3½, B2 1½–2, B3 1½–2, B4 1½–2, B5 ~1 | 8–10½ |

Track B grew from the first draft's 3½–5 sessions after a kiss code read:
the host/sandbox split forced by Mongo credentials, plus the runtime
interface's real surface (now B3).

## Renumbering

| Earlier draft | Now |
|---|---|
| M0 P0a / P0b | first steps of A2 / A3 |
| M0 K0 | folded into B1.3 / B1.4 |
| M1 | A1 |
| M2 | A3 (after transfer) |
| M3 | A2 |
| M4 (P8 docs) | A4; docs now ship with every milestone |
| M5 K1 | B1.4 |
| M6 K2 | B1.1–B1.3 (round), B2 (sessions), B3 (parity) |
| M7 K3 / K4 | B4 |
| M8a / M8b | A5 / B5 |

## Open questions

1. **Attach model** (canonical process vs tmux) — decided by P0b/P3 in A3.
2. **Kiss restricted-network mode in prod** — is `NetworkIsolationService`
   active? Affects B1.4's fail-closed behavior; answer before B1.4.
3. **MCP from the sandbox** — kiss's project MCP servers run host-side today
   (`PiMcpBridge` in-process); maki in the sandbox needs a reachable path
   that does not carry their secrets inside. Decide in B3.
4. **Mattermost reply path** — posted by the task process or by the main
   kiss service watching Mongo? Either works with a host-side task process;
   confirm during B1.3.
5. **cwd portability** — if two gateways' workdirs can differ (path-derived
   naming), transfer must normalize or document the constraint; P0a answers
   Maki's behavior, A2 owns the policy.
6. **opencode attach story** — local-only vs in-sandbox server (A5).

## Carried risks

- Gateway host must be always-on (laptop lid kills everything else).
- Claim CAS has no host filter before B4: never point a prototype at prod.
- The kiss task image expects a Mongo URI in its env; any shortcut that runs
  it unchanged in a sandbox leaks database credentials. Not allowed even on
  the dev stand.
- kiss on the host needs its image's dependencies (Node, git, tooling) there;
  acceptable on the dev stand, B4 may use a slim non-agent container.
- A Track B subproject here tracks unpublished kiss internals; drift breaks
  it until it moves into kiss (B4).
- Merge-only transfer never propagates deletions — documented, accepted for
  A2; B1.2 avoids it for kiss rounds.
- Session archives older than kiss's 30-day purge are not durable history;
  Maki's own state in the sandbox plus P5 export are the long-lived copies.
