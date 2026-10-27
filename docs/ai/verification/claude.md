| Field | Value |
|---|---|
| Doc | `verification-claude` |
| Kind | `verification` |
| Agent | `Claude` |
| Covers | `P6` |
| Reference | `docs/ai/playbooks/claude.md` |
| Verified | OpenShell v0.1.5, Claude Code v2.1.308, 2026-10-26 |

# Verification: Claude

## Scope

> **Record, not checklist.** The commands below are recorded and abridged.
> The executable helper checks are in
> [the playbook Phase 5](../playbooks/claude.md#phase-5--run-the-isolation-checks).

The canonical Claude Code verification record. It reorganizes the verification
table from [`claude-oss/README.md`](../../../claude-oss/README.md) into
`## Check` blocks; it is not a new run, and no observed result is carried
forward from a later version.

The run was on 2026-10-26 with Claude Code 2.1.308, OpenShell 0.1.5, Docker
29.4.0 on an arm64 macOS host. It covers both credential kinds: an Anthropic
API key attached through `claude-anthropic`, and a host-created subscription
token attached through `claude-anthropic-oauth`.

## Check 1 — Image, guardrails, and profiles

### Run

| Check | Command |
|---|---|
| Version pinned | `docker run --rm claude-agent:local claude --version` |
| Checksum enforced | `docker build --build-arg CLAUDE_VERSION=2.1.307 claude-oss/image` |
| Sandbox user | `id` in the image |
| Agent-only | `command -v node bun rg` in the image |
| Guardrails immutable | `touch /etc/claude-code/managed-settings.json` as uid 1500 |
| Profiles lint | `openshell profile lint --from claude-oss/providers` |

### Verify

Expected: the recorded observations below.

| Check | Observed |
|---|---|
| Version pinned | `2.1.308 (Claude Code)` |
| Checksum enforced | fails at `sha256sum -c`; no image tagged |
| Sandbox user | `uid=1500(sandbox) gid=1500(sandbox)` |
| Agent-only | nothing found |
| Guardrails immutable | `Permission denied` |
| Profiles lint | `Provider profile lint passed.` |

### Stop if

The printed version differs from `2.1.308 (Claude Code)`, a checksum mismatch
still builds an image, the image runs as another uid/gid, Node, Bun, or ripgrep
is present, uid 1500 can edit the managed settings, or a profile fails lint.
Report the command, output, and Dockerfile pin; do not tag the image as current
or relax the guardrail file permissions.

## Check 2 — Credential stand-ins and both credential kinds

### Run

| Check | Command |
|---|---|
| Opaque stand-in | `printenv ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN \| cut -c1-9` |
| API key end to end | headless `reply OK` with only `claude-anthropic` |
| Token end to end | headless `reply OK` with only `claude-anthropic-oauth` |

### Verify

Expected: the recorded observations below.

| Check | Observed |
|---|---|
| Opaque stand-in | `openshell` (a placeholder, not the value) |
| API key end to end | `"result":"OK"`, exit 0 |
| Token end to end | `"result":"OK"`, exit 0 |

### Stop if

Either environment value is a real credential, a request works with no provider
attached, or one credential kind fails while the other succeeds. Report which
profile was attached and the observed prefix (not the value); do not create a
token or log in inside the sandbox.

## Check 3 — Session isolation, TUI, and egress

### Run

| Check | Command |
|---|---|
| Filesystem floor | writes to `/sandbox/x`, `/tmp/x`, `/etc/x` in a sandbox |
| Deny under bypass | headless, asked to run `sudo -n true` and Write `/sandbox/.claude/spike.txt` |
| Resume | `--resume <id>` after "Remember the word PELICAN" |
| TUI, token | `claude-oss` on a TTY |
| TUI, API key | `claude-oss` on a TTY with `claude-anthropic` |
| Without the seed | TUI in a sandbox with no `.claude.json` seed |
| Egress | `openshell logs <sandbox>` after headless and TUI sessions |

### Verify

Expected: the recorded observations below.

| Check | Observed |
|---|---|
| Filesystem floor | ok, ok, fails |
| Deny under bypass | both in `permission_denials`; file not created |
| Resume | `"result":"PELICAN"` |
| TUI, token | opens on the prompt (`Sonnet 5.5 · Claude API`), no onboarding, trust, or bypass screen |
| TUI, API key | opens on the prompt (`Sonnet 5.5 · API Usage Billing`), no API key prompt |
| Without the seed | onboarding probes `platform.claude.com`, is denied, exits "Unable to connect to Anthropic services" (why the seed exists) |
| Egress | only `ALLOWED /usr/local/bin/claude -> api.anthropic.com:443` |

### Stop if

A system path accepts a write, a denied command or edit succeeds even under
`--dangerously-skip-permissions`, a resumed session loses its history, a
seeded TUI shows an onboarding, trust, bypass, or API-key prompt, the no-seed
TUI does not fail closed after the denied `platform.claude.com` probe, or
allowed egress includes any endpoint except `api.anthropic.com:443`. The
denied `platform.claude.com` probe in the no-seed case is the expected negative
control, not an egress failure. Report the JSON events, the session ID, and the
log window; do not set `ANTHROPIC_BASE_URL`, an `apiKeyHelper`, or a broader
policy.

## Check 4 — Helper path, sync, MCP, and teardown

### Run

| Check | Command |
|---|---|
| Helper run | `claude-oss run "reply OK"` |
| Helper resume | `claude-oss run --resume <id> "What did you reply last time?"` |
| Patch sync | `claude-oss run` editing `a.txt` and creating `b.txt` in a git project |
| Download | `claude-oss download /sandbox/project/b.txt ./dl/` |
| Precedence warning | `claude-oss doctor` with both providers attached |
| MCP status | `claude-oss mcp status` with a host stdio server |
| Registry | `osa projects` |
| Teardown | `claude-oss rm --yes` |
| Search tools | init event `tools` |

### Verify

Expected: the recorded observations below.

| Check | Observed |
|---|---|
| Helper run | `"result":"OK"`, exit 0 |
| Helper resume | `"result":"OK"` |
| Patch sync | `Applied sandbox changes to branch 'main'.`; commit `claude-oss: apply sandbox changes` |
| Download | `new file` |
| Precedence warning | `warn  credentials: claude-anthropic and claude-anthropic-oauth are both attached …` |
| MCP status | `sandbox=missing … provider=missing`, fix lines name `claude-mcp-<name>` |
| Registry | `cc    cc-ccdemo-d443 …` |
| Teardown | sandbox deleted, state archived |
| Search tools | no Grep/Glob tool in 2.1.308; searches run through Bash `grep`, so the image needs no ripgrep |

### Stop if

A helper run or resume fails, the patch overwrites the host tree or leaves it
dirty, a download is missing, `doctor` fails to warn when both credential kinds
are attached, `mcp status` reports a missing server as ready, or teardown leaves
the sandbox or its state behind. Report the helper output, `claude-oss status`,
and the state directory; do not delete or overwrite host files to force a clean
state.

## Invariants

Never relax these to make a check pass:

- The OpenShell sandbox is the security boundary. No host bind mounts; project
  files move in and out through `openshell sandbox upload` / `download`.
- No secrets through `--env` or `--env-from`. Credentials go through OpenShell
  provider profiles; the sandbox sees only an opaque stand-in and the proxy
  substitutes the real value at `api.anthropic.com`.
- Never spell the literal provider-placeholder prefix in a file the agent can
  read. Describe it in prose instead.
- Egress stays deny-by-default. Every endpoint is an explicit policy or
  provider-profile decision; never use `tls: skip`, `access: full`, or a
  wildcard host to fix a denial.
- Sandbox processes stay non-root, uid/gid 1500, with the minimal filesystem
  policy.
- Claude Code never authenticates inside the sandbox. Do not run `/login`,
  `claude auth`, or `claude setup-token` there; create a subscription token on
  the host only. Do not set `ANTHROPIC_BASE_URL` or an `apiKeyHelper`.
- Never mount or upload the host's `~/.claude`, `~/.claude.json`, or
  `~/.config/anthropic`. Global config belongs in an environment store; the
  project's own `.claude/`, `.mcp.json`, `CLAUDE.md`, and `AGENTS.md` upload
  with the project. Keep secrets out of `.mcp.json`.
- Provider profiles bind `/usr/local/bin/claude`; do not move, rename, or wrap
  the binary.

## See also

- [`docs/ai/playbooks/claude.md`](../playbooks/claude.md) — the ordered Claude
  Code path.
- [`docs/ai/reference/claude.md`](../reference/claude.md) — Claude Code
  configuration, credentials, profiles, sessions, MCP, and store shape.
- [`claude-oss/README.md`](../../../claude-oss/README.md) — the subproject, raw
  path, and the verification summary.
- [`docs/helper.md`](../../helper.md) — `claude-oss` and shared helper command
  reference.
- [`docs/providers.md`](../../providers.md) — provider profile catalog and
  setup flags.
- [`docs/ai/environment-playbook.md`](../environment-playbook.md) — personal
  runtimes, MCP servers, and settings on top of the base image.
