# Notes: research and follow-up record

2026-10-29, macOS (Docker Desktop), OpenShell 0.1.5, `claude-agent:local`.
The scratch repositories contained no project data or credentials. The spike
and timings below were recorded by the previous agent and were not rerun in
the consolidation. The HTTPS alternative is documentation/source research,
not live-tested evidence.

## Host-git spike: bare repo on the host as a sandbox remote

Question: can the host keep a bare clone and let the sandbox use it as a git
remote (clone/push), instead of moving a bundle/patch?

Setup:

```sh
# host: a 20 MB scratch repository
git init --bare "$T/host.git"
git daemon --reuseaddr --base-path="$T" --export-all \
  --enable=receive-pack --listen=127.0.0.1 --port=39418 "$T/host.git"

# sandbox
openshell sandbox create --name osa-git-spike \
  --from claude-agent:local --detach -- /bin/bash -c 'sleep 1800'

openshell policy update osa-git-spike \
  --rule-name host_git \
  --binary /usr/bin/git \
  --add-endpoint 'host.docker.internal:39418::tcp::allowed-ip=0.250.250.254/32' \
  --wait

openshell sandbox exec -n osa-git-spike --no-login-shell --workdir /sandbox -- \
  sh -c 'git clone git://host.docker.internal:39418/host.git /sandbox/host-clone'
```

Result:

| Step | Result |
|---|---|
| Full clone (20 MB payload) | 0.71 s; 41 MB on disk including `.git` |
| Commit and `git push origin main` | 0.19 s; the host bare repo received the commit |
| Host daemon bind | `127.0.0.1` only; no LAN listener |
| Policy | exact `host.docker.internal:39418`, `protocol: tcp`, `allowed_ips: 0.250.250.254/32`, binary `/usr/bin/git` |

Why it worked: Docker Desktop maps `host.docker.internal` to its host-gateway
proxy (`0.250.250.254`), the supervisor container runs on the Docker host
network, and the policy authorized that exact address. The daemon log showed
connections arriving as `127.0.0.1` with the host attribute
`host.docker.internal:39418`. No bind mount was used.

Why it is not the default:

- `host.docker.internal` and `0.250.250.254` are Docker Desktop-specific. On
  Linux Docker use the host-gateway/bridge address and a non-loopback bind;
  Podman uses `host.containers.internal`; VM/Kubernetes use a host/node IP; a
  remote gateway means the gateway host, not the developer laptop.
- In this setup the daemon saw connections as `127.0.0.1`, so source-IP ACLs
  could not distinguish tasks. Per-task ports are not authentication. Separate
  daemons are optional if authenticated repository authorization isolates tasks.
- `git daemon` is anonymous. Push needs `receive-pack`, authentication or
  per-task isolation, and pre-receive hooks; it parses untrusted protocol on
  the host. Use a scratch bare repo, never the canonical repo.
- A bare clone carries only commits. Conveyor keeps the human's work
  uncommitted; the sandbox would start clean unless the dirty tree is also
  snapshotted as a commit or overlaid as files/a patch. A file overlay can
  preserve dirty `git diff`/`git status`; a checked-out snapshot commit changes
  these comparisons. Disposable transport commits need not become human-owned
  project commits: validate the returned result and apply its tree delta on
  the host, without automatically merging it into the human branch.

Cleanup: daemon stopped, sandbox deleted, scratch repositories removed.

## Consolidated remote research and limits

- OpenShell supports explicit private-host endpoints and host-gateway aliases;
  the spike's exact address and `allowed_ips` setting are not universal.
- Prefer authenticated HTTPS Smart Git for a future exchange service. Enforce
  exact repository `GET info/refs` and `POST git-upload-pack` /
  `git-receive-pack` routes. Use provider substitution through scoped Git HTTP
  authentication, never real credentials injected into the sandbox.
- HTTP rules do not restrict refs, force-pushes, or deletions. Enforce these
  server-side; isolate the service to a dedicated exchange repository with no
  host credentials, Docker socket, or automatic build/deploy hooks. Validate
  objects and bound requests/storage. Do not use shared canonical object-store
  alternates or namespaces/hidden refs as confidentiality boundaries.
- TCP clone/push success does not validate HTTPS/TLS/provider authentication,
  cross-task authorization, other engines, or remote gateways.
- Sources: [OpenShell policy schema](https://docs.nvidia.com/openshell/v0.1.5/how-it-works/policies/schema.md),
  [provider profiles](https://docs.nvidia.com/openshell/v0.1.5/how-it-works/providers/profiles.md),
  [Git HTTP backend](https://git-scm.com/docs/git-http-backend),
  [namespace security](https://git-scm.com/docs/gitnamespaces), and
  [receive-pack quarantine](https://git-scm.com/docs/git-receive-pack).

## Bundle measurements

`git bundle create HEAD` for the two repositories on this machine:

| Repository | Bundle | Time | Note |
|---|---:|---:|---|
| `osa` | 3.3 MB | 0.14 s | M1 notes measured 77 MB of `.git` at the time |
| `conveyor.ai` | 3.2 MB | 0.11 s | `.git` was 5.7 MB |

The M1 filtered tree upload was 14.8 MB / 2,240 files in about 1.25 s. A
bundle adds the reachable history only; it does not carry hooks, config,
reflogs, stash, or unrelated refs.

## Git layout verified locally

- `git init --separate-git-dir=<outside>` on a non-empty workdir creates a
  `.git` file pointing outside and leaves the files untouched.
- `git fetch <bundle>` + `git read-tree HEAD` + mixed `git reset` leaves the
  uploaded files as uncommitted changes; `git log`, `git status`, and
  `git diff` work.
- A linked worktree can create a bundle; a diverged base can be included and
  exposed as `refs/remotes/origin/<base>`.
- The existing baseline git directory stays separate; `git add -A` there
  ignores the workdir `.git` file, and `collect-patch` still produces the
  expected patch. This prevents ordinary Git-operation coupling, not explicit
  same-uid tampering with the separately writable baseline.
- Consolidated contract: preserve on-disk contents, not the host staging split;
  exclude helper metadata from JSON counts; use `origin/base` for commit/tag
  expressions and preserve short branch names including slashes for branches.

## Live check: bundle transport on OpenShell 0.1.5

Date: 2026-10-29. Host: macOS; gateway `openshell` 0.1.5 connected; image
`maki-agent:local` (Ubuntu 24.04, git 2.43). Sandbox created with
`openshell sandbox create --name osa-git-hist-<pid> --from maki-agent:local
--detach -- /bin/bash -c 'sleep 3600'`.

Host fixture: a repository with two commits on `master`, a `task` branch
created from that commit, one committed `task` change, then a dirty
`a.txt` (uncommitted line) and an untracked `new.txt`. The base was exposed
as `refs/remotes/origin/master` on the host, so the task tip had diverged.

Commands and results:

| Step | Command | Result |
|---|---|---|
| Sync | `MAKI_OSS_WORKSPACE=caller MAKI_OSS_SANDBOX_NAME=<sb> MAKI_OSS_WORKDIR=/sandbox/tasks/t42 maki-oss sync-in <linked-worktree> --base origin/master --json` | exit 0, 0.86 s; `{"baseline":"9d59cfb…","files":3,"bytes":34}` |
| History | sandbox `git log --oneline` | `task`, `two`, `one` |
| Dirty state | sandbox `git status --porcelain` | ` M a.txt`, `?? new.txt` |
| Working diff | sandbox `git diff -- a.txt` | showed the host's uncommitted `+dirty` line |
| Base | sandbox `git diff --stat origin/master`; `git rev-parse refs/remotes/origin/master` | 2 insertions; resolved to the host base `7ee548a…` |
| Blame | sandbox `git blame -L 1,4 -- a.txt` | attributed `one`/`two`/`task` to host commits and the dirty line to `Not Committed Yet` |
| Edit | sandbox appended `live edit` to `a.txt` | — |
| Collect | `maki-oss collect-patch --out <host>/live.diff --json` | exit 0, 0.29 s; one `M a.txt` entry; mode 600 |
| Apply | host `git -C <linked-worktree> apply --check live.diff && git apply live.diff` | clean; host `a.txt` gained `live edit` |
| Layout | sandbox `cat .git`; `git log --all --format=%H | grep -c .` | `.git` file pointed to `/sandbox/.maki-oss/caller/<key>-repo`; three host commits, no baseline commit |

The bundle upload path was
`/sandbox/.maki-oss/caller/<key>-bundle`, outside the workdir; the helper
removed it after the fetch. The `sandbox upload` of the bundle printed
OpenShell's warning that the source was outside a Git work tree and was
uploaded without Git filtering; that is expected for the bundle file and did
not affect the result. Cleanup: sandbox deleted, host fixture removed.

## Follow-up items

- M2b: warm sandbox per task; `--resume` / `--fork-session`.
- M2c: reference repositories for `--add-dir`, read-only roles return an empty
  patch, cancellation.
- M3: self-check in the sandbox; .NET/Node image, internal Nexus egress or an
  offline package cache, `CreateExec`, TRX download, `.conveyor` exclusion.
  Conveyor currently refuses self-check for `maki-osa` in
  `src/Conveyor.Runner/SelfCheckExecutor.cs`; keep host fallback prohibited.
  History availability alone does not implement sandbox self-check.
- Host-git scratch remote: local/M4 option only; not the M2 default.
- Roadmap cleanup: the old `docs/conveyor-roadmap.md` (runner inside the
  sandbox) is unmerged and conflicts with the host-runner M0-M6 plan.
