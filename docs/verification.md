# Isolation verification

Run these checks after [`docs/setup-guide.md`](setup-guide.md) sections 5–6,
with a sandbox created as shown there. The examples assume the sandbox is named
`maki` and the provider is `maki-anthropic`; for OpenRouter, substitute
`OPENROUTER_API_KEY` and `maki-openrouter`. Every `exec` command uses
`--no-login-shell` so sandbox login files cannot change the result.

The recorded run for this repository is in
[`docs/verification-log.md`](verification-log.md).

**Expected version: OpenShell v0.1.5.** The checklist below was last run
against that version on 2026-10-22.

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

## 7. Session sync-back

Run from the project directory after a session launched by the helper:

```sh
maki-oss run "create a file named sync-probe.txt in the project root"
ls sync-probe.txt
```

**Expected:** the file exists on the host after the run and the helper printed
`Synced sandbox changes back to ...` on stderr. A host-only file placed next
to it before the run is still present afterwards (the merge never deletes).
`maki-oss --no-sync` skips the download and prints the manual command; a
failed download warns on stderr but preserves Maki's exit code.

## 8. MCP smoke test

Run this after an MCP server is configured end to end: profile imported and
provider attached, the server declared in
[`examples/maki-image/config/mcp.toml`](../examples/maki-image/config/mcp.toml),
and the image rebuilt so the config is baked in. The examples use `context7`.

**8a. Attach the profile and create the provider.** The profile carries both
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

**8b. Confirm the endpoint entered the effective policy.**

```sh
openshell policy get maki --full
```

**Expected:** a `_provider_mcp_context7` entry with `host: mcp.context7.com`,
`port: 443`, and `protocol: mcp`. No `mcp` endpoint appears in `--base`: the
base policy stays free of MCP, and reach comes only from the attached profile.

**8c. Read the readiness table.**

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
`sandbox=missing` names `maki-oss image build` (the server was added to the
host config after the image was built). A stdio server is reported with its
runtime gate instead of its transport:
`sandbox=ok runtime=missing provider=ok transport=stdio` names the missing
command with `maki-oss image build` as the fix.

**8d. Call a tool from a session.** The tool names are namespaced
`<server>__<tool>`; ask the agent to list what it sees rather than assuming a
name:

```sh
maki-oss run --no-sync "List every MCP tool available to you, one per line. Do not call any tool."
```

**Expected:** `context7__` names appear in the output (for example
`context7__resolve-library-id` and `context7__query-docs`). A tool that is
missing here but present on the host means a gate failed in 8c — check that
before touching the config again.

## 9. stdio MCP smoke test

Runs a stdio MCP server (`synthetic`) end to end: runtime and package baked
into the image, the credential crossing only as a placeholder through its
profile, and `mcp status` judging the runtime gate. Each step names its
command and expected output.

**9a. Rebuild so the stdio entry and the pre-warmed package are baked in.**

```sh
maki-oss image build
docker run --rm maki-agent:local bun --version
docker run --rm maki-agent:local sh -c 'command -v synthetic-search-mcp'
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

A sandbox that predates the rebuild instead prints
`synthetic: sandbox=ok runtime=missing provider=ok transport=stdio` with
`fix: maki-oss image build (the runtime 'bun' that 'synthetic' runs with is
missing from the sandbox)` — rebuild and rerun; the helper installs nothing.

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
