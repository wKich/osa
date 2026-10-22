# Roadmap: portable sandboxed agent sessions and kiss orchestration

Planning document. Implementation goes through OpenSpec changes, one per
roadmap item; nothing here ships without its spec delta. Item IDs (`G`, `M`,
`P`, `K`) are stable references for discussion.

**Status:** draft, 2026-10-22. Research basis: OpenShell v0.1.5, Maki v0.6.4,
kiss repo survey (same date).

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

## Workstreams

| ID | Workstream | Area |
|---|---|---|
| W1 | Gateway management | `bin/maki-oss`, `docs/` |
| W2 | Attach + transferable sessions | `bin/maki-oss`, `examples/maki-image/`, `docs/` |
| W3 | OpenShell kiss adapter (`oskhs`) | kiss repo |
| W4 | Agent runtimes for oskhs (maki, then others) | kiss repo, maki-oss |
| W5 | Additional coding agents in maki-oss | `bin/maki-oss`, `examples/` |

## Milestones

### M0 — De-risking spikes (no shipped code) — ½+½ sessions, both tracks

- **P0** — Answer two unknowns inside one container: (a) does `maki --resume`
  survive a cwd mismatch or absence (session header records absolute cwd);
  (b) does an `exec`-launched process survive connection drop, i.e. is the
  canonical-process redesign required for attach.
- **K0** — Verify kiss's swap points with its existing mocks: the
  `createAgentModelRuntime` factory (currently ignores its `runtime` arg) and
  the concrete `DockerAgentRunner` injection into `KissHostService`; run the
  claim CAS against a dev Mongo from a second process.

**Exit:** written answers for (a)/(b); M2 attach model chosen or rejected;
factory swap proven. P5 sizing depends on P0a; M3 honesty depends on it.

### M1 — Multi-gateway foundation (W1) — 1½ sessions

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

### M2 — Session durability and attach (W2) — 1½–2 sessions

- **P3** — ADR: agent-lifetime model, prototyped in a scratch sandbox.
  Canonical process (`sandbox create --detach -- launcher` + `sandbox
  connect`, gains 1 MiB replay and sleep/wake recovery) vs tmux-in-sandbox.
  Decision gated on P0b.
- **P4** — `maki-oss attach` reattaches to the live TUI; terminal death no
  longer kills the in-flight turn; per-invocation flags (`--continue`,
  `--resume`) still work via the launcher's flags file.

**Exit:** kill a terminal mid-task on an always-on gateway, `attach` from
another machine, observe replayed output and an uninterrupted turn.

### M3 — Transferable sessions (W2) — 2 sessions

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

### M4 — Session management UX (W1+W2 closure) — 1 session + ½ docs

- **P7** — `maki-oss sessions` lists sandboxes across all registered
  gateways with phase and live session ids; `attach`, `session transfer`,
  `resume`, `stop` reachable from one place.
- **P8** — Docs and dogfood: real work→home→work transfer recorded in
  `docs/verification-log.md`; playbooks, glossary, references updated and
  link-checked.

**Exit:** G1 + G2 demonstrably done; a new user performs the full flow from
docs alone.

### M5 — oskhs prototype, dev stand (W3) — 1 session

- **K1** — `OpenShellAgentRunner` implementing kiss's de-facto runner surface
  (`healthCheck`, `getRunningCount`, `getMaxConcurrent`, `runTask`,
  `inspectTask`, `cleanup`): per-task sandbox named `kiss-task-<id>`,
  clone-from-git (no bind mounts — `GIT_CACHE_DIR`/`/logs` mounts do not
  exist here), restricted-network tasks refused fail-closed. `KissHostService`
  already accepts a runner by constructor.

**Exit:** a dev-stand kiss task executes end-to-end in a sandbox on a local
gateway; prod untouched; reply lands in Mongo as with the docker runner.

### M6 — maki as a kiss runtime (W4) — 1–2 sessions

- **K2** — `MakiService implements IAgentModelRuntime` with its own
  `runtime: 'maki'` + formatVersion (never masquerade as Pi; the session
  guard rejects foreign archives). Rounds = headless `maki-oss run --resume`
  (maki's flock is free between rounds); `saveSession` = P5 export artifact →
  GridFS tar; `restoreSession` = download + import; idle-stop honors
  `idleTtlMs`; between rounds the orchestrator drives `AgentSubTask` input
  exactly as today.

**Exit:** a Mattermost thread drives multi-round maki work in a persistent
sandbox; container loss recovers the conversation from GridFS; M3 transfer
serves as the disaster-recovery story.

### M7 — Affinity and production shape (W3+W4) — 1–1½ sessions

- **K3** — Claim affinity: extend `claimTask` with an optional runner
  selector (project/channel → gateway tag) and a heartbeat registry doc,
  following the `networkProxyInstances` precedent (TTL heartbeat). Until this
  exists, an oskhs poller competes for *every* queued task — dev stand only.
- **K4** — Deployment: cloud-side adapter holding the Mongo URI, registered
  to the home OpenShell gateway with `--remote` (mTLS or Tailscale); secrets
  only via kiss's `SecretStore`; docs.

**Exit:** a named channel's tasks route to a chosen gateway; prod Mongo never
reachable from home networks; G3 demonstrably done.

### M8 — Additional coding agents (W5 + W4 generalization) — 2 sessions, splittable

- **M8a — maki-oss side:** an agent manifest (state dir, launch flags,
  resume flags) so attach/export/transfer work beyond maki; image variants
  under `examples/` (multi-ARG build rather than per-agent copies); headless
  round support for claude/opencode in the sandbox.
- **M8b — oskhs side:** `AgentRuntime` union extended per agent, factory
  selection by task/project config, per-runtime session format handling.
- Open scoping item: opencode's local bridge mode has no attach story today
  (bridge runs on the host). Either accept local-only for opencode or design
  `opencode --server` inside the sandbox exposed via `openshell service
  expose` — decide during M8a, not before.

**Exit:** at least one non-maki agent completes attach/export/transfer locally
and one runs rounds through oskhs; G4 demonstrably done.

## Sequencing

```
Track A (maki-oss):  M0a ─► M1 ─► M2 ─► M3 ─► M4 ─► (M8a)
Track B (kiss):      M0b ─► M5 ─► M6 ─► M7 ─► (M8b)
Cross:              M1 ─► M5 (runner uses gateway selection)
                    M3 + M6 ─► M8  (export format + runtime factory are its inputs)
```

Track A and Track B run in parallel; neither blocks the other until M8.
Fastest path to the original work→home question: M0a → M1 → M3 (attach, M2,
can slip behind transfer if needed — transfer does not depend on it).

## Open questions

1. **Attach model** (canonical process vs tmux) — decided by P0b/P3.
2. **Kiss restricted-network mode in prod** — is `NetworkIsolationService`
   active? Affects K1 fail-closed behavior; must be answered before M5.
3. **Git/MR contract for sandboxed rounds** — sandbox clones independently;
   its work must land as branch/MR in the shape `GitLabMRTaskSource` expects.
4. **cwd portability** — if two gateways' workdirs can differ (path-derived
   naming), transfer must normalize or document the constraint; P0a answers
   Maki's behavior, M3 owns the policy.
5. **opencode attach story** — local-only vs in-sandbox server (M8a).

## Carried risks

- Gateway host must be always-on (laptop lid kills everything else).
- Claim CAS has no host filter before K3: never point a prototype at prod.
- Merge-only transfer never propagates deletions — documented, accepted.
- Session archives older than kiss's 30-day purge are not durable history;
  Maki's own state in the sandbox plus P5 export are the long-lived copies.
