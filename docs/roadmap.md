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
| W3 | OpenShell kiss adapter (`oskhs`) | subproject here; marker check in kiss repo |
| W4 | Agent runtimes for oskhs (maki, then others) | subproject here |
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

**The kiss task process does not run in a sandbox.** `DockerAgentRunner` boots
the kiss image with `MONGO_CONNECTION_STRING` in its env; the in-container
task process loads every other secret from `SecretStore` and runs Pi
in-process. Running that image in a sandbox puts the database URI inside it
(violates G5), and provider-profile placeholder substitution cannot protect
it — Mongo's wire protocol is not HTTP.

**oskhs is a standalone queue worker.** kiss already treats the task document
as the hand-off point: the task process writes state and results, and the
main kiss service posts Mattermost replies itself, by `notificationState`
(`getTasksNeedingNotification`). oskhs speaks that task-document protocol —
claim (CAS), heartbeat (`updateHeartbeatUnlessStopped`), cancellation
(`updateFieldsUnlessCancelling`), state transitions, result fields — and
imports no kiss code. The only kiss change is an opt-in marker: tasks marked
for oskhs (by project or channel) are skipped by `KissHostService.claimTask`
and are the only ones oskhs claims, so the two consumers never race.

**Repos stay warm on the gateway; only git deltas travel.** Uploading a full
repo per task is not viable for repos of tens of GB with history over a home
uplink. Each repo gets a long-lived sandbox `repo-<project>` holding a clone,
seeded once with full history. Per task, oskhs sends an incremental git
bundle of the commits the sandbox's refs do not yet have; the task runs in
its own worktree; the
task's commits come back as a bundle. Bundles carry deletions and renames by
construction, and the GitLab token never enters the sandbox.

```
┌─ cloud (trusted) ──────────────────────────────────────────────────────────┐
│ Mattermost ◄── replies ── kiss (unchanged except: KHS skips marked tasks)  │
│     │ message              │ creates tasks; posts replies by             │
│     └─────────────► MongoDB (+GridFS) ◄┘ notificationState                │
│                        │ claim marked task · heartbeat · cancel ·          │
│                        │ result + state write                              │
│                        ▼                                                   │
│ oskhs worker (holds Mongo URI, GitLab token)                               │
│   1. claim task; git fetch the project's mirror ◄──────────► GitLab        │
│   2. bundle task refs --not <sandbox tips> ──┐                             │
│   5. fetch out.bundle, push branch, open MR ─┼─────────────► GitLab        │
│   6. write result + terminal state ──► Mongo │                             │
└──────────────────────────────────────────────┼─────────────────────────────┘
                                               │ maki-oss --gateway <name>
                                               │ (openshell --remote, mTLS / Tailscale)
┌─ any host: home, work, local ────────────────┼─────────────────────────────┐
│ OpenShell gateway ──► sandbox repo-<project> (untrusted, long-lived)       │
│   3. upload delta bundle → git fetch; git worktree add task-<id>           │
│   4. maki --print --output-format json in the worktree; commit;            │
│      bundle base..task-<id> → download                                     │
│   model key: provider-profile stand-in only                                │
│   egress: model API only — no Mongo, no GitLab                             │
└────────────────────────────────────────────────────────────────────────────┘
```

Secrets: Mongo URI and GitLab token live only with oskhs; the model key only
in the OpenShell provider profile. oskhs runs near Mongo (cloud) by default
and drives remote gateways; running it next to a gateway would put the Mongo
URI on that host (open question 1).

**Accepted trade-off:** tasks of one project share a sandbox, each in its own
worktree. Isolation between them is weaker (same project's code, same model
key) and they share CPU/memory. A per-task sandbox seeded by an in-sandbox
clone remains the fallback if this proves unacceptable.

**Code location.** oskhs lives in this repository as a subproject. It depends
on kiss only through the task-document contract in Mongo, not on kiss code.
The marker check is a small change in the kiss repo.

### B1 — First sandboxed task (W3+W4) — 4–5½ sessions, six slices

- **B1.1 — One round on a warm repo sandbox** (1). Library over maki-oss:
  seed `repo-<project>` from a local clone (once), send an incremental bundle,
  create a task worktree, run maki headless, parse `--output-format json`
  into a result; errors and timeouts mapped. No kiss, no Mongo. Includes one
  run against a remote gateway to confirm upload/download over the network.
  - *Bundle policy.* Per task, required: the base branch plus the task's own
    branches (including the MR source branch — `GitLabMRTaskSource` tasks
    work on an existing MR branch, so base-only would break them).
    Optional per-project mirror: every `origin/*` branch, for projects where
    the agent should explore other branches. Both are incremental:
    `git bundle create … <refs> --not <tips the sandbox already has>`.
  - *Ref bookkeeping.* oskhs records the sandbox's tip per ref, not a single
    HEAD. Bundles cannot delete refs, so branches deleted on GitLab are
    pruned with a separate `exec` (`git update-ref -d`).
  - *What the agent sees.* Full local history (`log`, `blame`, `diff`,
    `show`) and checkout of any delivered branch or commit. No network git:
    `fetch`/`pull` from GitLab fail (no GitLab egress). git refuses a branch
    already checked out in another task's worktree; the agent uses detached
    HEAD or branches off it. Worktrees share one ref store, so a task can
    move refs other tasks see; oskhs only takes back `task-<id>` and
    force-resets the remote-tracking refs on the next sync.
  **Exit:** `run-round <repo> "<prompt>"` twice in a row; the second run
  transfers only the delta (measured); the agent can check out a delivered
  non-base branch; works on a local and a remote gateway.
- **B1.2 — Commits back as a bundle** (½). Maki's changes committed in the
  task worktree, returned as `base..task-<id>` bundle, fetched into the host
  clone. Replaces the merge-only download, which would resurrect deleted
  files. **Exit:** a prompt that edits, deletes, and renames files yields a
  host branch identical to the task worktree.
- **B1.3 — Queue worker, dev Mongo** (1). oskhs claims a marked task,
  heartbeats, honors cancellation, runs the round, writes result + terminal
  state; kiss posts the reply. Kiss side: marker field and the KHS skip.
  Read-only (Q&A) tasks only; restricted-network tasks refused fail-closed.
  **Exit:** a question in a marked dev-stand Mattermost channel gets an
  answer produced by maki in a sandbox.
- **B1.4 — Code changes land** (½–1). oskhs pushes the returned branch and
  opens an MR in the shape `GitLabMRTaskSource` expects, recorded on the task
  as kiss records its own MRs. **Exit:** a dev-stand task that asks for a code
  change ends with an MR linked in the thread.
- **B1.5 — Production, opt-in** (½–1). oskhs deployed near prod Mongo, KHS
  marker check deployed, one channel marked, its tasks served by a remote
  gateway. **Exit:** tasks in the marked prod channel run on the chosen
  gateway; every other task still goes through KHS; prod Mongo unreachable
  from the gateway host.
- **B1.6 — git LFS** (½–1). Bundles carry only LFS pointers, and the sandbox
  has no GitLab egress, so oskhs ships LFS objects next to the bundle:
  - *In:* `git lfs fetch` in oskhs's mirror for the refs the task receives
    (tip objects only, not all history); the missing set is a difference of
    sha256 oids against what the sandbox already has; a tar of missing
    objects is uploaded into `.git/lfs/objects/`; worktrees are created with
    `GIT_LFS_SKIP_SMUDGE=1`, then `git lfs checkout` fills them offline.
  - *Out:* commits that touch tracked files store objects locally (the clean
    filter needs no network); objects referenced by `base..task-<id>` come
    back as a tar next to `out.bundle`; oskhs runs `git lfs push` before
    `git push`.
  - *Bookkeeping:* oskhs records LFS oids per sandbox next to the ref tips.
  - *Agent view:* older commits show LFS pointer files, not content
    (history, blame, and diff on code still work).
  - *Image:* `git-lfs` added to the sandbox image.
  - *Opt-in alternative for very large LFS projects (not built here):* the
    sandbox fetches LFS directly from GitLab with a project-scoped read-only
    deploy token through a provider profile and an LFS-only egress rule —
    data skips the uplink. Needs verification that placeholder substitution
    works for LFS Basic auth and that egress can be scoped to the project's
    LFS paths.
  **Exit:** a task on an LFS repo sees real file content in its worktree,
  edits a tracked binary, and the MR contains the new object; the second
  task on the same repo uploads no LFS objects it already sent.

### B2 — Conversations that survive (W4) — 1½–2 sessions

- Follow-ups: thread messages arrive as `AgentSubTask`s; each round is a
  headless `maki-oss run --resume` in the task's worktree (maki's flock is
  free between rounds); idle-stop honors `idleTtlMs`.
- Session durability: the task's Maki state saved by oskhs to GridFS (the
  sandbox never touches Mongo) and restored into a fresh worktree; starts as
  a minimal tar, converges on the A2 (P5) export format.
- Warm-sandbox lifecycle: worktree GC, re-seed on sandbox loss, per-ref tip
  tracking survives oskhs restarts.

**Exit:** a thread drives multi-round maki work; deleting the sandbox
mid-conversation and continuing re-seeds and restores from GridFS.

### B3 — Feature parity (W4) — 2–3 sessions

kiss's task process provides features oskhs does not yet: project skills,
project MCP servers (path from the sandbox — open question 3), self-review,
model selection and fallback, attachments and artifacts (GridFS), usage
accounting. Each lands as an oskhs feature over the task-document contract.

**Exit:** an existing project's config works unchanged when its channel is
marked for oskhs.

B2 and B3 can swap if parity matters more than durability.

### B4 — Multiple gateways (W3+W4) — 1–1½ sessions

- Routing: marker grows into a selector (project/channel → gateway); a
  heartbeat registry of gateways following the `networkProxyInstances`
  precedent (TTL heartbeat, ~40-line model); warm sandboxes per
  (project, gateway).
- Hardening and docs: gateway loss handling, operator playbook.

**Exit:** two channels route to two different gateways; stopping one
gateway fails its tasks visibly instead of stalling them; G3 demonstrably
done.

### B5 — Second agent through oskhs (W4) — ~1 session

- Agent abstraction in oskhs (launch, resume, result parsing, session
  state) and per-task/project agent selection. Uses A5's headless round
  support for that agent.

**Exit:** a non-maki agent runs rounds through oskhs; with A5, G4
demonstrably done.

### Future — in-cluster gateway on Kubernetes (not scheduled)

A potential design, recorded for later; no milestone owns it yet. Source:
OpenShell's Kubernetes Setup, Installation, Architecture, and Gateways docs
(read 2026-10-22, not verified in this repository).

**How OpenShell runs on Kubernetes.** The gateway is installed in the cluster
with the Helm chart (`oci://ghcr.io/nvidia/openshell/helm-chart`): a
StatefulSet with SQLite on a PVC by default, or a Deployment with external
PostgreSQL for more than one replica. Its Kubernetes compute driver creates a
`Sandbox` resource per sandbox; each sandbox is a supervisor pod (outbound
session to the gateway, policy enforcement) paired over mTLS with a workload
pod (the agent), in `server.sandboxNamespace`. A NetworkPolicy lets only the
supervisor reach the workload and denies connections the workload initiates;
the workspace PVC preserves `/sandbox` across pod restarts. Clients register
the gateway with `openshell gateway add`, over mTLS (chart-generated
`openshell-client-tls`) plus OIDC or a trusted access proxy for user auth.

**Shape.** A cluster gateway is one more gateway next to the home box; oskhs
and Mongo do not move.

```
┌─ prod k8s cluster ─────────────────────────────────────────────────────────┐
│ ns kiss                                                                    │
│  ├─ kiss (unchanged; KHS skips marked tasks) ──► Mattermost                │
│  ├─ MongoDB (+GridFS)                                                      │
│  └─ oskhs (Deployment, 1 replica)                                          │
│       Mongo URI + GitLab token                                             │
│       mirror PVC: bare mirror + LFS store per project ◄── fetch ── GitLab  │
│       state: tips + LFS oids per (project, gateway)                        │
│         │ in-cluster, no uplink                  │ --remote                │
│         ▼                                        │                         │
│ ns openshell: gateway (StatefulSet+SQLite | Deployment+Postgres)           │
│         │ Kubernetes compute driver              │                         │
│         ▼                                        │                         │
│ ns sandboxes (NetworkPolicy-enforcing CNI required)                        │
│  ├─ repo-<project-A>: supervisor pod ◄mTLS► workload pod (maki, worktrees) │
│  │                    workspace PVC = warm clone (+LFS)                    │
│  └─ repo-<project-B> …                           │                         │
└──────────────────────────────────────────────────┼─────────────────────────┘
                                                   │ deltas over uplink
┌─ home box ───────────────────────────────────────▼─────────────────────────┐
│ gateway (Docker driver) ──► repo-<project-A> (its own warm clone)          │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Warm clone = workspace PVC.** Pod rescheduling does not force a re-seed;
  seeding tens of GB is one in-cluster transfer.
- **One warm clone per (project, gateway).** oskhs tracks tips and LFS
  objects per pair; B4 routing picks the gateway.
- **oskhs needs its own storage**: a mirror PVC sized for every routed
  project's mirror and LFS store. One replica is simplest; more need
  per-replica mirrors or a shared one.
- **Bundles stay** although bandwidth is no longer the reason: they keep the
  GitLab token out of the sandbox and give every gateway one code path.

**Task layout options.**

- **A — shared sandbox per project** (the Track B design). Works with the
  documented OpenShell API and is the same code as on the home gateway.
  Weak isolation between tasks; a project's concurrent tasks share one pod's
  CPU/memory and scale up, not out. Default.
- **B — golden PVC + per-task copy.** A golden PVC holds the warm clone
  (synced by bundles); each task gets its own sandbox whose workspace PVC is
  restored from a CSI VolumeSnapshot of it — copy-on-write on most storage
  backends, near-instant regardless of repo size. Per-task isolation and
  horizontal scaling. Unverified: whether OpenShell lets a sandbox's
  workspace PVC come from a snapshot (sandbox templates are the place to
  look), and whether the StorageClass supports snapshots.

**Prerequisites to confirm.** CNI enforces egress NetworkPolicy (otherwise
sandboxes bypass the supervisor); Agent Sandbox controller and CRDs
installable (cluster-admin); Kubernetes 1.29+; what happens to the workspace
PVC when a sandbox is deleted (decides re-seed cost); StorageClass snapshot
support (option B only).

## Sequencing

```
Track A (maki-oss):  A1 ─► A2 ─► A3 ─► A4 ─► A5
Track B (kiss):      B1.1 ─► B1.2 ─► B1.3 ─► B1.4 ─► B1.5 ─► B1.6 ─► B2 ─► B3 ─► B4 ─► B5
Cross:               A1 ─► B1.5  (remote gateway selection)
                     A2 ┄► B2    (soft: session tar converges on P5's format)
                     A5 ─► B5    (headless rounds for the second agent)
```

The tracks run in parallel. B1.1–B1.2 need neither kiss nor Track A (a
remote gateway can be registered by hand with `openshell gateway`) and can
start immediately.

| Track | Milestones | Sessions |
|---|---|---|
| A | A1 1½, A2 2–2½, A3 1½–2, A4 1, A5 ~1 | 7–8 |
| B | B1 4–5½, B2 1½–2, B3 2–3, B4 1–1½, B5 ~1 | 9½–13 |

Track B grew from the first draft's 3½–5 sessions after a kiss code read:
the Mongo credentials force the agent and the task process apart, oskhs
re-implements the task-document protocol and kiss's task features (B3), and
large repos need warm sandboxes with git-bundle sync.

## Renumbering

| Earlier draft | Now |
|---|---|
| M0 P0a / P0b | first steps of A2 / A3 |
| M0 K0 | dropped: oskhs no longer reuses kiss's runner or runtime factory |
| M1 | A1 |
| M2 | A3 (after transfer) |
| M3 | A2 |
| M4 (P8 docs) | A4; docs now ship with every milestone |
| M5 K1 (`OpenShellAgentRunner`) | replaced by the oskhs queue worker (B1.3) |
| M6 K2 (`MakiService`) | B1.1–B1.2 (round), B2 (sessions), B3 (parity) |
| M7 K3 / K4 | marker in B1.3, prod in B1.5, multi-gateway routing in B4 |
| M8a / M8b | A5 / B5 |

## Open questions

1. ~~**Where oskhs runs**~~ — decided 2026-10-23: near Mongo; credentials
   never leave the cloud, gateways reached with `--remote`.
2. **Repo size shape** — answered 2026-10-23: both large history and large
   working trees (binaries, LFS). Bundles cover history; LFS needs its own
   path (B1.6); vendored non-LFS binaries travel once at seed time, then as
   deltas.
3. **MCP from the sandbox** — kiss's project MCP servers run in the task
   process today (`PiMcpBridge`); maki in the sandbox needs a reachable path
   that does not carry their secrets inside. Decide in B3.
4. ~~**Seeding a warm sandbox**~~ — decided 2026-10-23: one-time upload over
   the uplink (no GitLab credentials or egress in the sandbox); B1.1 makes the
   seed resumable.
5. **Kiss restricted-network mode in prod** — is `NetworkIsolationService`
   active? oskhs refuses restricted tasks fail-closed; confirm what that means
   for marked channels before B1.5.
6. **Attach model** (canonical process vs tmux) — decided by P0b/P3 in A3.
7. **cwd portability** — if two gateways' workdirs can differ (path-derived
   naming), transfer must normalize or document the constraint; P0a answers
   Maki's behavior, A2 owns the policy.
8. **opencode attach story** — local-only vs in-sandbox server (A5).

## Carried risks

- Gateway host must be always-on (laptop lid kills everything else).
- Before the KHS marker check is deployed, an oskhs worker competes for
  *every* queued task: never point it at prod before B1.5.
- The kiss task image expects a Mongo URI in its env; any shortcut that runs
  it unchanged in a sandbox leaks database credentials. Not allowed even on
  the dev stand.
- oskhs re-implements kiss's task-document protocol; schema or state-machine
  changes in kiss can break it silently. Contract tests against kiss's model
  belong in B1.3.
- Tasks of one project share a warm sandbox: weaker isolation between tasks,
  shared resources (accepted; per-task fallback documented above).
- Merge-only transfer never propagates deletions — documented, accepted for
  A2; Track B avoids it with git bundles.
- Session archives older than kiss's 30-day purge are not durable history;
  Maki's own state in the sandbox plus P5 export are the long-lived copies.
