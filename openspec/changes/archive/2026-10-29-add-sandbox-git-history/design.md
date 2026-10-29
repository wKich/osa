# Design

## Context

See `proposal.md` for motivation. The current caller contract is in
`openspec/specs/caller-workspace-sync/spec.md` and `docs/helper.md`:

- `sync-in` clears the workdir, uploads the `.gitignore`-filtered tree, and
  records a baseline commit in a git directory outside the workdir, keyed by
  the workdir path (`caller_git_dir` in `lib/oss-core.sh`).
- `collect-patch` snapshots the workdir into a result tree and diffs it
  against the baseline. It never touches the host tree.
- The workdir has no `.git`, so Conveyor's reviewer roles cannot run
  `git diff`, `git log`, `git status`, `git show`, or `git blame`.
- The M1 live run uploaded 2,240 files / 14.8 MB in about 1.25 s; the tree is
  small enough that a full snapshot per pass is acceptable for M2.

Two earlier documents constrain the follow-up:

- The M1 design (`openspec/changes/archive/2026-10-28-add-caller-sync-primitives/design.md`)
  defers history to M2 and self-check to M3.
- The older `docs/conveyor-roadmap.md` (only on the unmerged
  `docs/align-agent-pages` branch) describes a different track where the
  Conveyor runner itself runs inside the sandbox. The current M1/M2/M3 plan
  keeps the runner on the host and runs only the agent in the sandbox.

### Host-git spike result

A host bare repository exposed directly as a git remote was tested on
2026-10-29: macOS Docker Desktop, OpenShell 0.1.5, `claude-agent:local`.

- Host: `git daemon --listen=127.0.0.1 --port=39418 --enable=receive-pack`
  serving a 20 MB scratch bare repository.
- Sandbox policy:
  `/usr/bin/git` -> `host.docker.internal:39418`, `protocol: tcp`,
  `allowed_ips: 0.250.250.254/32`.
- Result: the sandbox cloned the repository in 0.71 s and pushed a commit
  back in 0.19 s; the host bare repository received it.
- It worked because Docker Desktop maps `host.docker.internal` to its
  host-gateway proxy (`0.250.250.254`), the supervisor container runs on the
  Docker host network, and `allowed_ips` authorized that exact address. The
  daemon bound to the host loopback only, so there was no LAN exposure on this
  setup.

This is recorded evidence from the other agent's scratch spike, not a test
rerun during this consolidation. It proves clone/push connectivity for that
setup, not authentication, cross-task isolation, TLS, or portability.

## Goals / Non-Goals

**Goals:**

- A git `HOST_TREE` produces a sandbox workdir with the host's reachable
  history, while the uploaded tree remains uncommitted so Conveyor's
  developer/reviewer semantics do not change.
- The existing baseline and `collect-patch` contract stay intact.
- `--base REF` makes a reviewer's `git diff origin/<base>` work.
- A non-git `HOST_TREE` keeps the M1 behavior.
- No host bind mount, no host git service, and no new long-running host
  process.

**Non-Goals:**

- Making a host bare clone a network remote for the sandbox.
- `git push` from the sandbox, or changing Conveyor's host-side commit
  boundary.
- Self-check in the sandbox (M3), a warm sandbox (M2b), or reference
  repositories for `--add-dir` (M2c).
- Incremental or shallow sync; submodule and Git LFS object support.

## Decisions

### Bundle in, patch out, not a host git remote

The host creates a `git bundle` of `HEAD` plus the optional `--base` commit,
uploads it next to the filtered tree, and the sandbox creates a real
repository from it. The return path stays `collect-patch`.

- **Alternative: upload `.git` with the tree.** Rejected. A `.git` directory
  carries hooks, config, reflogs, stash entries, unrelated refs, and old
  objects; it is larger than a reachable-object bundle and bypasses the clean
  upload filter. The M1 run measured 77 MB of `.git` at the time versus a
  3.3 MB bundle for the same `osa` `HEAD` (3.2 MB for `conveyor.ai`).
- **Alternative: host bare repository as a network remote.** Tested; works
  locally (see Context), but rejected as the default. The host address is
  runtime-specific (`host.docker.internal` on Docker Desktop, host-gateway or
  LAN IP on Linux, node IP on Kubernetes, the gateway host on a remote
  gateway). The tested TCP route used an explicit `allowed_ips` restriction;
  this is not universal: OpenShell also supports explicit hostname endpoints
  resolving to private addresses and host-gateway aliases. A remote needs a
  host service and authentication/isolation for push. In this spike,
  connections appeared as `127.0.0.1`, so source-IP ACLs could not distinguish
  tasks. Per-task ports are not authentication; separate daemons are not
  mandatory with authenticated repository-level authorization. A writable Git
  server parses untrusted protocol on the host. Keep this as a local/M4
  option, not the M2 default.
- **Alternative: upload a bare repository into the sandbox.** It gives local
  `git clone`/`push` semantics, but copies the whole repository both ways and
  still does not solve the dirty-worktree overlay; `collect-patch` is smaller
  and stateless.
- **Alternative: host-initiated `git fetch ext::openshell sandbox exec ...`.**
  It can pull a pack from the sandbox, but it does not provide sandbox -> host
  push and is more complex than the existing patch return path.

### Separate agent repository and baseline repository

The helper keeps the baseline where it is (`caller_git_dir`, keyed by the
workdir) and creates a second git directory for the agent repository, for
example `<caller-state>/<key>-repo`. The workdir `.git` file points to the
agent repository.

- The baseline commit stays unreachable from the agent's `HEAD` and ordinary
  `git log`; `collect-patch` continues to use the baseline git directory.
- Ordinary workdir commands such as removing `.git`, running `git init`, or
  committing do not address the separate baseline. This is operational
  separation, not a security boundary: an agent with the same uid and writable
  access to caller-state can explicitly find and alter the baseline. The
  sandbox, not this directory layout, remains the security boundary.
- **Alternative: one git directory for both.** It exposes baseline refs in
  ordinary repository commands and increases accidental coupling. Separating
  directories avoids that coupling but does not stop explicit same-uid access.
- **Alternative: `git worktree add`.** It checks out a clean tree and would
  discard the uploaded uncommitted files unless they are reapplied; the
  `read-tree` path is simpler.

### The uploaded tree remains uncommitted

After the bundle is fetched, the helper sets `HEAD` to the host commit,
`read-tree`s the host tree into the index, and runs a mixed `reset`. The
workdir keeps the uploaded files, `git status` shows the host's uncommitted
changes, and `git diff` shows them. The index is seeded from host `HEAD`, not
copied from the host index: staged changes become unstaged; partially staged
files retain their on-disk contents but not their staging split.

- This preserves Conveyor's model: the human's work stays uncommitted until a
  human commits.
- If the agent commits anyway, `collect-patch` still captures the worktree
  tree; the patch includes the commit's changes.
- **Alternative: make the dirty snapshot a commit and check it out.** It gives
  a clean `git status` and changes reviewer semantics: `git diff` would no
  longer show the human's uncommitted work. Internal transport commits do not
  inherently violate human-owned project commits: a future exchange could
  keep them out of project history and apply only their tree delta on the
  host. It still needs a dirty-tree overlay or revised reviewer comparisons.

### Bundle outside the workdir

The bundle is uploaded to a sandbox path outside the workdir (the same
caller-state area as the baseline) and removed after the fetch. It does not
appear in the file count, the baseline tree, or the patch. The helper-created
`.git` file and repository metadata are likewise excluded from JSON file and
byte counts.

- **Alternative: put the bundle in the workdir.** It would pollute
  `sync-in --json` counts and the agent's view, and `collect-patch` would have
  to exclude it.
- **Alternative: stream the bundle over `sandbox exec` stdin.** The 4 MiB exec
  input limit and the need for a binary-safe stream make a file upload
  simpler.

### `--base` is resolved on the host

`--base REF` is resolved with `git rev-parse REF^{commit}` in `HOST_TREE`
before any gateway call. The commit is included in the bundle, and the sandbox
gets `refs/remotes/origin/<name>`. For branch or remote-tracking refs, use
the short branch name including slashes, stripping `refs/heads/` or
`refs/remotes/<remote>/` as appropriate after resolving the symbolic ref. For
a commit id, tag, or other commit expression, use the fixed name `base`. Thus
`--base origin/master` enables `git diff origin/master`; `--base <sha>`
enables `git diff origin/base`. Resolve and validate the destination ref on
the host before any gateway call. Never interpolate unchecked refs into
sandbox shell commands.

- **Alternative: bundle every remote-tracking ref.** It is larger and can
  expose branches the task does not need.
- **Alternative: no base.** `git log` works, but a reviewer command that names
  `origin/<base>` fails.
- A missing ref, or `--base` on a non-git tree, is a usage error before the
  gateway; the exact exit code is 1.

### Non-git fallback and failure behavior

If `HOST_TREE` is not a git worktree, `sync-in` keeps the M1 behavior: upload
the tree, record the baseline, no `.git`. If bundle creation fails, the helper
exits 2 (dependency/tool failure); if the upload, fetch, or repository setup
fails, it exits 3 (gateway/sandbox). In either case it clears the baseline so
`collect-patch` rejects the half-synced state.

- **Alternative: always fail on a non-git tree.** It would break generic
  callers that use `sync-in` for plain directories.
- **Alternative: fall back silently when a git tree's bundle fails.** It would
  leave a reviewer without history while looking successful; a caller that
  needs history passes `--base` and sees the failure.

### History is limited to the requested refs, but old blobs still travel

The bundle contains objects reachable from `HEAD` and the optional base. It
does not copy host config, hooks, reflogs, stash, remotes, or credential
helpers. It does include old blobs in that history; if the repository ever
contained secrets in commits, the agent and model context can see them.

- Document this in `docs/helper.md`.
- A shallow/limited bundle is a later option if history size or secret
  exposure matters; `git bundle` does not expose a simple `--depth` flag, so
  it needs a separate design.
- Submodule and Git LFS objects are not included; a review that needs them is
  out of scope.

## Risks / Trade-offs

- **Full-history bundles are large for long-lived repositories** -> Measure in
  the live check; M4 incremental sync remains the mitigation. The local
  measurements (3.3 MB / 3.2 MB) are small for the two repositories tested.
- **Old secrets in history reach the agent/model** -> Limit refs to `HEAD` and
  the requested base; document; consider a shallow/curated bundle later.
- **The agent can explicitly damage the separate baseline too** -> Separate
  repositories prevent accidental coupling, not malicious tampering by the
  same uid. Keep host-side review and human-owned commits; do not claim the
  baseline is protected from the sandbox agent.
- **The host tree can change between `sync-in` and patch apply** -> The caller
  runs `git apply --check`; M4 adds host-change detection.
- **A linked worktree or shallow/alternate host repository may bundle
  differently** -> The helper resolves `HEAD`/base in `HOST_TREE`; linked
  worktrees were verified. A bundle failure is explicit, not silent.
- **`git init --separate-git-dir` and `read-tree` require a modern git** ->
  The image is Ubuntu 24.04 with git 2.43; the live check pins the behavior.
- **The workdir now has a `.git` file, which some callers might treat as host
  metadata** -> The spec distinguishes helper-created metadata from host
  metadata; `collect-patch` excludes it.
- **Submodules and Git LFS are not represented** -> Document as out of scope;
  a task that needs them must use a different checkout.

## Migration Plan

1. Implement the helper and tests together; keep the M1 behavior for non-git
   trees so existing callers are unaffected.
2. Update `docs/helper.md` and the caller spec delta.
3. Verify on a live OpenShell gateway: a dirty git worktree, `sync-in`, a
   reviewer-style `git log`/`git diff origin/<base>`/`git blame`, then
   `collect-patch` and `git apply` on the host.
4. Conveyor passes `--base origin/<base>` from its host; no Conveyor-side code
   is required for the osa change itself.
5. Rollback is the previous helper; sandboxes created before the change keep
   their old no-history layout, and a new `sync-in` replaces it.

## Follow-up Work

- **M2b — warm sandbox and sessions.** Reuse one sandbox per task so
  `--resume` and `--fork-session` work; the current M1/M2 change still creates
  one sandbox per pass.
- **M2c — reference repositories and read-only roles.** Sync `--add-dir`
  snapshots with history, prove a read-only reviewer returns an empty patch,
  and keep cancellation through the run tag/stop file.
- **M3 — self-check in the sandbox.** Add an environment image with .NET 10
  SDK and Node, egress for the internal Nexus (`nuget.config` points at
  `https://nexus.kontur.host/repository/nuget/index.json`), an osa
  `CreateExec` path for Conveyor's `SelfCheckExecutor`, TRX download, and a
  `.conveyor` exclusion in `collect-patch`. The host network must reach the
  internal feed, or the image must carry an offline package cache; this is a
  separate decision and a separate change. History transport does not itself
  implement self-check. Conveyor's `SelfCheckExecutor.RunAsync` currently
  refuses `maki-osa` checks rather than running project commands on the host;
  retain that fail-closed behavior until M3 is implemented.
- **Host-git scratch remote (local/M4 option).** A per-task bare repository
  served by a per-task daemon/port can give real clone/push and incremental
  transfers. It was tested successfully on macOS Docker Desktop (20 MB clone
  0.71 s, push 0.19 s) with a narrow policy rule, but it needs a host service,
  auth/isolation, and a snapshot of the dirty worktree. Keep it as a local
  optimization or M4 alternative, not the M2 default. Prefer authenticated
  HTTPS Smart Git to anonymous `git daemon` or the host SSH service. Enforce
  exact repository discovery/upload-pack/receive-pack HTTP routes and use
  provider-backed credentials through a scoped Git HTTP credential mechanism.
  HTTP rules cannot restrict refs, force-pushes, or deletions: enforce these
  server-side. Isolate the service with access only to the exchange repo, no
  host credentials or Docker socket, no automatic checkout/build/deploy,
  object validation, and request/storage limits. Do not share the canonical
  object store through alternates or treat namespaces/hidden refs as secret
  isolation. Full push needs internal result commits, validation, and host
  tree-delta reconciliation, never automatic merge into the human branch.
  HTTPS routing, TLS trust, provider authentication, and cross-task rejection
  were not validated by the TCP spike.
- **M5 — cross-task warm sandboxes and base snapshots (large repositories).**
  M2b reuses a sandbox per task; the per-task cost remains `up` plus a full
  `sync-in` snapshot (2,240 files / 14.8 MB / ~1.25 s on the M1 repository, but
  the transfer grows with the tree, and the bundle only removes the host `.git`
  cost, not the tree upload). Reuse one prepared sandbox or a per-repository
  base snapshot across tasks of the same repository and image, so a new task
  transfers only its delta instead of re-creating the container and re-uploading
  every file. Reuse must be keyed by repository, image, provider set, and base
  commit, and a task must never see another task's worktree, uncommitted
  changes, session, or attached providers: reset to the shared baseline outside
  the workdir, overlay the task tree, and clear both on hand-off. Nothing is
  reused when the key changes; the runner needs an idle/reaper policy because
  caller mode disables the idle stop. Measure against a large repository before
  choosing between a warm sandbox lease and an image/snapshot cache; this is a
  transfer optimization, not a substitute for M2b's session continuity.
- **Roadmap cleanup.** The old `docs/conveyor-roadmap.md` (runner inside the
  sandbox) is unmerged and contradicts the host-runner M0-M6 plan. Archive it
  with a superseded banner or rewrite it; do not maintain two roadmaps.

### Upstream references for the remote alternative

- OpenShell v0.1.5 host routing and enforced HTTP rules:
  <https://docs.nvidia.com/openshell/v0.1.5/how-it-works/policies/schema.md>.
- Provider credential substitution and endpoint binding:
  <https://docs.nvidia.com/openshell/v0.1.5/how-it-works/providers/profiles.md>.
- Git Smart HTTP authentication: <https://git-scm.com/docs/git-http-backend>.
- Protocol confidentiality limits: <https://git-scm.com/docs/gitnamespaces>.
- Object quarantine: <https://git-scm.com/docs/git-receive-pack>.
- Existing enforced repository-specific HTTP routes:
  `examples/policies/maki-git-push.yaml` (its unrelated API rule is unnecessary).

## Open Questions

- Should a reviewer role require `--base`, or is `HEAD` history enough for the
  first demo? The contract allows both; Conveyor can decide per role.
- Is a shallow or limited-history bundle needed for the target repositories,
  or is full reachable history acceptable? The local measurements are small,
  but the secret-history risk is real.
- Should `collect-patch --json` also report the host `HEAD` and base commit?
  It is not needed for the current caller; adding fields can wait.
- Should the agent repository be reused across `sync-in` calls when `HEAD` has
  not moved? The current M2 replaces it; a cache is an M4 optimization.
