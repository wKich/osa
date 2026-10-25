# opencode-oss

Run the [OpenCode](https://opencode.ai/docs/) coding agent natively inside an
NVIDIA OpenShell sandbox, with the same isolation as the Maki path in this
repository. The sandbox gets a pinned, agent-only image. Credentials come only
from OpenShell provider profiles, egress is denied by default, and files move
only by explicit upload and download.

This is **not** the OpenCode TUI bridge (`bridge/`). The bridge runs the
OpenCode TUI on the host against Maki in a sandbox. Here, OpenCode itself is
the sandboxed agent. There is no lifecycle helper yet: every step below is a
plain `docker` or `openshell` command.

| Path | What it is |
|---|---|
| `image/Dockerfile` | Base image `opencode-agent:local`: pinned native OpenCode 2.1.4, uid/gid 1500, no Node/Bun, no MCP, no plugins |
| `image/config/opencode.json` | Global config baked to `/sandbox/.config/opencode/opencode.json`: no self-update, no sharing, deny rules |
| `providers/opencode-*.yaml` | OpenShell provider profiles bound to `/usr/local/bin/opencode` |
| `providers/catalog.tsv` | Profile → OpenCode provider ID, env var, example model |
| `policies/minimal.yaml` | Sandbox policy: filesystem floor, hard Landlock, uid/gid 1500, no egress of its own |

The security invariants in [`AGENTS.md`](../AGENTS.md) apply unchanged. In
particular:

- Never pass a credential through `--env`/`--env-from`.
- Never run `opencode auth login` in a sandbox.
- Never set a provider base-URL override there.
- Never write the provider placeholder prefix into a file the agent can read.

## 1. Build the image

```sh
docker build -t opencode-agent:local opencode-oss/image
docker run --rm opencode-agent:local opencode --version   # opencode v2.1.4
```

The Dockerfile downloads the platform tarball from npm:
`@opencode/cli-linux-arm64` on arm64, and `@opencode/cli-linux-x64-baseline`
on amd64, which also runs on CPUs without AVX2. It checks the tarball against
the pinned npm sha512 and installs only `package/bin/opencode`. To bump the
version, change `OPENCODE_VERSION` and both `OPENCODE_SHA512_*` args
together. Get the hex digest with:

```sh
npm view @opencode/cli-linux-arm64@<version> dist.integrity \
  | sed 's/^sha512-//' | base64 -d | xxd -p -c 256
```

This pin is independent of the TUI bridge's OpenCode pin
(`update-maki-and-opencode-pins`).

The model catalog ships inside the OpenCode binary, so there is no seeding
step. `opencode models` lists only providers whose credential env var is set.

## 2. Load a provider profile

Pick a row from [`providers/catalog.tsv`](providers/catalog.tsv). Each
profile keeps the endpoint and env var of its Maki counterpart in
`examples/providers/`, but it authorizes only `/usr/local/bin/opencode`.
Because OpenShell attaches one provider per credential key to a sandbox, an
OpenCode sandbox attaches `opencode-<name>`, not `maki-<name>`. Example with
Synthetic:

```sh
openshell profile lint -f opencode-oss/providers/opencode-synthetic.yaml
openshell profile import -f opencode-oss/providers/opencode-synthetic.yaml --global

# From your host environment (the key never enters the sandbox):
SYNTHETIC_API_KEY=<key> openshell provider create \
  --name opencode-synthetic --type opencode-synthetic --from-existing --global-profile
```

`openshell profile lint --from opencode-oss/providers` lints the whole set.

- **Sibling providers:** one env var can switch on sibling OpenCode providers.
  `KIMI_API_KEY` also enables `kimi-code-plan-cn`, and `ZHIPU_API_KEY` also
  enables `zai` and `zhipuai*`. Only the provider named in the catalog has an
  endpoint in its profile, so the others are denied.
- **OAuth logins** (ChatGPT, Claude Pro/Max, Copilot) are not supported,
  because they need in-sandbox auth.

## 3. Create a sandbox

```sh
openshell sandbox create --name opencode \
  --from opencode-agent:local \
  --policy opencode-oss/policies/minimal.yaml \
  --provider opencode-synthetic \
  --upload ./my-project:/sandbox/project

openshell sandbox list                       # opencode … Ready
openshell policy get opencode --full         # only the profile's endpoint
```

`--upload ./my-project:/sandbox/project` lands the directory at
`/sandbox/project/my-project`, so pass that path as `--workdir` below.
`openshell sandbox upload opencode <path> /sandbox/project` adds files
later.

## 4. Run OpenCode

Always pass `--standalone`. Without it, OpenCode starts a long-lived
background service inside the sandbox.

**Headless.** Redirect stdin from `/dev/null`. `opencode run` reads stdin
when it is not a terminal, and `openshell sandbox exec` leaves stdin open, so
without the redirect the run waits forever.

```sh
openshell sandbox exec -n opencode --workdir /sandbox/project/my-project --no-login-shell -- \
  opencode run --standalone --auto --format json \
  --model synthetic/hf:zai-org/GLM-5.3 "reply OK" </dev/null

# Continue the most recent session, or a specific one:
openshell sandbox exec -n opencode --workdir /sandbox/project/my-project --no-login-shell -- \
  opencode run --standalone --auto --format json --continue \
  --model synthetic/hf:zai-org/GLM-5.3 "and now?" </dev/null
#   … --session <sessionID from the JSON events>
```

`--auto` approves every tool call that the config does not explicitly deny.
Drop it to be asked instead (interactive use only).

**Interactive TUI.**

```sh
openshell sandbox exec -n opencode --tty --workdir /sandbox/project/my-project --no-login-shell -- \
  opencode --standalone            # add --auto to skip approval prompts
```

The TUI has no `--model` flag. Its default is OpenCode's free tier, which the
sandbox denies, so the TUI shows "Retrying … ECONNREFUSED". Choose a model
your profile covers in one of two ways:

- Pick it in the TUI with `/models`.
- Put it in the project's own `opencode.json`. That file travels with the
  project and is never baked into the image:

```json
{ "$schema": "https://opencode.ai/config.json", "model": "synthetic/hf:zai-org/GLM-5.3" }
```

## 5. Bring files back

```sh
openshell sandbox download opencode /sandbox/project/my-project/<file-or-dir> ./out/
```

There is no bind mount and no automatic sync. Only what you download leaves
the sandbox.

## 6. Tear down

```sh
openshell sandbox delete opencode
openshell provider delete opencode-synthetic   # optional
```

## What the baked config enforces

`image/config/opencode.json` sets `update: "disable"` and
`share: "disabled"`, plus a `permissions` ruleset. The rules deny these
`shell` commands: `sudo`, `su`, `ssh`, `scp`, and `opencode auth*`. They also
deny `edit`/`write` under `/sandbox/.config/**`, so the agent cannot rewrite
its own rules. There is no allow rule. The rules hold under `--auto`.

Notes for 2.1.4:

- The shell tool's permission action is `shell`, not `bash`.
- The `write` tool is checked as `edit`.
- An invalid entry is skipped with only a `configuration normalization
  diagnostic` warning in `--print-logs`. Check the logs after any config
  change.

Personal additions (MCP servers, plugins, skills, a default model, UI
preferences) belong in an image built `FROM opencode-agent:local` or in the
project's own `opencode.json`, not in this base. See the environment-store
pattern in [`docs/ai/environment-playbook.md`](../docs/ai/environment-playbook.md).

## Known behavior

- **Catalog refresh is denied.** Each run tries
  `models.opencode.ai/api.json`. The sandbox denies it, and OpenCode logs one
  `Failed to fetch models.dev` error and uses the bundled catalog. The run is
  not delayed. `OPENCODE_DISABLE_MODELS_FETCH=1` removes the attempt under
  plain `docker run`. However, `openshell sandbox exec` does not pass image
  `ENV` through, so the image does not set it.
- **Avoid commands without `--standalone`.** A command run without it, such
  as `opencode debug config`, starts the background service and writes a
  `service.json` with that service's password under `/sandbox`. Prefer
  `--standalone` everywhere, and never run such a command in the image build.

## Verification record

Run on 2026-10-25 with OpenCode 2.1.4, OpenShell 0.1.5, Docker 29.4.0
(OrbStack), and an arm64 macOS host. The live checks used the
`opencode-synthetic` profile and model `synthetic/hf:zai-org/GLM-5.3` in
sandbox `opencode-verify`.

| Check | Command (abridged) | Observed |
|---|---|---|
| Version pinned | `docker run --rm opencode-agent:local opencode --version` | `opencode v2.1.4` |
| Integrity fails closed | `docker build --build-arg OPENCODE_SHA512_ARM64=abab… opencode-oss/image` | `/tmp/opencode.tgz: FAILED`, no image |
| Sandbox user | `docker run --rm opencode-agent:local id` | `uid=1500(sandbox) gid=1500(sandbox)` |
| Agent-only | `command -v node bun`; config `mcp`/`plugin` keys | none; config has neither |
| No credential baked | `find /sandbox -type f` in the image | only `opencode.json` and shell dotfiles (no `auth.json`, no `service.json`) |
| Offline catalog | `docker run --rm --network none -e <11 env vars>=dummy … opencode models --standalone` | exit 0 in ~1s; all 11 catalog providers listed; every `example-model` present |
| Config accepted | `opencode models --standalone --print-logs --log-level debug` | no WARN/ERROR lines (an invalid test entry does produce a warning) |
| Profiles lint | `openshell profile lint --from opencode-oss/providers` | `Provider profile lint passed.` (12 profiles) |
| Profiles bind OpenCode only | `binaries` of all 12 profiles | exactly `/usr/local/bin/opencode` |
| Profiles match Maki originals | YAML compare ignoring id/display_name/description/binaries | 12 same, 0 differ |
| Catalog ↔ profiles | rows vs files; env var in profile; model in offline list | 12 rows, 12 profiles, OK |
| Policy floor | `read_write`, Landlock, process fields | `/sandbox`, `/tmp`, `/dev/null`; `hard_requirement`; 1500/1500; no `network_policies` |
| Sandbox Ready + effective policy | `openshell sandbox list`; `openshell policy get … --full` | Ready; one network policy: `api.synthetic.new:443` for `/usr/local/bin/opencode` |
| Filesystem floor | `id`; write `/sandbox/project`, `/tmp`, `/usr`, `/etc` | uid 1500; ok, ok, denied, denied |
| Credential stand-in | env var set and length only; hash compared with host key | set, length 60 (host key 36); hashes differ |
| Egress denied | `curl -sS -m 10 https://example.com` | `Couldn't connect to server`; OCSF `DENIED /usr/bin/curl -> example.com:443` |
| Headless run | `opencode run --standalone --auto --format json … "reply OK" </dev/null` | exit 0; JSON `text` event `OK`, about 11s |
| Session continues | same with `--continue` | same `sessionID`; reply `AGAIN` |
| Denies hold under `--auto` | prompt asking for `sudo -n true`, `opencode auth list`, an edit and a write under `/sandbox/.config/opencode/` | all four `Permission denied: shell`/`edit`; config sha256 unchanged |
| Allowed tools still run | prompt asking to write `hello.txt` and `ls` | `write` and `shell` completed |
| TUI attaches | `openshell sandbox exec --tty … opencode --standalone --auto`, driven through a PTY | renders; with the project `model` set, the prompt is answered (with the default free model: `ECONNREFUSED` retries, see §4) |
| Explicit download | `openshell sandbox download opencode-verify /sandbox/project/hello.txt …` | `Download complete`; sha256 matches the sandbox copy |
| Denied internal egress | `openshell logs … \| grep DENIED` during a run | only `models.opencode.ai:443` from `/usr/local/bin/opencode`; run not delayed |
| No placeholder spelling | `grep -rF` for the prefix (built from fragments) over `opencode-oss/` | no matches |

Profiles other than `opencode-synthetic` were linted and compared but not
run live.
