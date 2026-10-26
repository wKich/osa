# Roadmap: portable sandboxed agent sessions and kiss orchestration

Planning document. Implementation goes through OpenSpec changes, one per
roadmap item; nothing here ships without its spec delta. Item IDs (`G`, `A`,
`B`, `P`) are stable references for discussion.

**Status:** draft, 2026-10-22. Research basis: OpenShell v0.1.5, Maki v0.6.5,
kiss repo survey (same date). Restructured the same day into two independently
numbered tracks of vertical slices; see [Renumbering](#renumbering) for the
mapping from the earlier M0–M8 draft.

Companion track:
[Conveyor as the sandboxed orchestration layer](conveyor-roadmap.md).

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
imports no kiss code. The kiss change is an opt-in marker: tasks marked for
oskhs (by project or channel) are skipped by `KissHostService.claimTask` and
are the only ones oskhs claims, so the two consumers never race; every other
kiss reader of runtime state (reconcile, idle-stop, stale checks) respects
the same marker (B1.3a).

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
in an OpenShell provider record on the gateway. oskhs runs near Mongo (cloud)
and drives remote gateways (decided; running it next to a gateway would put
the Mongo URI on that host).

**Model credentials.** kiss configures a `ModelProvider` per project in Mongo
(`apiKey`, `baseUrl`, `providerType`, `isExternal`). OpenShell keeps the key
out of the sandbox; it does not stop the agent from *using* the key through
the allowed endpoint. Source: OpenShell Providers, Profiles, Inference,
Workspaces, and Security best-practices docs (read 2026-10-23, not yet
verified here).

- *What OpenShell guarantees.* The sandbox sees only a placeholder; the
  supervisor proxy substitutes the real key in headers, Basic auth, query, or
  path (bodies only when enabled) and only for the host/port/path the
  credential is bound to — anything else gets 403
  `credential_endpoint_mismatch`; unknown or expired placeholders fail
  closed. A base-URL env var never widens the binding: any host other than
  the stock profiles' needs a custom profile declaring it. Listing never
  shows values; `--secret-material-env` keeps the key out of the process
  table; detach stops resolution; each round is a new process, so rotation
  applies on the next round.
- *What it does not cover.* (1) The agent can spend the key freely through
  the bound endpoint — any model, any volume, and with `access: full` any of
  that API's endpoints. (2) The model endpoint is a data channel by design;
  every egress rule stays as narrow as possible. (3) The key is stored on
  every gateway serving the project, and mTLS operators can read it via
  `GetProviderCredentials` — a home gateway holds prod keys readable by its
  admin. (4) Internal models (`isExternal: false`) are reachable only from
  gateways on that network.
- *oskhs controls.* One custom profile per provider host, derived from
  `baseUrl`: `protocol: rest`, inference-only `rules` (for example
  `POST …/chat/completions`, `POST …/messages`, `GET …/models`) instead of
  `access: full`, binaries limited to maki. One provider instance per
  (project, gateway), created by oskhs from Mongo with
  `--secret-material-env`, attached only to `repo-<project>`, re-synced when
  kiss's config changes (B1.3d). Separate keys per gateway with
  provider-side spend limits where available (B5). Routing respects which
  gateways can reach internal models; workspaces per project considered at
  B6. Per-task short-lived keys are a later option (open question 9).

**Accepted trade-off:** tasks of one project share a sandbox, each in its own
worktree. Isolation between them is weaker (same project's code, same model
key) and they share CPU/memory. A per-task sandbox seeded by an in-sandbox
clone remains the fallback if this proves unacceptable.

**Code location.** oskhs lives in this repository as a subproject. It depends
on kiss only through the task-document contract in Mongo, not on kiss code.
The kiss-side change (marker plus the readers of runtime state, B1.3a) is
small and lives in the kiss repo.

### B1 — First sandboxed task (W3+W4) — 6–8½ sessions, nine slices

Each slice ends in a runnable demo and fits one session. B1 uses a gateway
co-located with oskhs (same host or cluster) and repos small enough to seed
in one go; remote gateways and resumable large seeds are B5.

- *Dev stand.* kiss's local stack (`scripts/start-local.sh` in the kiss repo:
  mongo, orchestrator, KHS, admin, restored from a DB dump with tokens and
  model providers) is the test environment for B1.3a–B1.4. The OpenShell
  gateway runs on the same host, so "the sandbox cannot reach Mongo" is a
  real check against the local `kiss-mongo` container.
- *In scope.* Mattermost questions (B1.3c) and Mattermost code requests
  (B1.4). *Out of scope until B3:* tasks created from GitLab MRs
  (`GitLabMRTaskSource`), explore/read-only mode switching, attachments.

- **B1.1a — Seed + one round in a worktree** (½–1). *Done 2026-10-23
  (`add-oskhs-round`; [docs/oskhs.md](oskhs.md)).* Library over maki-oss:
  seed `repo-<project>` from a local clone (full bundle upload, then
  `git clone` from it inside the sandbox), create a task worktree, run
  `maki-oss run --no-sync` with `MAKI_OSS_WORKDIR` pointing at the worktree
  and `MAKI_OSS_SANDBOX_NAME=repo-<project>`, parse `--output-format json`
  into a result; errors and timeouts mapped. maki-oss assumes "this
  directory is the project" (upload on create, download after run); the warm
  sandbox sidesteps both via flags or direct `openshell` calls for git steps.
  No kiss, no Mongo. **Exit:** `run-round <repo> "<prompt>"` on a small repo
  and the local gateway answers from a fresh worktree.
- **B1.1b — Incremental bundles** (½–1). *Done 2026-10-23
  (`add-oskhs-incremental-sync`); tips are read from the sandbox per ref
  rather than recorded host-side.*
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
  **Exit:** two runs in a row; the second transfers only the delta
  (measured); the agent can check out a delivered non-base branch; a branch
  deleted upstream disappears from the sandbox.
- **B1.2 — Commits back as a bundle** (½). *Done 2026-10-23
  (`add-oskhs-commits-back`); host branch `oskhs/<task-id>`.* Maki's changes committed in the
  task worktree, returned as `base..task-<id>` bundle, fetched into the host
  clone; worktree removed afterwards. Replaces the merge-only download,
  which would resurrect deleted files. **Exit:** a prompt that edits,
  deletes, and renames files yields a host branch identical to the task
  worktree.
- **B1.3a — kiss: marker and reader audit** (½–1). *Done 2026-10-23 in
  the kiss repo, branch `feat/oskhs-executor-marker` (OpenSpec change
  `add-oskhs-executor-marker`, not yet merged): `executor: 'oskhs'` on
  `AgentTask`, resolved from channel then project for Mattermost tasks;
  only `KissHostService.claimTask` needed the filter; recovery is shared —
  reconcile requeues a stale marked task and oskhs re-claims it.* In the kiss repo: an
  `executor` field on `AgentTask` set at task creation from project/channel
  config (missing = KHS); `KissHostService.claimTask` adds
  `executor: { $ne: 'oskhs' }`; claim index updated. Audit every kiss reader
  of `runtimeState`, `agentHostId`, and heartbeat fields
  (`ReconcileAgentRuntimesTask`, idle-stop such as
  `findIdleStoppedGitLabMRTasks`, stale checks): each gets the same filter or
  is shown safe. Decide recovery ownership: if `ReconcileAgentRuntimesTask`
  marks a stale oskhs task `failed`, oskhs's claim (which accepts `failed`)
  re-claims it — both sides must agree on that. **Exit:** kiss's tests prove
  KHS and the periodic tasks never claim, restart, or stop a marked task.
- **B1.3b — Task protocol with a fake round** (1). *Done 2026-10-23
  (`add-oskhs-task-worker`); thread follow-ups (`thread_instruction`
  sub-tasks) are answered too, so a woken task never loops on reconcile.* oskhs worker against dev
  Mongo: claim CAS with `executor: 'oskhs'`, heartbeat loop
  (`updateHeartbeatUnlessStopped` semantics), cancellation watch, state and
  `notificationState` transitions; contract tests against kiss's model. The
  round is an echo. Restricted-network tasks refused fail-closed. No sandbox.
  Also: a timeout per round; caps on concurrent rounds per sandbox and per
  oskhs; per-task logs (oskhs events, later sandbox logs and maki's JSON
  transcript) findable by task id; on restart, oskhs resolves its own
  in-flight tasks instead of leaving them `running`.
  **Exit:** a message in a marked dev-stand channel gets the echo reply,
  posted by kiss; cancelling mid-run ends the task cleanly; killing oskhs
  mid-task ends with the task failed visibly or re-claimed, never hanging.
- **B1.3c — Real round** (½–1). *Done 2026-10-23
  (`add-oskhs-sandbox-round`); rounds became multi-repo like kiss's
  workspace, mirrors are hand-made until B1.4.* Prompt built from the task the way kiss
  builds it (including thread context); B1.1/B1.2 round replaces the echo;
  result written in the format kiss posts from. Read-only (Q&A) tasks only.
  Uses a model provider preconfigured on the gateway by hand.
  **Exit:** a question in a marked dev-stand channel gets an answer produced
  by maki in a sandbox; the sandbox has no secrets in its environment and
  cannot reach the local `kiss-mongo`.
- **B1.3d — Project model and credentials** (½–1). *Done 2026-10-23
  (`add-oskhs-model-credentials`). OpenShell 0.1.5 has no
  `--secret-material-env`; `--credential KEY` with the value in the CLI's
  environment is used instead.* oskhs maps the task's
  kiss `ModelProvider` to a maki model id and syncs it into OpenShell: a
  custom profile per provider host (from `baseUrl`; `protocol: rest`,
  inference-only rules, maki-only binaries), a provider instance per project
  created with `--secret-material-env`, attached only to `repo-<project>`,
  re-synced when kiss's config changes; an egress rule for the provider host.
  Projects with internal models run only where the gateway reaches them.
  **Exit:** two marked projects with different providers each answer with
  their own model; the sandbox's environment holds only placeholders; a
  request with the placeholder to a non-inference path of the provider API
  is refused.
- **B1.4 — Code changes land** (1). *Done 2026-10-23
  (`add-oskhs-merge-requests`); MR !1 in the dev repository was opened by
  oskhs and linked in the thread by kiss.* oskhs keeps a bare mirror per project
  (fetched from GitLab; B1.1 used a local clone); pushes the returned branch
  with kiss's naming; opens an MR via the GitLab API in the shape
  `GitLabMRTaskSource` expects; records it on the task as kiss records its
  own MRs (`taskRepositories.mrIid` …) and moves the task to `review`.
  **Exit:** a dev-stand task that asks for a code change ends with an MR
  linked in the thread.
- **B1.5 — Production, opt-in** (1). *Paused 2026-10-24: oskhs runs
  against the local kiss deployment (the dev stand) until further notice;
  B2 onward proceeds without it.* oskhs deployed near prod Mongo (secrets,
  mirror volume) with a co-located gateway; the kiss marker change deployed
  first; one channel marked whose repos seed in one go; runbook with
  rollback = unmark the channel. **Exit:** tasks in the marked prod channel
  run in a sandbox; every other task still goes through KHS; the sandbox
  holds only placeholders and cannot reach prod Mongo.

### B2 — Conversations that survive (W4) — 1½–2 sessions, two slices

Each kiss task gets one Maki session that lives across its rounds: warm in
the sandbox between rounds, checkpointed by oskhs to GridFS after each one,
so losing the sandbox costs a re-seed and a restore, not the conversation.

*Starting point (B1.4).* Follow-ups (`thread_instruction`) already run, but
every round is stateless: a fresh worktree and a fresh Maki session, and the
workspace is removed when the round ends, so a follow-up sees only the
sub-task prompt kiss built. The worker writes `idle_stopped` as soon as the
sub-tasks are drained; `idleTtlMs` is unused. Ref tips already survive
oskhs restarts (the sandbox is the record), and a lost sandbox already
yields a full bundle on the next sync.

```
            ┌─ oskhs (host, holds Mongo URI) ─────────────────────────────┐
 kiss task  │ claim ─► ensure workspace ─► round ─► checkpoint ─► release  │
 + subtasks │            │                   │          │                  │
            │            │ warm? reuse        │          └► GridFS          │
            │            │ else restore ◄─────┼───────────  agent-sessions  │
            │            ▼                   ▼             + task.sessionInfo
            └────────────┼───────────────────┼─────────────────────────────┘
 sandbox    /sandbox/tasks/<id>/  (worktrees on task/MR branch, kept warm)
 repo-<p>   Maki session <sid>    maki --session-id <sid> | --resume <sid>
            GC sweeper: idle > idleTtlMs ─► checkpoint, remove workspace
```

- *Session identity.* One session per task, its id derived from the task id
  (16 bytes, base58, as Maki requires): the first round runs
  `--session-id <sid>`, later ones `--resume <sid>`. Recorded in kiss's
  existing `task.sessionInfo` (`sessionId`, `sessionArchiveId`). The
  workspace path `/sandbox/tasks/<id>` is the same on every gateway, so the
  session's recorded cwd matches after any restore.
- *Two tiers.* Hot: the workspace and Maki's state in the sandbox. Cold: a
  tar of this task's session files only (no auth, no config) in kiss's
  `agent-sessions` GridFS bucket with kiss's metadata, so kiss's purge
  covers it; the archive is tagged as a Maki session so kiss's readers can
  tell it from a Pi one. Checkpoint after every round, rotated as kiss does
  (write the new archive, then remove the previous one). oskhs carries the
  tar; the sandbox never touches Mongo. Starts minimal, converges on the A2
  (P5) export format.
- *Code needs no archive.* Code rounds commit and push to the task's MR
  branch, so a restore is re-sync, worktree on the task's branch, unpack
  the session, `--resume`. Only the agent's memory is irreplaceable.
- *Lifecycle.* `absent → warm → archived → warm`; terminal or cancelled →
  removed. The claim stays short — the worker still releases the task to
  `idle_stopped` after its rounds (holding it would block the project's
  slot); warmth lives in the sandbox. A GC sweeper removes workspaces idle
  longer than `idleTtlMs` (else a default) after a final checkpoint, and
  caps warm workspaces per sandbox (LRU). On wake: warm → resume in place;
  absent → restore from GridFS; no usable archive → a fresh session with
  the full task prompt plus the follow-up, logged `session-lost` and noted
  in the reply — never silent (G1).
- *Sandbox loss.* `ensureSandbox` recreates it, sync seeds with a full
  bundle, the round re-pins the provider and rewrites Maki's config as it
  already does; restore covers the session.

Slices, both against the local kiss stack (B1.5 paused):

- **B2.1 — Warm continuity** (½–1). *Research first, findings in the
  change's design before any code:* where Maki keeps sessions in the sandbox
  (`~/.local/state/maki/…`?) and whether one session's files can be tarred
  alone; whether `--resume` accepts a different `--model` when the
  project's kiss provider changes between rounds (and what to do if not).
  Then: session id, workspace kept between rounds, `--resume`, the GC
  sweeper on `idleTtlMs`. **Exit:** a three-round dev-stand thread whose
  later answers depend on earlier rounds' context.
- **B2.2 — Durable sessions** (1). GridFS checkpoint and restore,
  `sessionInfo`, the `session-lost` fallback. Until B2b lands, kiss's
  admin Session tab shows the archive's metadata but cannot render a Maki
  transcript. **Exit:** deleting the sandbox mid-conversation and
  continuing re-seeds, restores from GridFS, and the next answer still
  depends on earlier rounds.

### B2b — Maki transcripts in kiss admin (kiss repo) — 1–1½ sessions

kiss's admin task page has a Session tab (`SessionTab`,
`SessionTranscript`) fed by `/tasks/:id/session-archive` and a transcript
built from the Pi archive (`buildSessionTranscript`). B2.2 puts Maki
archives in the same place. This milestone teaches kiss to read them:

- Audit every kiss reader of `sessionInfo` and `agent-sessions` (admin API,
  `TaskExecutor`, purge) so none tries to restore or parse a Maki archive
  as Pi's; dispatch on the archive's tag.
- A Maki transcript builder next to the Pi one, mapping Maki's session
  records onto the transcript model the admin UI already renders, extended
  where Maki has more: per-round boundaries (one per kiss round or
  follow-up), tool calls with arguments and folded output, file edits as
  diffs, model and token usage per turn, and restore/`session-lost` markers.
- Stories and tests next to the existing `SessionTranscript` ones, with a
  fixture archive captured from a B2.2 dev-stand run.

**Exit:** opening an oskhs task in kiss admin shows its full Maki
conversation across rounds, readable as the Pi transcripts are; Pi tasks
render unchanged.

### B3 — Feature parity (W4) — 2–3 sessions

kiss's task process provides features oskhs does not yet: project skills,
project MCP servers (path from the sandbox — open question 3), self-review,
model selection and fallback, attachments and artifacts (GridFS), usage
accounting. Each lands as an oskhs feature over the task-document contract.

**Exit:** an existing project's config works unchanged when its channel is
marked for oskhs.

B2 and B3 can swap if parity matters more than durability. B2b needs only
B2.2 and can run alongside B3 in the kiss repo; it lands before B4.

### B4 — git LFS (W4) — ½–1 session

Bundles carry only LFS pointers, and the sandbox has no GitLab egress, so
oskhs ships LFS objects next to the bundle. Until B4 lands, oskhs-marked
projects should be ones without LFS-tracked files the agent needs.

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

### B5 — Remote gateways and large seeds (W3) — ½–1 session

- oskhs drives a gateway on another host (home or work box) registered with
  `openshell gateway add` over mTLS or Tailscale (A1 makes this a
  `maki-oss gateway` command); upload/exec/download confirmed over the
  network.
- Resumable seed for tens-of-GB repos: the seed bundle is sent in chunks
  that survive a dropped connection and resume where they stopped.
- Keys on remote hosts: the project's model key now lives on that gateway
  and is readable by its mTLS operators. Each gateway gets its own key, with
  provider-side spend limits where available, so revoking one gateway is a
  key rotation.

**Exit:** a marked channel's tasks run on a remote gateway; prod Mongo is
unreachable from that host; a large repo seeds over the uplink despite an
interrupted transfer.

### B6 — Multiple gateways (W3+W4) — 1–1½ sessions

- Routing: marker grows into a selector (project/channel → gateway); a
  heartbeat registry of gateways following the `networkProxyInstances`
  precedent (TTL heartbeat, ~40-line model); warm sandboxes per
  (project, gateway). Routing honors network reach: projects with internal
  models (`isExternal: false`) go only to gateways that can reach them.
- OpenShell workspaces per project: providers and sandboxes isolated per
  project, oskhs as Workspace Admin in each. Creating workspaces needs a
  Platform Admin and the docs do not describe machine identities — decide
  here whether to adopt.
- Hardening and docs: gateway loss handling, operator playbook.

**Exit:** two channels route to two different gateways; stopping one
gateway fails its tasks visibly instead of stalling them; G3 demonstrably
done.

### B7 — Second agent through oskhs (W4) — ~1 session

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
  objects per pair; B6 routing picks the gateway.
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
Track B (kiss):      B1.1a ─► B1.1b ─► B1.2 ─► B1.3a ─► B1.3b ─► B1.3c ─► B1.3d ─► B1.4
                     ─► B2.1 ─► B2.2 ─► B3 ─► B2b ─► B4 ─► B5 ─► B6 ─► B7
                     B1.5 paused (local kiss stack until resumed); B2b may
                     start right after B2.2, alongside B3
Cross:               A1 ─► B5    (remote gateway selection)
                     A2 ┄► B2    (soft: session tar converges on P5's format)
                     A5 ─► B7    (headless rounds for the second agent)
```

The tracks run in parallel. B1.1a–B1.2 need neither kiss nor Track A and
can start immediately against the local gateway; B1.3a is independent work
in the kiss repo and can run alongside them.

| Track | Milestones | Sessions |
|---|---|---|
| A | A1 1½, A2 2–2½, A3 1½–2, A4 1, A5 ~1 | 7–8 |
| B | B1 6–8½, B2 1½–2, B3 2–3, B2b 1–1½, B4 ½–1, B5 ½–1, B6 1–1½, B7 ~1 | 13½–19½ |

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
| M6 K2 (`MakiService`) | B1.1a–B1.2 (round), B2 (sessions), B3 (parity) |
| M7 K3 / K4 | marker in B1.3, prod in B1.5, remote gateway in B5, multi-gateway routing in B6 |
| M8a / M8b | A5 / B7 |

## Open questions

1. ~~**Where oskhs runs**~~ — decided 2026-10-23: near Mongo; credentials
   never leave the cloud, gateways reached with `--remote`.
2. **Repo size shape** — answered 2026-10-23: both large history and large
   working trees (binaries, LFS). Bundles cover history; LFS needs its own
   path (B4); vendored non-LFS binaries travel once at seed time, then as
   deltas.
3. **MCP from the sandbox** — kiss's project MCP servers run in the task
   process today (`PiMcpBridge`); maki in the sandbox needs a reachable path
   that does not carry their secrets inside. Decide in B3.
4. ~~**Seeding a warm sandbox**~~ — decided 2026-10-23: one-time upload over
   the uplink (no GitLab credentials or egress in the sandbox); B5 makes the
   seed resumable.
5. **Kiss restricted-network mode in prod** — is `NetworkIsolationService`
   active? oskhs refuses restricted tasks fail-closed; confirm what that means
   for marked channels before B1.5.
6. **Attach model** (canonical process vs tmux) — decided by P0b/P3 in A3.
7. **cwd portability** — if two gateways' workdirs can differ (path-derived
   naming), transfer must normalize or document the constraint; P0a answers
   Maki's behavior, A2 owns the policy.
8. **opencode attach story** — local-only vs in-sandbox server (A5).
9. **Per-task model keys** — kiss or an LLM proxy in front of the providers
   issues a short-lived virtual key per task with a budget; OpenShell's
   dynamic credentials (`token_grant` / `refresh` in profiles) deliver it.
   A leaked or misused key dies with the task, and per-task cost accounting
   comes for free. Needs that proxy; revisit after B5.

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
- The interactive session sync applies a git patch, so deletions and renames
  travel back and a conflict never overwrites the host. The remaining
  merge-only paths are the explicit `maki-oss download` escape hatch and the
  A2 session-transfer copies, which do not propagate deletions; Track B avoids
  them with git bundles.
- Session archives older than kiss's 30-day purge are not durable history;
  Maki's own state in the sandbox plus P5 export are the long-lived copies.
