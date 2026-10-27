| Field | Value |
|---|---|
| Doc | `verification-codex` |
| Kind | `verification` |
| Agent | `Codex` |
| Covers | `P6` |
| Reference | `docs/ai/playbooks/codex.md` |
| Verified | OpenShell v0.1.5, Codex v0.164.0, 2026-10-26 |

# Verification: Codex

## Scope

The canonical Codex verification record. It reorganizes the recorded run from
[`codex-oss/README.md`](../../../codex-oss/README.md) into `## Check` blocks; it
is not a new run, and no observed result is carried forward from a later
version.

The run was on 2026-10-26 with Codex 0.164.0, OpenShell 0.1.5, Docker on an
arm64 macOS host, and a ChatGPT `prolite` plan. It covers the image, the
managed configuration, the `codex-chatgpt` profile, the host-only login, the
gateway refresh, the sandbox session kinds, the helper path, sync, MCP, and
teardown.

## Check 1 — Image, managed config, and profile

### Run

| Check | Command |
|---|---|
| Version pinned | `docker run --rm codex-agent:local codex --version` |
| Checksum enforced | `docker build --build-arg CODEX_VERSION=0.163.0 codex-oss/image` |
| Sandbox user | `id; echo $HOME` in the image |
| Agent-only | `command -v node bun`, `ls -d /sandbox/.agents` in the image |
| Guardrails immutable | `touch /etc/codex/x` and append to `managed_config.toml` as uid 1500 |
| Config accepted | `codex exec --strict-config` (offline) |
| Managed layer wins | user `config.toml` and `-c` overrides redirecting the provider, then `codex doctor --json` |
| Profiles lint | `openshell profile lint --from codex-oss/providers` |

### Verify

Expected: the recorded observations below.

| Check | Observed |
|---|---|
| Version pinned | `codex-cli 0.164.0` |
| Checksum enforced | `/tmp/codex.tar.gz: FAILED` at `sha256sum -c`; build fails |
| Sandbox user | `uid=1500(sandbox) gid=1500(sandbox)`, `/sandbox` |
| Agent-only | nothing found |
| Guardrails immutable | `Permission denied` |
| Config accepted | no configuration error; only the missing token |
| Managed layer wins | provider stays `chatgpt-oss` → `chatgpt.com` |
| Profiles lint | `Provider profile lint passed.` |

### Stop if

The printed version differs from `codex-cli 0.164.0`, a checksum mismatch still
builds an image, the image runs as another uid/gid, Node or Bun is present, a
skill directory exists in the base image, uid 1500 can edit the managed config
or rules, the configuration is rejected, a user layer redirects the provider,
or a profile fails lint. Report the command, output, and pinned build argument;
do not tag the image as current or relax the guardrail permissions.

## Check 2 — Credential, gateway refresh, and egress

### Run

| Check | Command |
|---|---|
| Opaque stand-in | `printenv CODEX_CHATGPT_TOKEN \| cut -c1-12` |
| No login state | `ls -a /sandbox/.codex` after runs |
| Refresh schedule | fresh `refresh configure`, one forced `refresh rotate`, then `refresh status` every minute for two hours |
| Refresh state after setup | `openshell provider refresh status codex-chatgpt`, 2026-10-26 16:16Z |
| Refresh in doctor | `codex-oss doctor` |
| Path scoping | `openshell logs` |
| Rate limit | six small requests in three minutes |

### Verify

Expected: the recorded observations below. The account ID travels as
`CODEX_CHATGPT_ACCOUNT_ID` and the `ChatGPT-Account-Id` header; it is not a
secret.

| Check | Observed |
|---|---|
| Opaque stand-in | a placeholder, not the token |
| No login state | no `auth.json` |
| Refresh schedule | `EXPIRES_AT` +240 h after the rotation, `NEXT_REFRESH` five minutes before expiry; no automatic refresh and no failure in two hours |
| Refresh state after setup | `configured`, `EXPIRES_AT 2026-11-05 15:34:21`, `NEXT_REFRESH 2026-11-05 15:29:21`, no `LAST_REFRESH`, no failure |
| Refresh in doctor | `ok    refresh: codex-chatgpt configured, expires 2026-11-05 15:34:21 UTC` |
| Path scoping | `GET /backend-api/plugins/*` denied by `L7_REQUEST deny`; `POST /backend-api/codex/responses` allowed |
| Rate limit | one HTTP 429 from the backend; Codex's retry recovered |

### Stop if

The sandbox environment value is a real credential, an `auth.json` or other
login state appears in `/sandbox/.codex`, the recorded refresh lifetime or lead
time differs, the gateway refreshes continuously or records a failure, a path
outside `chatgpt.com/backend-api/codex/**` is allowed, or the backend returns a
rate limit that Codex cannot recover from. Report the observed prefix (not the
value), the refresh state, and the log window; do not create a login or an
`auth.json` inside the sandbox.

## Check 3 — Sessions, rules, and TUI

### Run

| Check | Command |
|---|---|
| Filesystem floor | writes to `/sandbox/x`, `/tmp/x`, `/etc/x` in a sandbox |
| Headless | `codex exec --json … "Reply with the single word: ok"` |
| Resume | `codex exec resume … <thread_id> "What single word did you reply last time?"` |
| Shell commands | headless run asked to `echo hello-from-sandbox > note.txt && cat note.txt` |
| Rules under bypass | headless runs asked to run `sudo -n true` and `codex login status` |
| TUI | `codex --dangerously-bypass-approvals-and-sandbox` on a TTY |

### Verify

Expected: the recorded observations below.

| Check | Observed |
|---|---|
| Filesystem floor | ok, ok, `Permission denied` |
| Headless | `agent_message` `ok`, `turn.completed`, exit 0 |
| Resume | `ok` |
| Shell commands | `command_execution` exit 0, file created |
| Rules under bypass | `rejected: policy forbids commands starting with sudo` / `codex login` |
| TUI | opens on the prompt: `permissions: YOLO mode`, `GPT-6.1-Sol default · ~/project`; no login or trust screen |

### Stop if

A system path accepts a write, a headless run does not emit JSONL and exit 0, a
resumed session loses its history, a shell command fails, a rule-blocked
command succeeds under bypass mode, or the TUI shows a login or trust screen.
Report the JSON events, the session `thread_id`, and the command output; do not
weaken the filesystem policy or remove a guardrail rule.

## Check 4 — Helper path, sync, MCP, and teardown

### Run

| Check | Command |
|---|---|
| Helper setup | `codex-oss provider setup --yes` (browser login) |
| Helper doctor | `codex-oss doctor` |
| Helper run | `codex-oss run "Reply with the single word: ok"` |
| Helper resume | `codex-oss run --resume <thread_id> "What single word did you reply last time? …"` |
| Patch sync | `codex-oss run` appending to `a.txt` and creating `b.txt` in a git project |
| Download | `codex-oss download /sandbox/project/b.txt ./dl/` |
| Helper TUI | bare `codex-oss` on a TTY |
| MCP status | `codex-oss mcp status` with a host `[mcp_servers.node_repl]` |
| Helper egress | `openshell logs cx-…` after runs and the TUI |
| Registry | `osa projects` |
| Teardown | `codex-oss rm --yes` |

### Verify

Expected: the recorded observations below.

| Check | Observed |
|---|---|
| Helper setup | `Provider 'codex-chatgpt' created.`, `Gateway refresh configured`, `account_id` and `providers` written; no `codex-oss-login.*` left in `$TMPDIR` |
| Helper doctor | all `ok`, including `refresh: codex-chatgpt configured, expires 2026-11-05 15:34:21 UTC` |
| Helper run | sandbox created and project uploaded; `agent_message` `ok`, exit 0 |
| Helper resume | `ok` |
| Patch sync | `Applied sandbox changes to branch 'main'.`; commit `codex-oss: apply sandbox changes` |
| Download | `from codex` |
| Helper TUI | reuses the sandbox; opens on the prompt, `permissions: YOLO mode`, no login or trust screen |
| MCP status | `node_repl: sandbox=missing runtime=missing provider=missing transport=stdio`; fix names `codex-mcp-node_repl` |
| Helper egress | only `ALLOWED POST chatgpt.com/backend-api/codex/responses` and the documented denied TUI fetch of `raw.githubusercontent.com` |
| Registry | `cx    cx-cxdemo-7cbb …` |
| Teardown | sandbox deleted, state archived |

### Stop if

A helper run or resume fails, `provider setup` leaves a throwaway login
directory behind, `doctor` reports a failing check, the patch overwrites the
host tree or leaves it dirty, a download is missing, the TUI shows a login or
trust screen, `mcp status` reports a missing server as ready, egress includes
an endpoint outside the provider path and the documented denied fetch, or
teardown leaves the sandbox or its state behind. Report the helper output,
`codex-oss status`, and the state directory; do not delete or overwrite host
files to force a clean state.

## Follow-up

The first scheduled refresh of `codex-chatgpt` was not observed by the
recorded run. It falls at about 2026-11-05 15:29 UTC, five minutes before the
access token expires. When it happens, `codex-oss doctor` must still report
refresh `ok` with an expiry about 240 h later; that is the evidence that the
gateway saves each rotated refresh token. If `doctor` reports a failed
refresh, run `codex-oss provider setup` again for a new login and record the
failure here.

## Invariants

Never relax these to make a check pass:

- The OpenShell sandbox is the security boundary. No host bind mounts; project
  files move in and out through `openshell sandbox upload` / `download`.
- No secrets through `--env` or `--env-from`. Credentials go through OpenShell
  provider profiles; the sandbox sees only an opaque stand-in and the proxy
  substitutes the real value at the approved endpoint.
- Never spell the literal provider-placeholder prefix in a file the agent can
  read. Describe it in prose instead.
- Egress stays deny-by-default. Every endpoint is an explicit policy or
  provider-profile decision; never use `tls: skip`, `access: full`, or a
  wildcard host to fix a denial.
- Sandbox processes stay non-root, uid/gid 1500, with the minimal filesystem
  policy.
- Codex never authenticates inside the sandbox. Do not run `codex login`
  there, never create, upload, or mount an `auth.json` or the host's
  `~/.codex`, and do not override the provider's base URL.
- Provider profiles bind `/usr/local/bin/codex`; do not move, rename, or wrap
  the binary.

## See also

- [`docs/ai/playbooks/codex.md`](../playbooks/codex.md) — the ordered Codex
  path.
- [`docs/ai/reference/codex.md`](../reference/codex.md) — Codex configuration,
  credentials, profiles, sessions, MCP, and store shape.
- [`codex-oss/README.md`](../../../codex-oss/README.md) — the subproject, raw
  path, and verification summary.
- [`docs/helper.md`](../../helper.md) — `codex-oss` and shared helper command
  reference.
- [`docs/providers.md`](../../providers.md) — provider profile catalog and
  setup flags.
- [`docs/ai/environment-playbook.md`](../environment-playbook.md) — personal
  runtimes, MCP servers, and settings on top of the base image.
