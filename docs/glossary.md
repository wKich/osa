# Glossary

Shared vocabulary for the osa docs. Each term has one definition;
the same words are used consistently in `docs/`, `examples/`, and the AI
reference pack.

- **osa** — the project and repository. It hosts the agent front-ends and the
  `osa` command, which reports on every project and resolves pending sync
  output with `osa resolve`.
- **maki-oss** — the Maki front-end command (`bin/maki-oss`). Its command,
  environment prefix, and config path are unchanged by the repository rename.
- **opencode-oss** — the OpenCode front-end command (`bin/opencode-oss`),
  likewise unchanged.
- **claude-oss** — the Claude Code front-end command (`bin/claude-oss`), with
  the `CLAUDE_OSS_` prefix.
- **codex-oss** — the Codex front-end command (`bin/codex-oss`), with the
  `CODEX_OSS_` prefix.
- **Gateway** — the OpenShell control plane that runs on a host or cluster and
  manages sandboxes, policies, providers, and access.
- **Sandbox** — the isolated workload environment (Docker container or MicroVM)
  that OpenShell creates to run an agent such as Maki.
- **Base image** — the agent-only image built by the matching helper's
  `image build`: `maki-agent:local` (Maki), `opencode-agent:local` (OpenCode),
  `claude-agent:local` (Claude Code), or `codex-agent:local` (Codex). It
  carries the pinned agent runtime, the non-root sandbox identity, the
  filesystem/Landlock settings, and the baked deny rules that protect the
  configuration. It declares no MCP servers, installs no MCP-specific runtime,
  and sets no personal UI preference. Maki's base also pre-answers folder trust
  and starts every session in YOLO mode.
- **Environment store** — a user-owned Docker build context, outside this
  repository, whose `Dockerfile` builds `FROM` the selected agent's base image.
  It carries the user's MCP configuration, runtime and package installs, skills,
  plugins, and personal preferences. It contains no credential value; the
  repository ships only the opt-in reference store at
  `examples/environments/reference/`.
- **Derived image** — the tag produced by building an environment store (for
  example `maki-agent:reference`). The helper selects it through the existing
  `image` setting; the matching `image build` still builds only the base.
- **Global, project-local, and credential state** — global environment content
  lives in the environment store and its derived image; project-local agent
  configuration (for example `.maki/`, `.opencode/`, `.claude/`, or Codex's
  `AGENTS.md`) travels with the uploaded project; and credentials plus egress
  stay in OpenShell provider profiles.
- **Supervisor** — the OpenShell runtime process that starts and watches the
  sandbox workload, mediates DNS and TCP, and enforces policy at the boundary.
- **Base policy** — the sandbox's own policy, before attached providers
  contribute any rules.
- **Effective policy** — the base policy plus the rules contributed by attached
  providers; the policy the sandbox actually enforces.
- **Provider** — a gateway-stored credential instance created from a profile
  and attached to sandboxes (for example, `maki-anthropic`).
- **Profile** — a reusable provider definition naming credentials, network
  endpoints, allowed binaries, and optional refresh behavior (for example,
  `examples/providers/maki-anthropic.yaml`).
- **Generated profile** — a custom provider profile written by
  `maki-oss provider setup` under the helper's config directory
  (`~/.config/maki-oss/profiles/`); it contains configuration only,
  never a credential value.
- **Catalog mapping** — `examples/providers/catalog.tsv`, the machine-readable
  table that resolves a credential-store slug (`maki`/`opencode` plus the
  provider id) to a curated profile id.
- **Credential store** — a host-side file where an agent keeps its own
  provider credentials, such as Maki's
  (`~/.local/state/maki/auth/<slug>.json`) or OpenCode's
  (`~/.local/share/opencode/auth.json`); the setup wizard scans these without
  printing values.
- **Credential placeholder** — the opaque stand-in a sandbox process receives
  instead of a real secret: a revision-scoped token that ends in `_<VARIABLE>`.
  The proxy substitutes the real value only at endpoints the profile
  authorizes. Its literal prefix is deliberately never written anywhere in this
  repository: the proxy answers 403 to any request body containing it, the
  agent sends loaded files in every request body, and one literal spelling in
  a file Maki reads breaks every later request.
- **Landlock** — the Linux security module OpenShell uses to confine sandbox
  processes to the filesystem paths the policy lists; it requires Landlock ABI
  v3 (Linux 6.2 or newer).
- **seccomp** — the syscall filter OpenShell applies to sandbox processes to
  block escape, observation, and filter-evasion primitives such as `mount` and
  `ptrace`.
- **Network namespace** — the isolated Linux networking stack each sandbox gets,
  which forces every outbound connection through OpenShell's proxy.
- **OCSF** — Open Cybersecurity Schema Framework, the structured event format
  OpenShell uses for its policy and activity log lines.
- **Policy advisor** — the optional OpenShell feature that turns denied
  requests into reviewable network-rule proposals through the in-sandbox
  `policy.local` API.
- **Policy prover** — OpenShell's SMT-solver check (`openshell-prover`) that a
  candidate policy grants no more access than a boundary policy.
- **Workspace** — an OpenShell scoping unit for resources such as providers and
  profiles; a local single-user gateway uses the `default` workspace.
- **Project workspace** — the tracked project tree inside the sandbox workdir
  (default `/sandbox/project`). It is disposable: the host tree is the source
  of truth and the collected patch is the durable output. Maki sessions and
  installed dependencies live in the container, not in the project workspace.
- **Sync state** — the classification of a project workspace at session start:
  - **clean** — the host and sandbox trees match the recorded pair; the
    session starts without an upload.
  - **behind** — the host tree moved and the sandbox did not; the helper
    refreshes the project workspace from the host before Maki runs.
  - **retained** — a collected patch on the host covers the sandbox output;
    the next session refreshes the project workspace and keeps the patch for
    review. Retained does not block.
  - **parked** — the sandbox holds output with no durable patch (collection
    failed, `--no-sync`, or a manual edit); the helper refuses to upload over
    it or launch Maki until the output is downloaded or discarded with
    `--discard`.
- **Rescue copy** — a full download of a parked project workspace into
  `rescue-<timestamp>/` in the sandbox's session directory, made by
  `osa resolve <sandbox> rescue`. It is a backup: the workspace stays parked.
- **Dropped patch** — a retained patch set aside with
  `osa resolve <sandbox> drop --yes`: the marker is cleared and the patch file
  moves to `dropped/` in the session directory, where `git apply` can still
  use it.
- **Project layer** — the agent-neutral part of the helpers (in
  `lib/oss-core.sh` and `lib/osa-state.sh`) that binds host project folders
  to sandboxes and syncs them, between the agent front-ends (`maki-oss`,
  `opencode-oss`, `claude-oss`, `codex-oss`) and the `openshell` CLI. `osa`
  reports on it.
- **State root** — `~/.local/state/osa/`, where every front-end keeps its
  registry entries and session state.
- **Project registry** — one entry per project folder and agent,
  `projects/<sandbox>.toml` under the state root, recording the folder, the
  sandbox name and ID, and the host fingerprint. An entry whose folder is
  gone is an **orphan**.
- **Agent tag** — the two-letter agent code in registry entries and default
  sandbox names: `mk` (Maki), `oc` (OpenCode), `cc` (Claude Code), and `cx`
  (Codex).
- **State contract** — the registry entries and `pending` markers, published
  as versioned flat TOML for other tools to read without writing.
- **Host fingerprint** — a cheap marker of a git project's host state
  (`HEAD` plus a checksum of `git status` and the diff), recorded at each
  sync point so `osa status --quick` can tell whether the host changed since
  without hashing the tree.
- **Template** — a reusable sandbox workload definition (image, resources,
  settings) that `openshell sandbox create --template` can instantiate.
- **MCP config** — the selected agent's table of MCP servers: Maki's
  `~/.config/maki/mcp.toml` and `/sandbox/.config/maki/mcp.toml`, OpenCode's
  `opencode.json` `mcp` key, Claude Code's `.claude.json` `mcpServers`, or
  Codex's `[mcp_servers.<name>]` tables. The host file is never read by the
  sandbox; the baked copy comes from an environment image. Changing the server
  set therefore means rebuilding the environment store and selecting its
  derived image. Each base image declares zero servers.
- **MCP readiness** — the per-server report printed by `maki-oss mcp status`
  and, as an informational section, by `maki-oss doctor`: for each server
  whether it is present in the sandbox's MCP config, its provider is attached,
  its endpoint is in the effective policy (HTTP servers), and its runtime
  resolves in the sandbox (stdio servers). It is read-only and prints no
  credential value.
- **Stdio runtime gate** — the MCP readiness check that the command a stdio
  server's `command` array names exists in the sandbox. A missing runtime is
  reported with the environment-image build guidance and the environment
  playbook as the fix; the helper never installs a runtime or package into a
  running sandbox.
- **oskhs** — the host-side adapter (`oskhs/`) that runs kiss agent rounds in
  OpenShell sandboxes; holds every database and GitLab credential outside
  the sandbox ([docs/oskhs.md](oskhs.md)).
- **Warm repo sandbox** — the long-lived per-project sandbox `repo-<project>`
  holding a bare repository seeded once with full history; rounds reuse it.
- **Task worktree** — the detached git worktree `/sandbox/tasks/<task-id>`
  a single round runs in; removed when the round ends.
- **Round** — one headless Maki run for one task in its task worktree,
  ending in a typed result (`answer`, `agent-error`, `timeout`, `failed`).
