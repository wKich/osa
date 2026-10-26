# Isolation verification

Run these checks after [`docs/setup-guide.md`](setup-guide.md) sections 5–6,
with a sandbox created as shown there. The examples assume the sandbox is named
`maki` and the provider is `maki-anthropic`; for OpenRouter, substitute
`OPENROUTER_API_KEY` and `maki-openrouter`. Every `exec` command uses
`--no-login-shell` so sandbox login files cannot change the result.

The recorded run for this repository is in
[`docs/verification-log.md`](verification-log.md).

**Expected version: OpenShell v0.1.5.** The checklist below was last run
against that version on 2026-10-22. Section 7 was re-run for the
disposable-workspace change on 2026-10-26; see
[`docs/verification-log.md`](verification-log.md).

## 1. Denied egress

```sh
openshell sandbox exec -n maki --no-login-shell -- \
  /usr/bin/curl -sS --max-time 15 https://example.com
```

**Expected:** the request fails at the connection layer, for example
`curl: (7) Failed to connect to example.com port 443 ...` with exit code 7.
`example.com` is in no policy and no provider profile, so the proxy refuses it.
The refusal also appears in the sandbox log (check 6).

## 2. Placeholder-only credential

```sh
openshell sandbox exec -n maki --no-login-shell -- printenv ANTHROPIC_API_KEY
```

**Expected:** output is a gateway-issued placeholder, not a key: a
revision-scoped token ending in `_ANTHROPIC_API_KEY` (for example
`v3789022262450335270_ANTHROPIC_API_KEY`). It must never start with `sk-ant-`
or otherwise contain the real key. An empty value means the provider was
attached after the process started; `sandbox exec` starts a new process, so
verify the attachment with check 5 first.

## 3. Host paths invisible

```sh
openshell sandbox exec -n maki --no-login-shell -- ls /Users
```

**Expected:** `ls: cannot access '/Users': No such file or directory`, exit
code 2. Host directories do not exist in the sandbox.

```sh
openshell sandbox exec -n maki --no-login-shell -- touch /usr/probe
```

**Expected:** `touch: cannot touch '/usr/probe': Permission denied`, exit code
1. System paths are read-only; `/sandbox`, `/tmp`, and the `/dev/null` sink accept writes.

## 4. Effective policy review

```sh
openshell policy get maki --base
openshell policy get maki --full
```

**Expected:** `--full` contains a provider-composed rule:

```yaml
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
```

`--base` shows only the policy you passed at creation
(`examples/policies/maki-minimal.yaml`). If the provider rule is missing, the
provider is not attached or its profile was not imported.

## 5. Attached provider list

```sh
openshell sandbox provider list maki
```

**Expected:** `maki-anthropic` with type `maki-anthropic` and one credential
key. Credential key names are listed; values are never printed.

## 6. Denial logs

```sh
openshell logs maki --since 5m --source sandbox
```

**Expected:** an OCSF denial for the request from check 1, resembling:

```text
[1791199570.521] [sandbox] [OCSF ] [ocsf] NET:REFUSE [MED] DENIED example.com [reason:policy_dns_ineligible]
[1791199570.522] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(0) -> example.com:443 [reason:transparent_tcp_policy_denied]
```

Do not add `--level warn`: policy events are info-level and would be filtered
out. The logged binary path is how OpenShell identifies the caller; use it to
fix a rule that lists the wrong path.

## 7. Workspace refresh and sync-back

The sandbox workspace is disposable; the collected patch is the durable
output. At session start the helper classifies the workspace as `clean`,
`behind`, `retained`, or `parked`, refreshes it before Maki when safe, and
refuses to overwrite output that no patch covers. The session itself no longer
downloads the workdir over the project: it collects a patch against the
sandbox baseline and applies it only when the safety check for the project's
mode passes. The stub suite covers the matrix offline (`make test`); use these
real-gateway checks for each state.

Run each case from a scratch project directory. A fast-failing Maki model
(`--model nope/nope`) keeps the session short; the sync runs the same way.

### 7.1 Clean git sync

```sh
git init repo && cd repo
git config user.name Test && git config user.email test@example.com
printf 'base\n' >base.txt && git add base.txt && git commit -qm initial

maki-oss up --name maki-sync-check --provider <provider>
maki-oss upload .
openshell sandbox exec -n maki-sync-check --no-login-shell \
  --workdir /sandbox/project -- sh -c 'printf "agent\n" >agent-note.txt; printf "changed\n" >base.txt'
maki-oss run --name maki-sync-check --provider <provider> --model nope/nope "noop"
maki-oss status --name maki-sync-check
```

**Expected:** stderr says `Applied sandbox changes to branch '<branch>'.` The
host contains `agent-note.txt` and the changed `base.txt`; `git status` is
empty; the new commit's subject is `maki-oss: apply sandbox changes`; no
`maki-oss/*` branch and no temporary worktree remain. `status` reports
`Sync: clean` and `Next: maki-oss`.

### 7.2 Host-changed reuse and tracked deletion

With the sandbox from 7.1, change the host and delete a tracked file:

```sh
printf 'host-v2\n' >base.txt
git rm -q agent-note.txt
mkdir -p node_modules/demo && printf 'local dep\n' >node_modules/demo/index.js
maki-oss run --name maki-sync-check --provider <provider> --model nope/nope "noop"
```

**Expected:** stderr says `Refreshing the workspace from the host...`, then
Maki runs. After the session, `base.txt` contains `host-v2`,
`agent-note.txt` is absent in the sandbox, and `node_modules/demo/index.js`
still exists in the sandbox. A second unchanged run says `Workspace is already
current` and records no upload.

### 7.3 Conflicting host edit

Keep the sandbox baseline from 7.1 (or upload again), then edit the same file
on the host and in the sandbox before the session runs:

```sh
printf 'host edit\n' >base.txt
openshell sandbox exec -n maki-sync-check --no-login-shell \
  --workdir /sandbox/project -- sh -c 'printf "sandbox edit\n" >base.txt'
maki-oss run --name maki-sync-check --provider <provider> --model nope/nope "noop"
maki-oss status --name maki-sync-check
```

**Expected:** the host file still contains `host edit`; stderr retains the
patch, names its path, and prints the recovery block. `status` reports
`Sync: retained` and the patch path. A later session does not block: it first
refreshes the workspace from the host and prints `Retained patch for review`,
and the patch file still exists.

### 7.4 Dirty/untracked baseline

```sh
# start a repository with an uncommitted edit and an untracked file
printf 'user edit\n' >>tracked.txt
printf 'user untracked\n' >scratch.txt
maki-oss up --name maki-sync-dirty --provider <provider> && maki-oss upload .
openshell sandbox exec -n maki-sync-dirty --no-login-shell \
  --workdir /sandbox/project -- sh -c 'printf "agent\n" >agent-new.txt'
maki-oss run --name maki-sync-dirty --provider <provider> --model nope/nope "noop"
```

**Expected:** no fast-forward. Stderr names the temporary branch, the review
worktree, the `git cherry-pick <result>` command, and the patch path. The host
still has the local edit and untracked file; `agent-new.txt` is absent until
you cherry-pick.

### 7.5 Plain directory

```sh
mkdir plain && cd plain && printf 'v1\n' >plain.txt
maki-oss up --name maki-sync-plain --provider <provider> && maki-oss upload .
openshell sandbox exec -n maki-sync-plain --no-login-shell \
  --workdir /sandbox/project -- sh -c 'printf "v2\n" >plain.txt'
maki-oss run --name maki-sync-plain --provider <provider> --model nope/nope "noop"
```

**Expected:** `git apply --check` then `git apply`; `plain.txt` is `v2` and
host-only files are untouched.

### 7.6 Retained recovery without git or patch

Run the plain case with a host `PATH` that has neither `git` nor `patch` (and
still resolves `openshell`):

```sh
openshell sandbox exec -n maki-sync-plain --no-login-shell \
  --workdir /sandbox/project -- sh -c 'printf "v3\n" >plain.txt'
PATH=/path/to/tools-without-git-or-patch maki-oss run --name maki-sync-plain \
  --provider <provider> --model nope/nope "noop"
```

**Expected:** the host file stays `v2`; stderr prints `The sandbox patch is
retained for review`, the sandbox name, workspace path, `openshell sandbox
connect` command, a `maki-oss download <path> <dest>` example, and the patch
path. No full workspace download runs. The patch file remains after the next
session refreshes the workspace.

### 7.7 Parked workspace and discard

```sh
maki-oss run --name maki-sync-plain --provider <provider> --no-sync "noop"
maki-oss status --name maki-sync-plain
maki-oss run --name maki-sync-plain --provider <provider> "noop"
maki-oss upload . --name maki-sync-plain
maki-oss rm --name maki-sync-plain --yes
maki-oss upload --discard . --name maki-sync-plain
```

**Expected:** `status` reports `Sync: parked` with download and discard
commands. The session, `upload`, and `rm` each refuse without changing the
workspace; the refusals name `--discard`. `upload --discard` refreshes the
workspace and clears the marker while keeping any earlier patch files.

### 7.8 Recreated sandbox

```sh
maki-oss rm --name maki-sync-plain --yes --discard
maki-oss run --name maki-sync-plain --provider <provider> --model nope/nope "noop"
find "$HOME/.local/state/osa/sessions" -maxdepth 1 -name 'maki-sync-plain.archive-*'
```

**Expected:** `rm` deletes the sandbox and archives the old state directory
(patch files move with it). The new session creates a fresh sandbox, uploads
the host tree once, and starts `clean` without inheriting the parked marker.


## 8. MCP smoke test

Run this after the reference environment image is built and selected. The base
declares no MCP servers; the reference store declares `context7` and
`mcp-context7` supplies its profile. If the current sandbox was created from the
base, recreate it from the derived tag before starting.

**8a. Build and select the reference environment image.** The base must exist
first (`maki-oss image build` builds it). Then build the store and set the
helper's `image` setting to the derived tag:

```sh
maki-oss image build
docker build -t maki-agent:reference examples/environments/reference
# set image = "maki-agent:reference" in the helper config
maki-oss rm --yes       # the old sandbox keeps its old image
maki-oss up
```

**Expected:** both builds succeed; the recreated sandbox reports the derived
image in `maki-oss status`. A raw `openshell sandbox create` uses
`--from maki-agent:reference` instead.

**8b. Attach the profile and create the provider.** The profile carries both
the egress rule and the credential binding, so these two commands are the whole
setup:

```sh
CONTEXT7_API_KEY=<key> maki-oss provider setup \
  --profile examples/providers/mcp-context7.yaml --env CONTEXT7_API_KEY --yes
maki-oss provider attach mcp-context7
```

**Expected:** `Provider profile lint passed.`, `Imported 1 provider profile.`,
`Provider 'maki-context7' created.`, then `Provider 'mcp-context7' attached`.
(The profile's id and the provider instance name differ; use the name printed
by `maki-oss provider list` in the next step if you chose `--name`.)

**8c. Confirm the endpoint entered the effective policy.**

```sh
openshell policy get maki --full
```

**Expected:** a `_provider_mcp_context7` entry with `host: mcp.context7.com`,
`port: 443`, and `protocol: mcp`. No `mcp` endpoint appears in `--base`: the
base policy stays free of MCP, and reach comes only from the attached profile.

**8d. Read the readiness table.**

```sh
maki-oss mcp status
```

**Expected:** one line per server with every gate satisfied and exit code 0:

```text
MCP readiness for sandbox 'maki':
  context7: sandbox=ok provider=ok endpoint=ok transport=http
```

A failing gate prints its fix on the next line and the command exits non-zero:
`provider=missing` names `maki-oss provider attach mcp-context7`;
`sandbox=missing` names the environment-image build guidance and
[`docs/ai/environment-playbook.md`](ai/environment-playbook.md) — the server is
absent from the selected environment image, and rebuilding the base is not the
fix. A stdio server is reported with its runtime gate instead of its transport:
`runtime=missing` names the missing command with the same environment-image
guidance.

**8e. Call a tool from a session.** The tool names are namespaced
`<server>__<tool>`; ask the agent to list what it sees rather than assuming a
name:

```sh
maki-oss run --no-sync "List every MCP tool available to you, one per line. Do not call any tool."
```

**Expected:** `context7__` names appear in the output (for example
`context7__resolve-library-id` and `context7__query-docs`). A tool that is
missing here but present on the host means a gate failed in 8d — check that
before touching the config again.

## 9. stdio MCP smoke test

Runs a stdio MCP server (`synthetic`) end to end: the runtime and package baked
into the reference environment image, the credential crossing only as a
placeholder through its profile, and `mcp status` judging the runtime gate. Each
step names its command and expected output.

**9a. Build the reference environment image and verify the runtime and
package.** The base is built by `maki-oss image build`; the store layers Bun
and the pre-warmed package on top:

```sh
docker build -t maki-agent:reference examples/environments/reference
docker run --rm maki-agent:reference bun --version
docker run --rm --entrypoint sh maki-agent:reference -c 'command -v synthetic-search-mcp'
```

**Expected:** the build completes; the pinned bun version prints (for example
`1.4.3`); `command -v` prints `/sandbox/.bun/bin/synthetic-search-mcp`.

**9b. Attach the upstream profile and create the provider.** A stdio server's
Maki-facing leg is a local pipe; its profile carries the REST endpoint the
server process calls, with the credential bound to it. The host's literal key
is migration input for `--env` only — never a value to copy into any file:

```sh
maki-oss provider setup --profile examples/providers/mcp-synthetic.yaml --env MCP_SYNTHETIC_API_KEY
maki-oss provider attach mcp-synthetic
```

**Expected:** `Provider profile lint passed.`, `Imported 1 provider profile.`,
`Provider 'mcp-synthetic' created.`, then `Provider 'mcp-synthetic' attached`.
(The variable is `MCP_SYNTHETIC_API_KEY`, not the host's `SYNTHETIC_API_KEY`:
one credential key per attached provider, and `maki-synthetic` already owns
the original name — see [`examples/providers/mcp-synthetic.yaml`](../examples/providers/mcp-synthetic.yaml).)

**9c. Read the readiness table.**

```sh
maki-oss mcp status
```

**Expected:** exit code 0 with every gate satisfied, including the stdio
runtime gate:

```text
MCP readiness for sandbox 'maki':
  context7: sandbox=ok provider=ok endpoint=ok transport=http
  synthetic: sandbox=ok runtime=ok provider=ok transport=stdio
```

A sandbox that predates the environment image instead prints
`synthetic: sandbox=ok runtime=missing provider=ok transport=stdio` with the
environment-image build guidance and
[`docs/ai/environment-playbook.md`](ai/environment-playbook.md) — recreate the
sandbox from the derived tag and rerun; the helper installs nothing.

**9d. Call the tool from a session.**

```sh
maki-oss run --no-sync "List every MCP tool available to you, one per line. Then call synthetic__search with the query 'openspec' and report whether it returned results."
```

**Expected:** `synthetic__search` appears in the tool list and the call
returns results: the child process's REST call reached `api.synthetic.new`
through the proxy with the placeholder substituted. A `401`/`403` means the
provider credential or its endpoint binding is wrong; a missing tool means a
gate failed in 9c — check that before touching the config.

## Beyond this checklist

These checks prove the boundary, not the model round-trip. A successful
`maki -p "..."` request additionally exercises endpoint binding and proxy
credential substitution against the upstream provider. Non-root identity
(`id -u` returns `1500`) and the writable workspace are also worth a glance.
