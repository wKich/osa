# Verification log

Recorded dry runs for this repository. Actual outputs are trimmed to the
relevant lines.

**Historical record.** Paths, sandbox names, and repository names below reflect
the state at the time of each run; the project and repository were later
renamed to `osa` from `maki-openshell`/`maki-oss`.

## Maki v0.6.5 and OpenCode v2.1.4 rebaseline — 2026-10-25

Pin move for `update-maki-and-opencode-pins` on macOS 26.5 (Apple Silicon,
Docker via OrbStack), OpenShell 0.1.5 (CLI and gateway both already 0.1.5;
v0.1.5 is still the latest stable release).

### Maki v0.6.5

- Host CLI replaced from the v0.6.5 `aarch64-apple-darwin` release:
  `maki --version` → `maki 0.6.5`.
- `maki-agent:local` rebuilt with `ARG MAKI_VERSION=0.6.5`;
  `docker run --rm maki-agent:local maki --version` → `maki 0.6.5`
  (image `sha256:eba5b85b316c5efddaf51e27ebd511aedb7a8cbcf2aaaed4ab066ba0b9c85d24`).
- `maki-agent:reference` rebuilt from the new base with Bun 1.4.3 for the
  live journey provider: `maki 0.6.5`, `bun 1.4.3`
  (image `sha256:54087e7b38d866d7ffc6b3f927629d6b00a66833c154cdb7111b89af6df96b6e`).
- Release notes recorded: adaptive thinking on OpenCode Zen/Go, Gemini 3
  thinking, cached-token accounting on Gemini, base URLs ending in `/`,
  transient OpenAI/xAI token endpoints, gateways that reject the `thinking`
  field, and the per-session thread leak.
- **Breaking upgrade note**: unknown keys in `providers.toml` now fail at
  startup (including Aperture `overrides`); a hand-written host config with
  a typo must be corrected before Maki starts.
- The generated `providers.toml` files still parse with Python `tomllib`:
  the oskhs round config (`[kiss]`, `api_key_env`, one `[[kiss.models]]`)
  and the live-journey config (`[mock]`, two `[[mock.models]]`) both parse.
  Rollback is `ARG MAKI_VERSION=0.6.4` plus host Maki 0.6.4; the SDK wire is
  unchanged between the two tags, so no bridge or fixture rollback is needed
  beyond the version labels.

The headless turns against an OpenCode Go profile and a Gemini profile were
skipped with the user's agreement: this host has no Gemini credential or
`maki-google` provider instance. The host CLI and image rebuild above are
verified; the provider-fix behavior is recorded from the release notes, not
re-run here.

### OpenCode v2.1.4

- `opencode v2.1.4` installed; `bun scripts/compat-drift.ts` captured
  **124 routes / 293 schemas**, reported no drift against the vendored
  `bridge/src/openapi-2.1.4.json`, and `/api/info` reports `2.1.4`.
- The pin grows from 143 to **148 `/api/*` operations** (six new
  out-of-scope operations) with no removals. `GET /auth/connect/{code}` was
  removed from the status rows because the route enumeration scopes the
  served surface to `/api/*`.
- The journey catalog pin moved to `2.1.4`; all 68 rows were re-recorded
  (53 parity, 7 pin-blocked diverges, 2 pin-blocked broken, 6 out-of-scope
  unrecorded). The new `see-agent-todos` journey reaches parity and shows
  the todo list in the transcript and sidebar.
- `make test-ui` recaptured `tui-last.*` and
  `bridge/test/fixtures/bridge-requests.jsonl` against the v2.1.4 TUI
  (41 requests, no 404, permission round-tripped).
- `MAKI_OSS_IMAGE=maki-agent:reference make test-journeys-live` recorded
  **62 live journeys** against the rebuilt Maki 0.6.5 image (53 parity,
  7 pin-blocked diverges, 2 pin-blocked broken); every
  `evidence.live.maki` is `0.6.5` and every image is
  `sha256:54087e7b38d866d7ffc6b3f927629d6b00a66833c154cdb7111b89af6df96b6e`.
  The new `see-agent-todos` live journey is parity, including the sidebar.

## Safe session sync — 2026-10-25

Real-gateway dry run of the patch-based exit sync (`add-safe-session-sync`) on
macOS 26.5 (Apple Silicon, Docker via OrbStack), OpenShell 0.1.5, sandbox image
`maki-agent:reference` (Maki 0.6.4, git 2.43.0 inside the sandbox), provider
`maki-synthetic`. Each sandbox was created with
`maki-oss up --provider maki-synthetic`, seeded with `maki-oss upload .`, then
changed through `openshell sandbox exec` so the session baseline was already
recorded. The session used a fast-failing Maki model (`--model nope/nope`) to
keep the run short; the sync path is independent of Maki's success.

### 7.1 Clean git sync — sandbox `maki-verify-ff`

Baseline `mode=clean`, `branch=main`, host tree equal to the sandbox base
tree. The sandbox gained `agent-note.txt`, changed `base.txt`, and created a
fake `.git` directory. On exit:

```text
$ maki-oss run --name maki-verify-ff --provider maki-synthetic \
    --model nope/nope "noop"
Collected sandbox changes: .../sessions/maki-verify-ff/patch-20261025175010-90521.patch
Preparing worktree (new branch 'maki-oss/maki-verify-ff-20261025175010-90521')
Fast-forward
 agent-note.txt | 1 +
 base.txt       | 2 +-
Applied sandbox changes to branch 'main'.

$ cat base.txt           # changed
$ cat agent-note.txt     # agent
$ git log --format='%s' -1
maki-oss: apply sandbox changes
$ git status --porcelain # empty
$ git branch --list 'maki-oss/*'  # empty
$ git worktree list      # one entry (the main worktree)
```

The retained patch contained only `agent-note.txt` and `base.txt`; it had no
`.git` path. The host-only file was preserved. Temporary worktree and branch
were removed after the fast-forward.

### 7.2 Host edit — sandbox `maki-v-conflict`

Baseline was clean; the host and the sandbox then edited `shared.txt`
differently before the session. On exit:

```text
Sandbox 'maki-v-conflict' is stale: its baseline tree differs from the host.
The patch will be kept for review instead of being applied. Refresh with 'maki-oss upload'.
Collected sandbox changes: .../sessions/maki-v-conflict/patch-20261025175105-24866.patch
The sandbox baseline is stale; keeping the patch for review.
maki-oss: sandbox changes are not in the host project; the sandbox still holds them
maki-oss:   sandbox:   maki-v-conflict
maki-oss:   workspace: /sandbox/project
maki-oss:   inspect:   openshell sandbox connect maki-v-conflict
maki-oss:   copy one:  maki-oss download /sandbox/project/PATH ./DEST
maki-oss:   patch:     .../patch-20261025175105-24866.patch
maki-oss:   pending:   .../pending (remove it after resolving)
```

The host file still contained `host edit`, `git status` still showed only that
edit, no temporary branch or worktree existed, and the patch contained the
sandbox edit. The session did not run a workspace download.

### 7.3 Dirty/untracked baseline — sandbox `maki-verify-dirty`

The host started with a tracked edit and `untracked.txt`, and `maki-oss
upload` recorded that working tree as the synthetic baseline. The sandbox
changed both files and added `agent-new.txt`. On exit:

```text
Sandbox changes committed on branch 'maki-oss/maki-verify-dirty-20261025175023-98730'
  (worktree: .../sessions/maki-verify-dirty/worktrees/20261025175023-98730).
Uncommitted host work was not committed. Apply the agent changes with:
  git cherry-pick f25f2ecdc1e544fbdb08c4c84f25b6721cafc10f
If cherry-pick refuses because a changed path is untracked, run: git add -N <path>
Or apply the patch directly: git apply '.../patch-20261025175023-98730.patch'
```

The host still had `user local edit` and `user untracked` as uncommitted work;
`agent-new.txt` was absent. Following the guidance, the local work was
committed explicitly as `user local work`, the result commit was
cherry-picked, and the final files were `agent tracked`, `agent untracked`,
and `agent new` with a clean status. The helper did not commit the user's work
on its own.

### 7.4 Plain directory — sandbox `maki-v-plain`

No `.git` in the project. The sandbox changed `plain.txt` to `v2` and created
`created.txt`. On exit the helper used the plain check:

```text
Collected sandbox changes: .../patch-20261025175121-35255.patch
Applied sandbox changes to /var/.../maki-verify-plain.5alGy2.
```

The host showed `plain.txt` = `v2` and `created.txt` present; no worktree was
created.

### 7.5 No-git host and fail-closed — sandbox `maki-v-plain`

A restricted `PATH` with the shell tools and `openshell` but no `git` (and
later no `patch`) was used for two further sessions. With `patch` available,
the text change applied:

```text
patching file plain.txt
patching file plain.txt
Applied sandbox changes to /var/.../maki-verify-plain.5alGy2.
```

Without `git` or `patch`, the project stayed at `v3` and the helper printed:

```text
maki-oss: warning: neither git nor patch is available on the host; keeping the patch
maki-oss: sandbox changes are not in the host project; the sandbox still holds them
maki-oss:   sandbox:   maki-v-plain
maki-oss:   workspace: /sandbox/project
maki-oss:   inspect:   openshell sandbox connect maki-v-plain
maki-oss:   copy one:  maki-oss download /sandbox/project/PATH ./DEST
maki-oss:   patch:     .../patch-20261025175123-36272.patch
maki-oss:   pending:   .../pending (remove it after resolving)
```

No full workspace download was invoked.

### 7.6 Isolation checks

```text
$ openshell sandbox exec -n maki-verify-ff --no-login-shell -- ls /Users
ls: cannot access '/Users': No such file or directory        (exit 2)

$ openshell sandbox exec -n maki-verify-ff --no-login-shell -- \
    sh -c 'grep -E "/Users|/private/var|/opt/homebrew" /proc/mounts || echo none'
none

$ openshell sandbox exec -n maki-verify-ff --no-login-shell -- touch /usr/probe
touch: cannot touch '/usr/probe': Permission denied          (exit 1)

$ openshell sandbox exec -n maki-v-plain --no-login-shell -- \
    sh -c 'test -e /sandbox/project/.git && echo PRESENT || echo ABSENT'
ABSENT
```

The `.git` directory created inside `maki-verify-ff` was the sandbox's own
(fake content), not the host repository; the host project gained no
`.maki-oss` directory and no nested git metadata. The retained patches had no
`.git` path and no credential-like values.

The verification sandboxes (`maki-verify-clean`, `maki-verify-ff`,
`maki-verify-dirty`, `maki-v-conflict`, `maki-v-plain`, `maki-real-probe`)
were deleted after the run; state directories were kept for inspection.

## OpenShell v0.1.5 upgrade — 2026-10-22

Upgrade of the pinned OpenShell from v0.1.4 to v0.1.5 (released 2026-10-20),
using the version-pinned install path. On macOS the install script installs the
release's generated Homebrew formula and restarts the gateway service.

### Baseline before the upgrade

Recorded before touching the install, so the rollback path is known:

```text
$ openshell --version
openshell 0.1.4

$ openshell status
  Gateway: openshell
  Server: https://localhost:17670
  Status: Connected
  Authentication: Authenticated (mTLS transport)
  Version: 0.1.4

$ openshell gateway info
  Status: healthy
  Version: 0.1.4
  Compute drivers:
    docker
      Driver version: 0.1.4
```

The baseline matches `docs/ai/references.md`'s v0.1.4 claim. Rollback is the
same install command with `OPENSHELL_VERSION=v0.1.4`.

### Install

```sh
curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh \
  | OPENSHELL_VERSION=v0.1.5 sh
```

Result: Homebrew installed `openshell 0.1.5`, restarted the local gateway, and
re-registered it. The install script reported the listener reachable and
`openshell status` connected.

```text
$ openshell --version
openshell 0.1.5

$ openshell status
  Gateway: openshell
  Server: https://localhost:17670
  Status: Connected
  Authentication: Authenticated (mTLS transport)
  Version: 0.1.5

$ openshell gateway info
  Status: healthy
  Version: 0.1.5
  Compute drivers:
    docker
      Driver version: 0.1.5
```

### Version-dependent re-verification

`openshell rule get` still has no JSON mode at v0.1.5: `openshell rule get
--help` lists only `--status` and gateway flags, with no output-format option.
The text shape is unchanged, checked against a real pending proposal drafted by
the policy advisor from a denied request:

```text
$ openshell rule get maki-maki-openshell --status pending
Network Rules:  (version 1, 1 chunk)

  Chunk: bf801802-56a0-49b1-88ea-80937b56c883
  Status: pending
  Rule: allow_example_com_443
  Binary: /usr/bin/curl
  Confidence: 65%
  Rationale: Allow curl to connect to example.com:443 (HTTPS).
  Prover: prover: no new findings
  Candidate: f76327a8bb99
  Endpoints: example.com:443 [L4]
  Binaries: /usr/bin/curl
```

Verdict: the `Chunk:` text parse in `maki-oss policy review` is re-confirmed;
no parser change was needed.

### Isolation checklist against v0.1.5

Run with a sandbox created as the isolation checklist (now
`docs/ai/verification/maki.md`) describes, substituting the
curated DeepSeek profile for the Anthropic example (`maki-deepseek` is the
provider available on this gateway; the policy shape is identical):

```sh
openshell sandbox create --name maki --from maki-agent:local \
  --policy examples/policies/maki-minimal.yaml \
  --provider maki-deepseek --detach
```

Result: `Created sandbox: maki`, phase `Ready` with `ConfigurationAccepted`.

```text
$ openshell sandbox exec -n maki --no-login-shell -- id
uid=1500(sandbox) gid=1500(sandbox) groups=1500(sandbox)

$ openshell sandbox exec -n maki --no-login-shell -- /usr/bin/curl -sS --max-time 15 https://example.com
curl: (7) Failed to connect to example.com port 443 after 2 ms: Couldn't connect to server
(exit 7)

$ openshell sandbox exec -n maki --no-login-shell -- printenv DEEPSEEK_API_KEY
v<revision>_DEEPSEEK_API_KEY
(exit 0; a placeholder, never the key)

$ openshell sandbox exec -n maki --no-login-shell -- ls /Users
ls: cannot access '/Users': No such file or directory
(exit 2)

$ openshell sandbox exec -n maki --no-login-shell -- touch /usr/probe
touch: cannot touch '/usr/probe': Permission denied
(exit 1)

$ openshell sandbox exec -n maki --no-login-shell -- sh -c 'touch /sandbox/probe && date > /tmp/probe && echo writable'
writable
```

Effective policy and attachment (base policy carries no network rules):

```text
$ openshell policy get maki --full
network_policies:
  _provider_maki_deepseek:
    name: _provider_maki_deepseek
    endpoints:
      - host: api.deepseek.com
        port: 443
        protocol: rest
        enforcement: enforce
        access: read-write
    binaries:
      - path: /usr/local/bin/maki

$ openshell sandbox provider list maki
NAME           TYPE           CREDENTIAL_KEYS   CONFIG_KEYS
maki-deepseek  maki-deepseek  1                 0
```

Denial logs for the unlisted host, with the broker staging the DNS name rather
than falling back to native handling:

```text
$ openshell logs maki --since 5m --source sandbox
[1792686433.774] [sandbox] [OCSF ] [ocsf] NET:REFUSE [MED] DENIED example.com [reason:policy_dns_ineligible]
[1792686433.774] [sandbox] [OCSF ] [ocsf] CONFIG:OBSERVATION [INFO] Policy DNS staged unapproved name example.com synthetic=198.18.0.2 for TCP policy review
[1792686433.775] [sandbox] [WARN ] [openshell_supervisor_network::proxy] Denied staged transparent connection destination=198.18.0.2:443 reason=endpoint example.com:443 is not allowed by any policy
[1792686433.775] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(0) -> example.com:443 [reason:transparent_tcp_policy_denied]
```

The same refusal line was produced again by a session launched through the
helper (`maki-maki-openshell`), so the deny-by-default path is unchanged when
the helper creates the sandbox.

### Hostname policy and fail-closed broker

The curated provider hostname still opens: a headless session through
`maki-oss run --model deepseek/deepseek-chat` completed against
`api.deepseek.com:443` and the stdio MCP server's REST call reached
`api.synthetic.new`, both through the attached provider profiles. No profile
gained a host, port, or wildcard.

The unlisted hostname still denies, and the denial carries a `reason:` value
(`policy_dns_ineligible`, `transparent_tcp_policy_denied`) as shown above. The
broker staged the unapproved DNS name instead of forwarding it, so the refusal
is fail-closed rather than a native-handling fallback.

### Session sync-back

```text
$ maki-oss run --model deepseek/deepseek-chat "create a file named sync-probe.txt ..."
Created sandbox 'maki-maki-openshell'...
✓ Upload complete
{"type":"result","subtype":"success",...,"result":"...Created `/sandbox/project/sync-probe.txt`..."}
Downloading sandbox:/sandbox/project -> /Users/ki/Projects/experiments/maki-openshell
✓ Download complete
Synced sandbox changes back to /Users/ki/Projects/experiments/maki-openshell.
```

`sync-probe.txt` existed in the project root afterwards.

### MCP smoke tests

Both seeded servers were ready with every gate satisfied:

```text
$ maki-oss --name maki-maki-openshell mcp status
MCP readiness for sandbox 'maki-maki-openshell':
  context7: sandbox=ok provider=ok endpoint=ok transport=http
  synthetic: sandbox=ok runtime=ok provider=ok transport=stdio
(exit 0)
```

The endpoint entered the effective policy only through the attached profile:

```text
$ openshell policy get maki --full
  _provider_mcp_context7:
    name: _provider_mcp_context7
    endpoints:
      - host: mcp.context7.com
        path: /mcp
        port: 443
        protocol: mcp
        enforcement: enforce
```

`openshell policy get maki --base` printed no `mcp.context7.com` entry, so the
base policy stayed network-free.

A headless tool run listed the `context7__resolve-library-id` /
`context7__query-docs` pair and called `synthetic__search`, which returned six
results for `openspec`. The stdio server's REST call reached
`api.synthetic.new` through the proxy with the placeholder substituted.

### Env guard parity with `--env-from`

Live checks against the upgraded gateway, in addition to the stub suite:

```text
$ EDITOR=vi maki-oss init --name envfrom-probe --env-from EDITOR
Sandbox 'envfrom-probe' is ready. Next: maki-oss upload .

$ openshell sandbox exec -n envfrom-probe --no-login-shell -- printenv EDITOR
vi
(exit 0)

$ maki-oss init --name envfrom-refusal-probe --env-from ANTHROPIC_API_KEY
maki-oss: refusing --env-from ANTHROPIC_API_KEY: the name looks like a credential
...
(exit 1)

$ maki-oss init --name envfrom-launder-probe --env-from HARMLESS_NAME=ANTHROPIC_API_KEY
maki-oss: refusing --env-from ANTHROPIC_API_KEY: the name looks like a credential
...
(exit 1)
```

Neither refusing run created a sandbox (`openshell sandbox list` was unchanged
before the benign probe), so both refusals happened before any gateway
mutation. The refusal names `--env-from`, the flag the user typed.

### Cleanup

The verification sandboxes (`maki`, `maki-maki-openshell`, and the
`--env-from` probe) were deleted after the run; `openshell sandbox list`
reported no sandboxes. The upgraded v0.1.5 CLI and gateway remain installed.

### Findings

No check failed. `openshell gateway info` now reports the driver and middleware
extension versions alongside the gateway, all at 0.1.5. Nothing was added,
widened, or relaxed to make a check pass.

## OpenShell v0.1.4 upgrade — 2026-10-20

Upgrade of the pinned OpenShell from v0.1.2 to v0.1.4 (released 2026-10-13),
using the documented install path, which on macOS installs the release's
generated Homebrew formula and restarts the gateway service:

```sh
curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh
```

```text
$ openshell --version
openshell 0.1.4

$ openshell status
  Gateway: openshell
  Server: https://localhost:17670
  Status: Connected
  Authentication: Authenticated (mTLS transport)
  Version: 0.1.4

$ openshell gateway info
  Status: healthy
  Version: 0.1.4
  Compute drivers: docker (Driver version: 0.1.4)
```

### Version-dependent re-verification

`openshell rule get <sandbox> --status pending` at v0.1.4 still emits
human-readable text only (`Network Rules: (version 1, 2 chunks)` with one
indented block per chunk) — no JSON output and no `-o json` flag. The format
did not change, so the version note in `openspec/specs/policy-review/spec.md`
is unchanged.

`maki-oss doctor` re-run against the upgraded gateway: every prerequisite
check printed `ok` and the command exited 0 with no new failures.

### 5.1 context7 end-to-end smoke test (2026-10-20)

Against the upgraded v0.1.4 gateway, with the rebuilt image carrying
`mcp.toml`. The profile carries both egress and the credential binding, so the
setup is the existing profile flow:

```sh
CONTEXT7_API_KEY=<key> maki-oss provider setup \
  --profile examples/providers/mcp-context7.yaml --env CONTEXT7_API_KEY --yes --attach
```

Result: `Provider profile lint passed.`, `Imported 1 provider profile.`,
`✓ Created provider mcp-context7`, and attach completed with
`Installed: credentials=true, policy=true, future process environment=true`.

```text
$ maki-oss mcp status
  context7: sandbox=ok provider=ok endpoint=ok transport=http
  synthetic: transport=stdio (unsupported in the sandbox)
    reason: the image ships no server runtime (npx/bunx); only HTTP servers are supported
  linear: sandbox=ok provider=missing endpoint=missing transport=http
```

The two non-ready lines are expected in this run: `synthetic` is a stdio
server (reported unsupported by design), and `linear` is the OAuth exemplar
whose login was not completed (covered by 5.2). `context7` — the subject of
this check — reports every gate satisfied and the command exited non-zero
only because of the other two servers.

A headless run listed the MCP tools and one live call returned a real answer,
confirming the gateway substitutes the credential under `protocol: mcp`
inspection and the sandbox never holds the key:

```text
$ maki-oss run --no-sync --model deepseek/deepseek-chat "List every MCP tool..."
Available MCP tools:
- context7__resolve-library-id
- context7__query-docs

$ maki-oss run --no-sync --model deepseek/deepseek-chat "Use the context7 tool to look up the React library..."
React (`/react/react`) — a JavaScript library for building user interfaces.
```

Note: the default configured model returned an upstream `API error (402):
Insufficient balance`; the run above used `deepseek/deepseek-chat`. The tool
names come from one headless run's `result` field.

### 5.2 OAuth-gated exemplar: no access token reaches the sandbox (2026-10-20)

Verified the placeholder half of the OAuth check against the live sandbox. The
OAuth-gated exemplar (`examples/providers/mcp-linear.yaml`, gateway-brokered
`oauth2_refresh_token`) was declared in the baked `mcp.toml` but its login was
not completed, so `LINEAR_MCP_ACCESS_TOKEN` is unset in the sandbox. Reading
the environment inside the sandbox:

```text
$ openshell sandbox exec -n maki-maki-oss --no-login-shell -- \
    sh -c 'printf "[%s]\n" "$CONTEXT7_API_KEY"; printf "[%s]\n" "$LINEAR_MCP_ACCESS_TOKEN"'
[<opaque placeholder ending in _CONTEXT7_API_KEY>]
[]
```

Each OAuth (and static) variable resolves to an opaque stand-in; values not
recorded. The context7 variable — a real 43-character key on the host — came
through as a placeholder rather than the key, and the unset linear variable is
empty rather than a token. No access token reached the sandbox.

**Not verified here (needs an interactive host login):** completing the
`maki mcp auth linear` browser flow and then confirming a linear tool call. The
login step is printed as a host command for the user to run (the helper never
launches a callback or browser inside the sandbox), so it could not be finished
by this automated run. After a real login and
`maki-oss provider attach mcp-linear`, `maki-oss mcp status` should report
`linear` with every gate satisfied and a headless run should list `linear__*`
tools. The success criterion for that step is unchanged: each OAuth variable
resolves to an opaque stand-in and the tool call succeeds.

### 5.3 Negative test: a detached MCP provider is named (2026-10-20)

Detached the live context7 provider and re-ran the readiness report. The
attachment gate was named with its fix command, and the endpoint gate went with
it (the profile's endpoint only reaches the effective policy through the
attached provider):

```text
$ openshell sandbox provider detach maki-maki-oss mcp-context7
$ maki-oss mcp status
  context7: sandbox=ok provider=missing endpoint=missing transport=http
    fix: maki-oss provider attach mcp-context7
EXIT:3
```

The sandbox session still started with the other servers working: a headless
run exited 0 with no error on stderr, and reported the Context7 tools as the
only MCP tools — the detached server's definition stays in the baked config, it
just has no provider behind it, so it fails one gate rather than taking the
session down. The provider was reattached afterwards (`maki-oss provider
attach mcp-context7 --wait`).

### 5.4 stdio server reported unsupported; no runtime added (2026-10-20)

```text
$ maki-oss mcp status
  synthetic: transport=stdio (unsupported in the sandbox)
    reason: the image ships no server runtime (npx/bunx); only HTTP servers are supported
```

`git status` in `examples/` shows only this change's own MCP files (the baked
`mcp.toml` and the two shipped profiles) plus the pre-existing image edits — no
package install and no image change was made for the stdio server. The
Dockerfile installs no JavaScript runtime, and the baked `mcp.toml` declares no
`command` server. The helper reports stdio as unsupported rather than failing
silently, and never installs a runtime to make one work.

Reminder for anyone extending this log: the proxy rejects any request body
containing the literal placeholder prefix, and Maki sends loaded context in
every request body, so the prefix is never spelled here or in any file an agent
may load — describe it in prose only.

### 5.2 result (2026-10-20, later same day): blocked at token mint by Linear's client-auth strictness

The mechanism is sound end to end up to the token mint, but Linear's token
endpoint rejects the gateway's client authentication, so the grant cannot mint
an access token. Verified:

- `maki mcp auth linear` completed on the host (the server first had to be
  declared in the host's `~/.config/maki/mcp.toml` — url only; maki stores the
  client registration and tokens under `~/.local/state/maki/auth/`).
- Gateway side: the `mcp-linear` profile imports, the provider is created with
  `--runtime-credentials`, refresh is configured with
  `--secret-material-env refresh_token=...` (secret material never in argv),
  and the provider attaches. `maki-oss mcp status` then reports `linear:
  sandbox=ok provider=ok endpoint=ok transport=http`.
- The exchange itself fails: every gateway attempt ends
  `oauth_refresh_exchange_uncertain` / `reauthorization_required` ("refresh
  token exchange returned an unusable response"), in both automatic and manual
  rotation, reproducibly, across two grant configurations.
- Root cause isolated from the host: Linear's token endpoint accepts only
  `client_id` in the request body for this dynamically registered public
  client. The identical body-only refresh exchange returns HTTP 200 with a
  valid access token; the same exchange with HTTP Basic client authentication
  returns 401 `invalid_client`, and Basic plus a body `client_id` returns 400
  "Client must not use multiple authentication methods". The v0.1.4 gateway's
  client authentication is therefore rejected at Linear's token endpoint.
- The RFC 8707 `resource` parameter was **not** the issue: the exchange
  succeeds with and without it.
- Consequence in the sandbox: with no current credential, OpenShell withholds
  the placeholder entirely (`LINEAR_MCP_ACCESS_TOKEN` is unset in the sandbox
  env), so no tool call was possible. "No access token reaches the sandbox"
  therefore still holds — trivially, until the client-auth mismatch is
  resolved.
- Housekeeping: Linear rotates the refresh token on every use; the probes used
  during isolation wrote the rotated token back into maki's store (mode 0600,
  atomic replace), so the host login keeps working.

The positive half of task 5.2 stands: login on the host, gateway-brokered
refresh configuration, placeholder-only transport, and the readiness gates all
work. The failing half is the live tool call, blocked by the gateway-vs-Linear
client-authentication mismatch recorded above.

## Setup-guide dry run

Run of [`docs/setup-guide.md`](setup-guide.md) and the isolation checklist now
at [`docs/ai/verification/maki.md`](ai/verification/maki.md), recorded on
2026-10-05.

### Environment

| Component | Value |
|---|---|
| Date | 2026-10-05 |
| Host | macOS 26.5, Apple Silicon (`arm64`) |
| Container engine | Docker Engine 29.4.0 via OrbStack (context `orbstack`) |
| OpenShell | 0.1.2 (Homebrew; local gateway `https://localhost:17670`, `Status: Connected`) |
| Maki | 0.6.0 (pinned in the image) |
| Sandbox image | `maki-agent:local` (built from `examples/maki-image`) |

The OpenShell install used the documented command:

```sh
curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh
```

### 1. Image build

```sh
docker build --build-arg MAKI_VERSION=0.6.0 -t maki-agent:local examples/maki-image
```

Result: build completed; at the end of the install layer the image itself
printed `maki 0.6.0`. Baked layout and identity:

```text
$ docker run --rm maki-agent:local ls /sandbox/.config/maki
init.lua
permissions.toml

$ docker run --rm maki-agent:local id
uid=1500(sandbox) gid=1500(sandbox) groups=1500(sandbox)
```

Inside the sandbox the toolchain is present: `maki 0.6.0`, `git version
2.43.0`; `iproute2` is installed by the Dockerfile layer.

### 2. Provider profiles

```sh
openshell profile lint -f examples/providers/maki-anthropic.yaml
openshell profile lint -f examples/providers/maki-openrouter.yaml
```

Result: both printed `Provider profile lint passed.`

```sh
openshell profile import -f examples/providers/maki-anthropic.yaml --global
openshell profile import -f examples/providers/maki-openrouter.yaml --global
```

Result: `Imported 1 provider profile.` for each.

Provider creation was tested with a deliberately fake value so no real
credential was needed (the live model call was skipped; see Limitations):

```sh
ANTHROPIC_API_KEY=openshell-dry-run-not-a-real-key \
  openshell provider create --name maki-anthropic --type maki-anthropic --from-existing
```

Result: `✓ Created provider maki-anthropic`; `openshell provider list` showed
`maki-anthropic` with 1 credential key and 0 config keys.

### 3. Sandbox creation and policy acceptance

```sh
openshell sandbox create --name maki --from maki-agent:local \
  --policy examples/policies/maki-minimal.yaml \
  --provider maki-anthropic --detach
```

Result: `Created sandbox: maki`; `openshell sandbox list` reported `Ready`.
`openshell sandbox get maki` reported:

```text
Phase: Ready
Conditions:
  - Ready: True (DependenciesReady) - Supervisor session connected
  - ConfigurationReady: True (ConfigurationAccepted)
Policy source: sandbox
Revision: 2
```

The `landlock: hard_requirement` policy was accepted — no startup failure on
this kernel.

### 4. Isolation checks

```text
$ openshell sandbox exec -n maki --no-login-shell -- id
uid=1500(sandbox) gid=1500(sandbox) groups=1500(sandbox)

$ openshell sandbox exec -n maki --no-login-shell -- printenv ANTHROPIC_API_KEY
v3789022262450335270_ANTHROPIC_API_KEY

$ openshell sandbox exec -n maki --no-login-shell -- ls /Users
ls: cannot access '/Users': No such file or directory
(exit 2)

$ openshell sandbox exec -n maki --no-login-shell -- /usr/bin/curl -sS --max-time 15 https://example.com
curl: (7) Failed to connect to example.com port 443 after 2 ms: Couldn't connect to server
(exit 7)

$ openshell sandbox exec -n maki --no-login-shell -- touch /usr/probe
touch: cannot touch '/usr/probe': Permission denied
(exit 1)
```

Note the placeholder is revision-scoped — a `v<digits>_<KEY>` token in this
OpenShell release — so its leading prefix is never quoted in this repository.
`/sandbox` was writable in a separate probe.

Effective policy and attachment:

```text
$ openshell policy get maki --full
network_policies:
  _provider_maki_anthropic:
    name: _provider_maki_anthropic
    endpoints:
      - host: api.anthropic.com
        port: 443
        protocol: rest
        enforcement: enforce
        access: read-write
    binaries:
      - path: /usr/local/bin/maki

$ openshell sandbox provider list maki
NAME            TYPE            CREDENTIAL_KEYS   CONFIG_KEYS
maki-anthropic  maki-anthropic  1                 0
```

Denial logs:

```text
$ openshell logs maki --since 5m --source sandbox
[1791199570.521] [sandbox] [OCSF ] [ocsf] NET:REFUSE [MED] DENIED example.com [reason:policy_dns_ineligible]
[1791199570.522] [sandbox] [WARN ] [openshell_supervisor_network::proxy] Denied staged transparent connection destination=198.18.0.2:443 reason=endpoint example.com:443 is not allowed by any policy
[1791199570.522] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(0) -> example.com:443 [reason:transparent_tcp_policy_denied]
```

Maki startup inside the sandbox (loads the baked `init.lua` and
`permissions.toml` without a config error; no API request):

```text
$ openshell sandbox exec -n maki --no-login-shell -- maki prompt --tools --names
index
webfetch
websearch
bash
...
```

### 5. Cleanup

The dry-run artifacts were removed so the documented import and create
commands run cleanly for a real key:

```sh
openshell sandbox delete maki
openshell provider delete maki-anthropic
openshell profile delete maki-anthropic maki-openrouter --global
```

Final state: `No sandboxes found.`, `No providers found.`,
`No profiles found.` The `maki-agent:local` image and the OpenShell gateway
were left in place.

### Corrections

None were needed: the guide's commands and both policy files worked as
written. Two notes for readers:

- `openshell profile delete` needs `--global` to remove profiles imported with
  `--global`.
- The placeholder's revision prefix (`v<digits>_`) makes exact-string checks
  brittle; match the `_<KEY>` suffix instead.

### Not verified

- **Live model round-trip.** No real Anthropic/OpenRouter key was used, so a
  completed `maki -p` request was not executed. Endpoint binding and proxy
  credential substitution are exercised only insofar as the placeholder and
  provider rule were present.
- **Docker Desktop specifically.** The run used OrbStack. The Docker Desktop
  prerequisites (host networking enabled, Enhanced Container Isolation off) are
  taken from upstream documentation, not exercised here.
- **Linux hosts, MicroVM driver, and GPU paths.**
- **The GitHub push policy end to end.** `examples/policies/maki-git-push.yaml`
  was YAML-parsed and reuses the upstream tutorial's rule shape, but no push
  was attempted (no GitHub token, and the image does not include `gh`).
- **`scripts/check-links.sh`** was run against the docs separately; all 38
  external links resolved.

## Any-provider wizard dry run

Run of the `add-any-provider-support` wizard against the same local gateway,
recorded on 2026-10-06. It exercises the real Maki credential store and the
real OpenShell CLI; the credential value itself never entered the transcript.

### Environment

| Component | Value |
|---|---|
| Date | 2026-10-06 |
| Host | macOS 26.5, Apple Silicon (`arm64`) |
| OpenShell | 0.1.2 (local gateway `https://localhost:17670`, `Status: Connected`) |
| Maki | 0.6.0 (host store `~/.local/state/maki/auth/opencode-go.json`, `{"api_key": ...}` shape) |
| Helper | `bin/maki-oss` from this change |

### 1. Prior state

```text
$ openshell provider list --names
(no output)

$ openshell profile list --type provider -o json --global
[]
```

### 2. Wizard run

```sh
maki-oss provider setup --from maki --credential opencode-go --yes
```

```text
Using curated profile 'maki-opencode-go'.
Linting profile 'maki-opencode-go'...
Provider profile lint passed.
Importing profile 'maki-opencode-go' globally...
Imported 1 provider profile.
✓ Created provider maki-opencode-go
Provider 'maki-opencode-go' created.

Next steps:
  attach at creation:            maki-oss up --provider maki-opencode-go
  attach to an existing sandbox: maki-oss provider attach maki-opencode-go
  pick a model headless:         maki-oss run --model <provider/model> "..."
(exit 0)
```

stdin was not a terminal and `--attach` was absent, so the run stopped short of
attaching, as documented. The value read from the store was exported only into
the environment of the `openshell` child process: grepping the captured stdout
and stderr for it found no match.

```text
$ openshell provider list
NAME              TYPE              CREDENTIAL_KEYS   CONFIG_KEYS
maki-opencode-go  maki-opencode-go  1                 0
```

The OAuth path was exercised against the same real store (the Maki `openai`
login is an OAuth credential):

```text
$ maki-oss provider setup --from maki --credential openai --yes
maki-oss: credential 'maki:openai' is 'oauth', which this workflow does not support
maki-oss:   API-key credentials are the supported path; for OAuth guidance see docs/migrating-providers.md
(exit 1; the refusal happens before any gateway mutation, and the stub suite
asserts no profile/provider invocation is logged)
```

### 3. Cleanup

```sh
openshell provider delete maki-opencode-go
openshell profile delete maki-opencode-go --global
```

```text
✓ Deleted provider maki-opencode-go
✓ Deleted provider profile maki-opencode-go
```

`openshell provider list --names` was empty and the global profile JSON was
`[]` again — the same as before the run.

### Exercised / not exercised

Exercised on the real gateway:

- curated-catalog resolution for a Maki store credential (`maki:opencode-go`);
- lint before import, in order, with both invocations visible in the transcript;
- `provider create --from-existing --global-profile` with the credential
  delivered through the child environment (1 credential key recorded);
- the non-TTY default of not attaching;
- non-exposure: no credential value in stdout, stderr, or argv;
- the OAuth refusal against a real OAuth store entry, with no gateway change.

Not exercised on the real gateway (covered by the stub suite instead):

- `provider update --from-existing` and `sandbox provider attach --wait`
  against a live sandbox; no sandbox was created for this run;
- custom-profile generation and the hidden-prompt source (`make test` cases
  `setup-custom*` and `setup-prompt`);
- `run --model` end to end inside a sandbox; the stub suite asserts the
  `sandbox exec` argv only.

## Download merge probe

Pins the `add-one-command-session` sync-back assumption against the same local
gateway, recorded on 2026-10-06. The sync design depends on what
`openshell sandbox download` does with a directory and a non-empty destination.

### Setup

A scratch project (`readme.txt` plus a nested `src/`) was uploaded into a fresh
sandbox, then modified inside it:

```sh
openshell sandbox create --name maki-oss-sync-probe \
  --from maki-agent:local \
  --policy examples/policies/maki-minimal.yaml \
  --detach \
  --upload "$SCRATCH/src:/sandbox/project"
openshell sandbox exec -n maki-oss-sync-probe --no-login-shell -- \
  sh -c 'echo sandbox-new > /sandbox/project/new.txt; echo changed > /sandbox/project/readme.txt'
openshell sandbox download maki-oss-sync-probe /sandbox/project "$EMPTY_DEST"
```

### Observed

- Downloading into an empty directory placed the source's **contents** directly
  in the destination (no `project/` nesting): `DEST/readme.txt`,
  `DEST/new.txt`, `DEST/src/sub/nested.txt`.
- Downloading into a non-empty destination merged additively: a host-only
  `hostonly.txt` was preserved, a modified `src/readme.txt` was overwritten
  with the sandbox version, and `src/sandboxonly.txt` was added.

Conclusion (also in the change design): sync-back is a direct
`sandbox download <name> <workdir> "$PWD"`; matching paths are overwritten,
host-only files are preserved, sandbox-side deletions are not propagated, and
no temp-dir re-merge is needed. Both probe sandboxes were deleted afterwards.

## One-command session dry run

Run of the `add-one-command-session` flow against the same local gateway,
recorded on 2026-10-06. Interactive bare `maki-oss` needs a TTY, so the
automated transcript uses `maki-oss run`, which shares the ensure/execute/sync
path; the stub suite covers the `--tty` argv for bare/interactive runs.

### Environment

| Component | Value |
|---|---|
| Date | 2026-10-06 |
| Host | macOS 26.5, Apple Silicon (`arm64`) |
| OpenShell | 0.1.2 (local gateway, `Status: Connected`) |
| Maki | 0.6.0 (`maki-agent:local`) |
| Helper | `bin/maki-oss` from this change |

### 1. Provider setup (one-time, remembered)

```text
$ maki-oss provider setup --from opencode --credential deepseek --yes
Imported 1 provider profile.
✓ Created provider maki-deepseek
Provider 'maki-deepseek' created.
Remembered provider 'maki-deepseek' in ~/.config/maki-oss/config.toml.

$ cat ~/.config/maki-oss/config.toml
# maki-oss configuration. See the repository examples/config.toml.
providers = "maki-opencode-go,maki-deepseek"
```

(`maki-opencode-go` was registered from the Maki store earlier in the same
session; both names persist in the config list.)

### 2. Fresh project: create, upload, run, sync

```sh
cd "$SCRATCH/dryrun2"          # contains host-only.txt
maki-oss run --model deepseek/deepseek-chat \
  "Create a file named done.txt in the project root containing the word OK, then reply with OK."
```

```text
stdout: {"type":"result","subtype":"success","is_error":false,...,"result":"OK",...}
stderr: Creating sandbox 'maki-dryrun2'...
        Uploading the project to 'maki-dryrun2:/sandbox/project'...
        ✓ Upload complete
        Synced sandbox changes back to .../dryrun2.

$ ls -A
done.txt  host-only.txt
$ cat done.txt
OK
$ cat host-only.txt
host-only
```

### 3. Reuse without upload

```text
$ maki-oss run --no-sync --model deepseek/deepseek-chat "Reply with OK."
stdout: {"type":"result","subtype":"success",...,"result":"OK",...}
stderr: Reusing sandbox 'maki-dryrun2'.
        Skipped download (--no-sync); copy changes with 'maki-oss download'.
```

No upload invocation appeared on the second run. A missing remembered
provider was attached with `--wait` earlier in the same session (the existing
`maki-dryrun` sandbox gained `maki-deepseek` before its next run).

### 4. Cleanup

```sh
openshell sandbox delete maki-dryrun maki-dryrun2
```

Result: `No sandboxes found.` The two providers and the config entries were
left in place so the machine is ready for real sessions.

### Exercised / not exercised

Exercised on the real gateway:

- provider setup remembering names in the config, deduplicated across runs;
- create → upload → execute → download order on a fresh project;
- host-only file preserved by the sync; sandbox-created file present on the
  host with its content;
- reuse without upload, `--no-sync` hint, and stdout purity (JSON only);
- live `sandbox provider attach --wait` repair for a missing provider.

Not exercised on the real gateway (stub suite instead):

- interactive `--tty` session and the SIGINT sync path;
- sync failure exit-code preservation.

### Known limitation surfaced

Maki 0.6.0 inside the sandbox rejected the documented
`opencode-go/deepseek-v4.1-flash` model spec (`unknown provider 'opencode-go'`,
then `provider 'opencode' not found in catalog`) even though models.dev lists
both providers. Egress is deny-by-default, so Maki cannot refresh its model
catalog from models.dev inside the sandbox; it can only use providers and
models already in its built-in catalog. The dry run therefore used
`deepseek/deepseek-chat`. Baking a models.dev snapshot into the image or
adding a narrow catalog rule is a follow-up change, not part of this one; the
documented examples were corrected to the verified spec.

### Follow-up resolved — model catalog in the image — 2026-10-25

The base image now runs `maki models --refresh` at build time, storing a
models.dev snapshot at `/sandbox/.cache/maki/models-dev-catalog.json`. The
OpenCode TUI bridge reads `maki models` from the sandbox at boot, so the model
picker now lists providers from that snapshot instead of only Maki's bundled
defaults. Host-only providers and plan settings belong in an environment
store's `config/providers.toml`; the personal layer built for this host adds
Kontur and the Z.AI coding plan. Verified in a fresh `maki-agent:personal`
sandbox: `maki models` listed `kontur`, `inception`, `opencode-go`, `kimi`,
`minimax`, `nano-gpt`, `xiaomi`, `zai`, `deepseek`, and `synthetic`, and a
headless `kontur/code-ultra` call returned `OK`. Existing sandboxes keep the
old image until recreated.

## Session idle stop — 2026-10-25

Live check for `add-idle-stop` on the `maki-maki-openshell` sandbox
(`maki-agent:personal`, OpenShell 0.1.5) with `idle_stop` set to 60 seconds.
One interactive session ran and was closed. `maki-oss status` showed
`Phase: Ready` right after the session and `Phase: Stopped` about a minute
later. The watcher's log
(`~/.local/state/maki-oss/sessions/maki-maki-openshell/idle.log`):

```text
2026-10-25T23:22:33 armed secs=60 session=60018 watcher=60078
2026-10-25T23:22:59 closed session=60018
2026-10-25T23:24:04 stopped session=60018
```

The stop landed 65 s after the close: the 60 s idle period, up to 2 s of
close-detection polling, and the in-sandbox `maki` scan plus the gateway stop.
A following `maki-oss maki --continue` restarted the stopped sandbox and
resumed the session:

```text
$ maki-oss maki --continue
Starting sandbox 'maki-maki-openshell' (phase: Stopped)...
✓ Started sandbox maki-maki-openshell
...
Resume session:

  maki -r CgMNjvxUSpcRoasBxPq4b
No sandbox changes to sync.
```

That session armed a fresh watcher with the default period
(`23:25:25 armed secs=3600 session=76777`, `23:25:49 closed session=76777`).

## Disposable workspace sync — 2026-10-26

Live pass for `disposable-sandbox-sync` against the real gateway (OpenShell
0.1.5, `maki-agent:personal`, macOS host). The scratch project was a small git
repository in the temporary workspace; sandboxes `maki-sync-live`,
`maki-sync-live-ret`, and `maki-sync-live-fail` were created for the pass and
deleted afterwards. The personal `maki-maki-openshell` sandbox was left
untouched (its status was already `parked`).

### 1. Fresh create, upload, status

```text
$ maki-oss up --name maki-sync-live
Creating sandbox 'maki-sync-live' from maki-agent:personal...
Sandbox 'maki-sync-live' is ready. Next: maki-oss (the session refreshes the workspace).

$ maki-oss upload . --name maki-sync-live
Refreshing the workspace from the host...
Uploading . -> sandbox:/sandbox/project
✓ Upload complete
Refreshed the workspace from the host.

$ maki-oss status --name maki-sync-live
Sync:      clean
Next:      maki-oss
```

### 2. Host-changed refresh, tracked deletion, ignored artifact

The host changed `base.txt` and deleted `extra.txt`; a `node_modules/survivor`
file was placed in the sandbox before the session.

```text
$ maki-oss status --name maki-sync-live
Sync:      behind
Next:      maki-oss (refreshes the workspace)

$ maki-oss run --name maki-sync-live --model nope/nope "noop"
Reusing 'maki-sync-live'; changes are collected as a patch on exit, and the workspace is checked before Maki runs.
Refreshing the workspace from the host...
Uploading . -> sandbox:/sandbox/project
✓ Upload complete
Refreshed the workspace from the host.
No sandbox changes to sync.

  sandbox: base=host-v3
           extra-absent
           dep-present

$ maki-oss status --name maki-sync-live
Sync:      clean
```

The tracked deletion was pruned and the gitignored dependency survived. A
second unchanged session skipped the upload (`Workspace is already current`).

### 3. Retained patch, refresh, advisory notice

A dirty host baseline and an agent write produced a retained patch:

```text
$ maki-oss run --name maki-sync-live-ret --model kontur/code-ultra \
    "Overwrite base.txt with exactly the word agent..."
Collected sandbox changes: .../patch-20261026015030-78277.patch
Uncommitted host work was not committed. Apply the agent changes with:
  git cherry-pick ab9c9ded455c0e59c568d5e5cd77ea1abc0dd8a1
The sandbox patch is retained for review; the workspace can be refreshed.
  patch: .../patch-20261026015030-78277.patch

$ maki-oss status --name maki-sync-live-ret
Sync:      retained
Next:      maki-oss (refreshes before the next session)
Patch:     .../patch-20261026015030-78277.patch
```

The next session refreshed the workspace and announced the retained patch:

```text
$ maki-oss run --name maki-sync-live-ret --model nope/nope "noop"
Refreshing the workspace from the host...
Refreshed the workspace from the host.
Retained patch for review: .../patch-20261026015030-78277.patch
No sandbox changes to sync.

$ maki-oss status --name maki-sync-live-ret
Sync:      clean
Next:      maki-oss
```

No `Patch:` line remained (the result tree no longer matched the refreshed
sandbox), and the patch file still existed. `rm --yes` deleted the sandbox and
archived the state directory with the patch inside.

### 4. Collection failure parks

During a short `zai/glm-5.3-flash` session, `/sandbox/.maki-oss/git` was removed
after the prepare step:

```text
maki-oss: warning: could not collect sandbox changes: fatal: not a git repository: '/sandbox/.maki-oss/git'
maki-oss: sandbox changes are not in the host project; the workspace is parked
...
  discard:   maki-oss upload --discard   (or maki-oss rm --discard)

$ maki-oss status --name maki-sync-live-fail
Sync:      parked
Next:      maki-oss download /sandbox/project ./DEST
Discard:   maki-oss upload --discard (or maki-oss rm --discard)

$ maki-oss upload . --name maki-sync-live-fail
maki-oss: the workspace is parked; download its changes or pass --discard to replace them

$ maki-oss upload --discard . --name maki-sync-live-fail
Refreshed the workspace from the host.
Discarded the parked workspace state.

$ maki-oss status --name maki-sync-live-fail
Sync:      clean
```

### 5. No-sync park and guards

```text
$ maki-oss run --name maki-sync-live --model nope/nope --no-sync "noop"
Skipped download (--no-sync); the workspace is parked.
...
$ maki-oss status --name maki-sync-live
Sync:      parked

$ maki-oss upload . --name maki-sync-live
maki-oss: the workspace is parked; download its changes or pass --discard to replace them

$ maki-oss rm --yes --name maki-sync-live
maki-oss: the workspace is parked; download its changes or pass --discard to delete them
```

`upload --discard .` and `rm --yes --discard` both succeeded, and `status`
returned to `clean`.

### 6. Recreated sandbox

`rm --yes --discard` on the parked sandbox archived the state and deleted it.
`up` created a new instance; after `upload .` and a no-op session, the new
gateway ID matched the recorded baseline and the workspace was clean:

```text
Archived the previous sandbox state to ~/.local/state/maki-oss/sessions/maki-sync-live.archive-...
archive=.../maki-sync-live.archive-20261026014937-41141
new_id=24431513-24f8-47ba-a03c-d597a2c980a4
baseline sandbox_id=24431513-24f8-47ba-a03c-d597a2c980a4
synced   sandbox_id=24431513-24f8-47ba-a03c-d597a2c980a4
Sync:      clean
```

No sandbox created for the pass remained afterwards. The old-state migration
and the no-git/no-patch retained path were exercised by the stub suite
(`make test`), not repeated against the gateway.

## osa project layer — 2026-10-26

Live pass for `add-oss-project-layer` against the real gateway (OpenShell
0.1.5, `maki-agent:personal`, macOS host).

### Host migration

The state roots `~/.local/state/maki-oss/` (17 session directories) and
`~/.local/state/opencode-oss/` (3) were copied into `~/.local/state/osa/`
(65 files, none missing, no name clashes with the `oc-kiss-5390` and
`maki-kiss` directories already there). The five `pending` markers were
rewritten as flat TOML with `version = "1"` and `patch` paths under the new
root; every remaining `patch` path exists. One archived marker
(`maki-sync-live-ret.archive-…`) already pointed at the pre-archive patch
path; it now points at the copy inside its archive.

Registry entries were written for the live helper sandboxes, keeping their
names: `maki-maki-openshell` (mk) and `oc-maki-openshell` (oc) for this
repository, and `maki-kiss` (mk) for `~/Projects/yourpapai/kiss-playwright`.
The unowned `maki-oss-core-smoke` sandbox was deleted instead.

```text
# before, with the previous helper reading the old roots
$ maki-oss --name maki-maki-openshell status   → Sync: parked
$ opencode-oss --name oc-maki-openshell status → Sync: behind

# after, with no --name (the registry supplies it)
$ maki-oss status       → Sandbox: maki-maki-openshell, Sync: parked
$ opencode-oss status   → Sandbox: oc-maki-openshell, Sync: behind

$ osa projects
AGENT SANDBOX             PENDING  PROJECT      PATH
mk    maki-kiss           -        kiss         /Users/ki/Projects/yourpapai/kiss-playwright
mk    maki-maki-openshell -        maki-oss     /Users/ki/Projects/experiments/maki-openshell
oc    oc-kiss-5390        -        kiss         /Users/ki/Projects/yourpapai/kiss-playwright
oc    oc-maki-openshell   -        maki-oss     /Users/ki/Projects/experiments/maki-openshell
```

The old roots were then removed.

### Default name, registry, and osa

Scratch git repository `osa-live` with `origin`
`git@github.com:example/osa-live.git`:

```text
$ maki-oss up
Sandbox 'mk-osa-live-6eee' is ready.
# projects/mk-osa-live-6eee.toml: agent "mk", host_path, project "osa-live",
# sandbox_id b9c1877b-…, created; no last_session yet

# untracked host file (dirty baseline), agent overwrote base.txt
$ maki-oss run --model kontur/code-ultra "Overwrite base.txt with exactly the word agent..."
The sandbox patch is retained for review; the workspace can be refreshed.
# pending: version "1", kind "retained", patch …/patch-20261026105609-57768.patch,
#          reason "dirty baseline", result_tree 9596ad5e…
# registry: last_session and fingerprint recorded

$ osa status --json
{"agent":"mk","sandbox_name":"mk-osa-live-6eee","pending":"retained",
 "status":{"phase":"Ready","sync":"retained","patch":"…/patch-20261026105609-57768.patch","next":"maki-oss"}}
$ maki-oss status → Sync: retained (same patch)

$ osa status --quick --json   → pending "retained", fingerprint_result "unchanged"
# after editing the untracked notes.txt: still "unchanged" (documented limit)
# after editing the tracked base.txt:
$ osa status --quick --json   → fingerprint_result "changed"

$ maki-oss rm --yes
✓ Sandbox mk-osa-live-6eee deletion accepted; cleanup is pending
# projects/mk-osa-live-6eee.toml removed; osa status --json → []
```

## Dashboard Projects view — 2026-10-26

`dashboard-project-view` (M1) on macOS 26.5 (Apple Silicon), Bun 1.4.2,
Google Chrome 155.0.8059.85, OpenShell 0.1.5.

### Offline checks (task 7.4)

| Check | Result |
|---|---|
| `cd dashboard && bun test` | 92 pass, 0 fail (461 `expect()` calls, 4 files); stable over 6 consecutive runs |
| `bun run scripts/browser-check.ts` | 41 passed, 0 failed (25 existing checks + 16 for the Projects journey), 10 consecutive clean runs |
| `dashboard/scripts/smoke.sh` | 47 passed, 0 failed |
| `make test` | 204 passed, 0 failed, 0 skipped |
| `make lint-docs` | `check-playbooks: ok` |
| `openspec validate dashboard-project-view --strict` | valid |
| `openspec validate --specs --strict` | 19 passed, 0 failed |

The conformance test in `projects.test.ts` ran the real `bin/osa projects
--json` over the fixture (not skipped). It also shows the one intended
difference: for a marker with no `kind`, `osa` falls back to the patch size
(`retained`), and the dashboard reports `parked` with a note.

A first browser-check run failed 2 checks: the journey read the table before
the first inventory poll returned, while rows still said "gateway unknown".
The journey now waits for the inventory join, and the next 10 runs were clean.

### Real state root (task 7.5)

The dashboard ran with its defaults (`$HOME/.local/state/osa`, the
repository's `bin/osa`, the real gateway) and was opened in headless Chrome:

```text
$ bin/osa projects
AGENT SANDBOX             PENDING  PROJECT      PATH
cc    cc-osa-cb62         -        osa          /Users/ki/Projects/experiments/osa
mk    maki-kiss           -        kiss         /Users/ki/Projects/yourpapai/kiss-playwright
mk    mk-osa-cb62         -        osa          /Users/ki/Projects/experiments/osa
oc    oc-kiss-5390        -        kiss         /Users/ki/Projects/yourpapai/kiss-playwright
oc    oc-maki-openshell   -        osa          /Users/ki/Projects/experiments/osa

GET /api/projects → 5 rows; agent, host_path, pending, and orphan equal
osa's for all 5 (0 mismatches). Host: changed for cc-osa-cb62, mk-osa-cb62,
and oc-kiss-5390; unknown for maki-kiss and oc-maki-openshell (no recorded
fingerprint).
```

The page listed all 5 projects as "nothing pending", each sandbox linked to
the live gateway, and the attention counter stayed hidden (0). This host had
no retained, parked, or orphan entries at the time, so those badges were
covered only by the fixture-backed checks above.

## osa resolve — 2026-10-26

Change `add-sync-resolve-commands`. Offline: `make test` 215 passed (11 new
resolve cases across `maki-oss`, `opencode-oss`, and `claude-oss`),
`make lint` and `make lint-docs` pass, and
`openspec validate add-sync-resolve-commands --strict` is valid.

### Real retained patch resolved with branch (task 6.3)

A throwaway git project with one commit and an uncommitted edit to
`notes.txt` (a dirty baseline), on the real gateway with
`maki-agent:personal`:

```text
$ maki-oss run --timeout 300 --model kontur/code-ultra "Create a new file named hello.txt ..."
Creating sandbox 'mk-resolve-dem-cbfc'...
Collected sandbox changes: .../sessions/mk-resolve-dem-cbfc/patch-20261026214811-95318.patch
Uncommitted host work was not committed. ...
  apply:     osa resolve mk-resolve-dem-cbfc apply      (to the working tree, no commit)
  branch:    osa resolve mk-resolve-dem-cbfc branch     (commit on a new branch)
  drop:      osa resolve mk-resolve-dem-cbfc drop --yes (keep the patch aside)

$ osa status --quick --json      → "pending":"retained", "busy":false
$ osa resolve mk-resolve-dem-cbfc branch --json
{"sandbox":"mk-resolve-dem-cbfc","action":"branch","ok":true,
 "changed":["refs/heads/osa/mk-resolve-dem-cbfc-20261026214821"],...}
exit 0
```

Checks on the host repository afterwards:

- The branch commit's parent is the recorded `base` (the dirty-baseline
  snapshot `5cf6d49`), and `git diff base branch` has the same
  `git patch-id --stable` as the retained patch (adds `hello.txt`).
- `HEAD` and `git status --porcelain=v1 -z` are unchanged; `notes.txt` keeps
  the uncommitted edit; `git worktree list` has the same 2 entries (the
  exit sync's kept review worktree), so no temporary worktree remains.
- The commit author is `maki-oss <maki-oss@localhost>`.
- The `pending` marker is gone, the patch file is still in the session
  directory, `osa projects` shows no pending kind, and `maki-oss status`
  reports `Sync: behind`, so the next session refreshes instead of parking.

The first attempt used the configured default model and failed with an
API 403 (`glm-5-code` not permitted) before any change; the run above passed
`--model kontur/code-ultra`.

## Dashboard resolve actions — 2026-10-26

Change `dashboard-sync-actions`. Offline: `cd dashboard && bun test` 109
passed, `bun run scripts/browser-check.ts` 55 passed (the resolve journey
included), `make lint-docs` passes, and
`openspec validate dashboard-sync-actions --strict` is valid.

### Real retained patch applied from the browser (task 5.3)

A throwaway git project (`dash-resolve`, one commit and an uncommitted edit
to `notes.txt`) on the real gateway with `maki-agent:personal`:

```text
$ maki-oss run --timeout 300 --model kontur/code-ultra "Create a new file named hello.txt ..."
Collected sandbox changes: .../sessions/mk-dash-resolv-24a7/patch-20261026231052-24943.patch
The sandbox patch is retained for review; the workspace can be refreshed.

$ osa status --quick --json      → "pending":"retained", "busy":false
```

The dashboard then ran with its defaults (`$HOME/.local/state/osa`, the
repository's `bin/osa`, a minted token, read-write) and was driven in
headless Chrome:

- The row showed `retained`, "unchanged since last sync", and
  **Review patch**; the patch view offered `Apply,Branch,Drop` under the diff.
- **Apply** listed `hello.txt` before sending anything. **Confirm apply** ran
  `osa resolve mk-dash-resolv-24a7 apply --json`, and the outcome read
  "Apply done. Applied the retained patch to …/dash-resolve (not staged or
  committed). Patch kept: …/patch-20261026231052-24943.patch" with the changed
  file `…/dash-resolve/hello.txt`.
- The viewer dropped its actions, and back on Projects the row read "nothing
  pending" with no `retained` badge before the next poll.

Checks on the host afterwards: `git status --short` shows ` M notes.txt` (the
uncommitted edit kept) and `?? hello.txt` ("hello from the sandbox"); `HEAD`
is still the `init` commit; the `pending` marker is gone and the patch file
is still in the session directory; `osa projects` shows no pending kind.

## Dashboard egress denials — 2026-10-27

Change `dashboard-egress`. Offline: `cd dashboard && bun test` 165 passed,
`bun run scripts/browser-check.ts` 63 passed (the egress journey included),
`make lint-docs` passes, and `openspec validate dashboard-egress --strict` is
valid.

### Real denial in the Rules view (task 4.3)

A scratch sandbox on the real gateway (OpenShell 0.1.5), created from
`maki-agent:personal` with `examples/policies/maki-minimal.yaml` and deleted
afterwards:

```text
$ openshell sandbox exec dash-egress-verify -- curl -sS -m 10 -o /dev/null https://example.com
curl: (7) Failed to connect to example.com port 443 after 2 ms: Couldn't connect to server

$ openshell logs dash-egress-verify --since 15m --source sandbox -n 5000 | grep DENIED
[1793074091.448] [sandbox] [OCSF ] [ocsf] NET:REFUSE [MED] DENIED example.com [reason:policy_dns_ineligible]
[1793074091.449] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(0) -> example.com:443 [reason:transparent_tcp_policy_denied]
```

The dashboard then ran with its defaults (real `openshell`, minted token,
read-write) and was driven in headless Chrome to the sandbox's Rules view:

- The policy advisor had proposed `allow_example_com_443` (endpoints
  `example.com:443 [L4]`, binary `/usr/bin/curl`, 65% confidence). Under it,
  "Denied traffic this proposal would allow" listed `example.com:443` from
  `/usr/bin/curl` (count 1, `transparent_tcp_policy_denied`) and `example.com`
  with no port (count 1, `policy_dns_ineligible`).
- "Denied, no proposal" read "Every denial in this window matches a pending
  proposal"; no unparsed lines were reported.
- Back on the inventory, the row showed `0 denied · 6s ago` from that read.

## Dashboard health — 2026-10-27

Change `dashboard-health`. Offline: `make test` 252 passed, `make lint`
passes, `cd dashboard && bun test` 171 passed,
`bun run scripts/browser-check.ts` 76 passed (the health journey included),
`make lint-docs` passes, and `openspec validate dashboard-health --strict` is
valid.

### Real session countdown (task 5.3)

A throwaway plain folder (`dash-health`) on the real gateway (OpenShell
0.1.5, `maki-agent:personal`), with a session that starts the agent and ends
at once:

```text
$ maki-oss run --idle-stop 2m --model nope/nope "noop"
✖ invalid --model spec
No sandbox changes to sync.

$ osa status --quick --json   → "idle":{"period":120,"state":"counting",...}
```

The dashboard then ran with its defaults (`$HOME/.local/state/osa`, the
repository's `bin/osa`, real `openshell`) and was driven in headless Chrome:

- The project row's idle cell read `stops in 1m 37s`, `1m 36s`, `1m 35s` on
  three successive seconds, with the absolute deadline
  (`2026-10-27T04:48:43Z`) on hover.
- At the deadline the cell read `stop due`; the watcher logged `stopped` at
  04:48:49Z and the next quick status turned the cell to `stopped`.
- **Health** showed idle stop, both MCP servers (`context7` http and
  `synthetic` stdio) with every gate passing, and the six doctor checks, all
  `ok`.
- With the sandbox stopped, `osa health mk-dash-health-7666 --json` reported
  `"mcp":{"error":"sandbox is not running (phase: Stopped)"}`, and the sandbox
  stayed `Stopped`.

This run found one defect, fixed before the checks above were repeated: the
Health panel took the configured `idle_stop` (1 h) as the period instead of
the `--idle-stop 2m` the session's watcher was armed with, so its deadline
was an hour out while the row's was right. `idle_state` now uses the period
from the session's `armed` line and falls back to the setting only when there
is none. A second session then showed the same deadline in the row and the
panel (`2026-10-27T04:51:53Z`, period 120 s). The scratch sandbox was removed
with `maki-oss rm --yes`.

## Non-interactive provider setup — 2026-10-27

`add-provider-setup-noninteractive`, on this host (gateway `openshell`,
`https://localhost:17670`, Docker). `make test` passed (262 tests) and
`openspec validate add-provider-setup-noninteractive --strict` passed.

A real Synthetic key was piped from Maki's store; it never appeared in an
argument or in the output:

```sh
$ jq -r .api_key ~/.local/state/maki/auth/synthetic.json \
    | bin/osa provider setup mk --profile maki-synthetic --name maki-synthetic-stdin \
        --attach mk-resolve-dem-cbfc --json        # exit 3
{"ok":false,...,"outcome":"failed","attached":null,"remembered":true,
 "steps":["linted","created","remembered"],"message":"created maki-synthetic-stdin and remembered it; attach to 'mk-resolve-dem-cbfc' failed: ..."}
```

The gateway refused the attach (`provider attachment failed (The system is
not in a state required for the operation's execution)`), most likely because
`maki-synthetic`, which binds the same `SYNTHETIC_API_KEY`, was already
attached. The run exited 3 with the completed steps, as specified. It found
one defect, fixed afterwards: the message kept only the last line of
openshell's wrapped error (`failed:   │ operation's execution)`). The front-end
now joins the whole error into one line, and the stub's attach failure wraps
its error the same way as a regression test.

Updating the attached provider instead succeeded:

```sh
$ jq -r .api_key ~/.local/state/maki/auth/synthetic.json \
    | bin/osa provider setup mk --profile maki-synthetic --attach mk-resolve-dem-cbfc --yes --json
{"ok":true,"agent":"mk","provider":"maki-synthetic","profile":"maki-synthetic","outcome":"updated",
 "attached":"mk-resolve-dem-cbfc","remembered":true,"steps":["linted","updated","remembered","attached"],...}
```

A headless session in that sandbox then used the credential:

```sh
$ maki-oss run --name mk-resolve-dem-cbfc --model synthetic/hf:zai-org/GLM-5.3 \
    --timeout 150 --no-sync "Reply with exactly the word: pong"
{"type":"result","subtype":"success","is_error":false,...,"result":"pong",...}
```

Note: because setup remembers a provider before it attaches, the failed first
run left `maki-synthetic-stdin` in `providers` in the config, and the next
session failed while attaching it. The entry was removed by hand before the
session above. The parked workspace that `--no-sync` left was cleared with
`osa resolve mk-resolve-dem-cbfc discard --yes`. The `maki-synthetic-stdin`
provider is still on the gateway.

## Dashboard image builds — 2026-10-27

`dashboard-image-build`, on this host (Docker under OrbStack). `make test`
passed (262 tests), `cd dashboard && bun test` passed (198), the browser
check passed (101, including the image journey), and
`openspec validate dashboard-image-build --strict` passed.

The dashboard ran on loopback (`bun run src/main.ts --port 8799`) and was
driven through its routes:

- `POST /api/images/cc/build` returned 202. `GET /events/build` streamed 53
  lines (`Building image 'claude-agent:local' with docker...`, the BuildKit
  steps) and then `done` with `exitCode: 0`. Every layer was cached, so the
  build took 0.5 s and `claude-agent:local` kept its id and creation time.
- `POST /api/images/oc/build`, then `POST /api/images/build/cancel` 0.25 s
  later while `docker build -t opencode-agent:local …/opencode-oss/image` was
  running. The stream ended with `ERROR: failed to build: failed to solve:
  Canceled: context canceled` and `opencode-oss: image build failed (exit
  status 130)`, and `done` reported `cancelled: true, exitCode: 2`. Three
  seconds later `pgrep` found no `docker build`, `opencode-oss image build`,
  or `osa image build` process, and `docker ps` showed nothing from the build.
  `opencode-agent:local` was still present and unchanged.

## Dashboard provider wizard — 2026-10-27

`dashboard-provider-wizard`, on this host, with `add-provider-setup-noninteractive`
applied. `cd dashboard && bun test` passed (198), the browser check passed
(101, including the provider journey), and
`openspec validate dashboard-provider-wizard --strict` passed.

In a desktop browser on `http://127.0.0.1:8799`: Setup tab, Maki card, Set up.
Profile `maki-synthetic`, name `maki-synthetic`, the real Synthetic key pasted,
attach `mk-resolve-dem-cbfc`, Replace existing credential checked. The wizard
showed:

```
Updated the credential of provider maki-synthetic and attached it to mk-resolve-dem-cbfc.
updated the credential of maki-synthetic and remembered it, attached to mk-resolve-dem-cbfc
```

The dashboard server's output did not contain the key. A session in that
sandbox then used the credential:

```sh
$ maki-oss run --name mk-resolve-dem-cbfc --model synthetic/hf:zai-org/GLM-5.3 \
    --timeout 150 "Reply with exactly the word: pong"
... "result":"pong" ...
```

## osa dashboard — 2026-10-27

`add-osa-dashboard-command`, on this host (macOS, Bun 1.4.2). `make test`
passed (264), `cd dashboard && bun test` passed (206), `make lint` and
`make lint-docs` passed, and
`openspec validate add-osa-dashboard-command --strict` passed.

From `$HOME`, `osa dashboard --open` printed
`OpenShell dashboard listening on http://127.0.0.1:8787` and no
`could not open a browser` note, so `open` exited 0. `ps` showed the same PID
as `bun run /Users/ki/Projects/experiments/osa/dashboard/src/main.ts --open`
(the `exec` replaced `osa`), with
`DASHBOARD_OSA_BIN=/Users/ki/Projects/experiments/osa/bin/osa` in its
environment. `GET /` served the page, which opens on Projects; that the
browser tab showed it was not checked from this session.

With the server running, a full status and a resolve of `cc-osa-cb62` (nothing
pending, so it was refused with exit 2 and changed nothing) spawned:

```
/bin/sh /Users/ki/Projects/experiments/osa/bin/osa status /Users/ki/Projects/experiments/osa --json
/bin/sh /Users/ki/Projects/experiments/osa/bin/osa resolve cc-osa-cb62 apply --json
/bin/sh /Users/ki/Projects/experiments/osa/bin/osa status /Users/ki/Projects/experiments/osa --quick --json
```

Ctrl-C: `osa dashboard --port 8788` was started from `$HOME` in its own process
group, and SIGINT was sent to the group (what a terminal Ctrl-C does). Bun
exited on the signal (status -2), and `pgrep` then found no dashboard `bun`
process. A job started with `&` from a non-interactive shell ignores SIGINT,
as it inherits that disposition, so a plain `kill -INT` to such a job is not
a valid check.
