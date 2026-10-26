| Field | Value |
|---|---|
| Doc | `verification-opencode` |
| Kind | `verification` |
| Agent | `OpenCode` |
| Covers | `P6` |
| Reference | `docs/ai/playbooks/opencode.md` |
| Verified | OpenShell v0.1.5, OpenCode v2.1.4, 2026-10-25 |

# Verification: OpenCode

## Scope

The canonical OpenCode verification record. It reorganizes the verification
tables from [`opencode-oss/README.md`](../../../opencode-oss/README.md) into
`## Check` blocks; it is not a new run, and no observed result is carried
forward from a later version.

The live checks ran on 2026-10-25 with OpenCode 2.1.4, OpenShell 0.1.5, Docker
29.4.0 (OrbStack), and an arm64 macOS host. They used the
`opencode-synthetic` profile and model `synthetic/hf:zai-org/GLM-5.3` in
sandbox `opencode-verify`. The helper checks ran on 2026-10-26 with the same
versions, on a scratch git project `oc-live` with sandbox `opencode-oc-live`,
using the existing `opencode-synthetic` provider and the same model.

Profiles other than `opencode-synthetic` were linted and compared but not run
live.

## Check 1 — Image and catalog

### Run

| Check | Command (abridged) |
|---|---|
| Version pinned | `docker run --rm opencode-agent:local opencode --version` |
| Integrity fails closed | `docker build --build-arg OPENCODE_SHA512_ARM64=abab… opencode-oss/image` |
| Sandbox user | `docker run --rm opencode-agent:local id` |
| Agent-only | `command -v node bun`; config `mcp`/`plugin` keys |
| No credential baked | `find /sandbox -type f` in the image |
| Offline catalog | `docker run --rm --network none -e <11 env vars>=dummy … opencode models --standalone` |
| Config accepted | `opencode models --standalone --print-logs --log-level debug` |

### Verify

Expected: the recorded observations below, each from the 2026-10-25 run.

| Check | Observed |
|---|---|
| Version pinned | `opencode v2.1.4` |
| Integrity fails closed | `/tmp/opencode.tgz: FAILED`, no image |
| Sandbox user | `uid=1500(sandbox) gid=1500(sandbox)` |
| Agent-only | none; config has neither |
| No credential baked | only `opencode.json` and shell dotfiles (no `auth.json`, no `service.json`) |
| Offline catalog | exit 0 in ~1s; all 11 catalog providers listed; every `example-model` present |
| Config accepted | no WARN/ERROR lines (an invalid test entry does produce a warning) |

### Stop if

The printed version differs from `opencode v2.1.4`, a checksum mismatch still
builds an image, the image runs as another uid/gid, the image contains Node,
Bun, an MCP/plugin key, or a credential, or the offline catalog is incomplete.
Report the command, output, and Dockerfile pin; do not tag the image as current
or weaken the checksum.

## Check 2 — Profiles and policy

### Run

| Check | Command (abridged) |
|---|---|
| Profiles lint | `openshell profile lint --from opencode-oss/providers` |
| Profiles bind OpenCode only | `binaries` of all 12 profiles |
| Profiles match Maki originals | YAML compare ignoring id/display_name/description/binaries |
| Catalog ↔ profiles | rows vs files; env var in profile; model in offline list |
| Policy floor | `read_write`, Landlock, process fields |

### Verify

Expected: the recorded observations below.

| Check | Observed |
|---|---|
| Profiles lint | `Provider profile lint passed.` (12 profiles) |
| Profiles bind OpenCode only | exactly `/usr/local/bin/opencode` |
| Profiles match Maki originals | 12 same, 0 differ |
| Catalog ↔ profiles | 12 rows, 12 profiles, OK |
| Policy floor | `/sandbox`, `/tmp`, `/dev/null`; `hard_requirement`; 1500/1500; no `network_policies` |

### Stop if

A profile fails lint, binds another binary, differs from its Maki original, or
the catalog and profile set disagree. Report the profile name and the diff; do
not edit `examples/` or widen the policy floor to make the comparison pass.

## Check 3 — Sandbox isolation, credentials, and egress

### Run

| Check | Command (abridged) |
|---|---|
| Sandbox Ready + effective policy | `openshell sandbox list`; `openshell policy get … --full` |
| Filesystem floor | `id`; write `/sandbox/project`, `/tmp`, `/usr`, `/etc` |
| Credential stand-in | env var set and length only; hash compared with host key |
| Egress denied | `curl -sS -m 10 https://example.com` |
| No placeholder spelling | `grep -rF` for the prefix (built from fragments) over `opencode-oss/` |

### Verify

Expected: the recorded observations below.

| Check | Observed |
|---|---|
| Sandbox Ready + effective policy | Ready; one network policy: `api.synthetic.new:443` for `/usr/local/bin/opencode` |
| Filesystem floor | uid 1500; ok, ok, denied, denied |
| Credential stand-in | set, length 60 (host key 36); hashes differ |
| Egress denied | `Couldn't connect to server`; OCSF `DENIED /usr/bin/curl -> example.com:443` |
| No placeholder spelling | no matches |

### Stop if

The sandbox is not `Ready`, the effective policy contains an endpoint or binary
you did not choose, a system path accepts a write, the environment value matches
the host key, the denied request succeeds, or the placeholder prefix is spelled.
Report the command and output; do not add a wildcard rule or mount a host path.

## Check 4 — Headless sessions and denies

### Run

| Check | Command (abridged) |
|---|---|
| Headless run | `opencode run --standalone --auto --format json … "reply OK" </dev/null` |
| Session continues | same with `--continue` |
| Denies hold under `--auto` | prompt asking for `sudo -n true`, `opencode auth list`, an edit and a write under `/sandbox/.config/opencode/` |
| Allowed tools still run | prompt asking to write `hello.txt` and `ls` |
| Denied internal egress | `openshell logs … \| grep DENIED` during a run |

### Verify

Expected: the recorded observations below.

| Check | Observed |
|---|---|
| Headless run | exit 0; JSON `text` event `OK`, about 11s |
| Session continues | same `sessionID`; reply `AGAIN` |
| Denies hold under `--auto` | all four `Permission denied: shell`/`edit`; config sha256 unchanged |
| Allowed tools still run | `write` and `shell` completed |
| Denied internal egress | only `models.opencode.ai:443` from `/usr/local/bin/opencode`; run not delayed |

### Stop if

A headless run hangs or exits non-zero, a continued run creates a new session,
a denied command or config write succeeds, an allowed tool fails, or the log
shows egress to any endpoint except the model profile and the denied catalog
fetch. Report the JSON events and the policy decision; do not retry with a
broader rule or an in-sandbox login.

## Check 5 — TUI and download

### Run

| Check | Command (abridged) |
|---|---|
| TUI attaches | `openshell sandbox exec --tty … opencode --standalone --auto`, driven through a PTY |
| Explicit download | `openshell sandbox download opencode-verify /sandbox/project/hello.txt …` |

### Verify

Expected: the recorded observations below.

| Check | Observed |
|---|---|
| TUI attaches | renders; with the project `model` set, the prompt is answered (with the default free model: `ECONNREFUSED` retries, see §4) |
| Explicit download | `Download complete`; sha256 matches the sandbox copy |

### Stop if

The TUI does not render or answer, or the downloaded file is missing or differs
from the sandbox copy. Report the terminal output and both hashes; do not add a
bind mount or a fallback copy path.

## Check 6 — Helper path

### Run

The helper checks ran on 2026-10-26 with the same versions (OpenCode 2.1.4,
OpenShell 0.1.5, Docker 29.4.0, arm64 macOS). The project was a scratch git
repository `oc-live` with sandbox `opencode-oc-live`, using the existing
`opencode-synthetic` provider and model `synthetic/hf:zai-org/GLM-5.3`.

| Check | Command |
|---|---|
| Overlay merges with the baked config | `sandbox exec --env OPENCODE_CONFIG_CONTENT={"model":…} -- opencode debug config` (throwaway sandbox) |
| Denies hold under the overlay | `opencode run --standalone --auto` with only the overlay model, prompt asking for `sudo -n true` and a write to `/sandbox/.config/spike.txt` |
| Fetch switch per exec | runs with and without `--env OPENCODE_DISABLE_MODELS_FETCH=1` |
| `--session` semantics | `opencode run … --session ses_spike12a`, twice |
| Image build | `opencode-oss image build`; `docker run --rm opencode-agent:local opencode --version` |
| Provider setup | `printf 'n\nsynthetic/hf:zai-org/GLM-5.3\n' \| OPENCODE_OSS_INTERACTIVE=1 opencode-oss provider setup --from opencode --credential synthetic` |
| First run creates and uploads | `opencode-oss run "reply OK"` |
| Stdin closed | `sleep 90 \| opencode-oss run "reply OK"` |
| Continue | `opencode-oss run --continue "…"` |
| TUI on the configured model | bare `opencode-oss`, driven through a PTY |
| Change synced to a git project | `opencode-oss run "Create a file named agent.txt …"` |
| No project file from the helper | `ls -a /sandbox/project` |
| No catalog fetch from sessions | `openshell logs opencode-oc-live --since 1h \| grep models.opencode` |
| MCP status | `opencode-oss mcp status` (host enables `context7`, `synthetic`) |
| Doctor | `opencode-oss doctor` |
| Delete needs confirmation | `opencode-oss rm </dev/null`; `opencode-oss rm --yes`; `opencode-oss status` |

### Verify

Expected: the recorded observations below.

| Check | Observed |
|---|---|
| Overlay merges with the baked config | baked `/sandbox/.config/opencode/opencode.json` and the inline document listed as separate sources |
| Denies hold under the overlay | `Permission denied: shell`, `Permission denied: edit`; file not created |
| Fetch switch per exec | without: `DENIED /usr/local/bin/opencode -> models.opencode.ai:443`; with: no event |
| `--session` semantics | first creates `ses_spike12a`, second resumes it (recalls the earlier word); a non-`ses` id exits 1 with a JSON `error` event |
| Image build | `Built image 'opencode-agent:local'.`; `opencode v2.1.4` |
| Provider setup | curated `opencode-synthetic`, lint passed, profile already imported, existing provider kept (update declined), provider and model recorded in `~/.config/opencode-oss/config.toml`, `example model: synthetic/hf:zai-org/GLM-5.3` printed |
| First run creates and uploads | exit 0; sandbox created, project uploaded; JSON `text` event `OK` |
| Stdin closed | helper exit 0 after 4s, with its stdin still an open pipe |
| Continue | same `sessionID`; reply `OK AGAIN` |
| TUI on the configured model | renders; footer `Build · GLM-5.3 Synthetic`; on exit `No sandbox changes to sync.` |
| Change synced to a git project | `Applied sandbox changes to branch 'main'.`; host commit `opencode-oss: apply sandbox changes` with `agent.txt`; tree clean |
| No project file from the helper | `README.md`, `agent.txt` only (no `opencode.json`); sync state under `/sandbox/.opencode-oss` |
| No catalog fetch from sessions | 0 lines across all sessions |
| MCP status | `context7: sandbox=missing …` with the `FROM opencode-agent:local` fix; disabled `wiki`/`figma` not listed; exit 3 |
| Doctor | all `ok`, `ok    model: synthetic/hf:zai-org/GLM-5.3`, the same MCP table; exit 0 |
| Delete needs confirmation | refused (exit 1); deleted; `Exists: no` |

### Stop if

A helper command hangs, a run creates or loses a session unexpectedly, a
sync overwrites the host tree or leaves it dirty, a denied command succeeds, a
catalog fetch reaches the network with the switch set, an MCP gate reports
`ok` when the server is missing, or `rm` deletes without confirmation. Report
the helper output, `opencode-oss status`, and the sandbox log; do not add a
broader rule or install a missing runtime into the running sandbox.

## Invariants

Never relax these to make a check pass:

- The OpenShell sandbox is the security boundary. No host bind mounts; project
  files move in and out through `openshell sandbox upload` / `download`.
- No secrets through `--env` or `--env-from`. Model and service credentials go
  through OpenShell provider profiles; non-secret switches such as
  `OPENCODE_DISABLE_MODELS_FETCH=1` are the exception.
- Never spell the literal provider-placeholder prefix in a file the agent can
  read. Describe it in prose instead.
- Egress stays deny-by-default. Every endpoint is an explicit policy or
  provider-profile decision; never use `tls: skip`, `access: full`, or a
  wildcard host to fix a denial.
- Sandbox processes stay non-root, uid/gid 1500, with the minimal filesystem
  policy.
- OpenCode never authenticates inside the sandbox. Do not run
  `opencode auth login` there, and do not set a provider base-URL override.
  OAuth-only logins have no path here.
- Never mount or upload the host's `~/.config/opencode/` or
  `~/.local/share/opencode/auth.json`. Global config belongs in an environment
  store; the project's own `opencode.json` and `.opencode/` upload with the
  project.

## See also

- [`docs/ai/playbooks/opencode.md`](../playbooks/opencode.md) — the ordered
  OpenCode path.
- [`docs/ai/reference/opencode.md`](../reference/opencode.md) — OpenCode
  configuration, profiles, sessions, MCP, and store shape.
- [`opencode-oss/README.md`](../../../opencode-oss/README.md) — the
  subproject, raw path, and the verification summary.
- [`docs/helper.md`](../../helper.md) — `opencode-oss` and shared helper
  command reference.
- [`docs/providers.md`](../../providers.md) — provider profile catalog and
  setup flags.
- [`docs/ai/environment-playbook.md`](../environment-playbook.md) — personal
  runtimes, MCP servers, and preferences on top of the base image.
