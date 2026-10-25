# Tasks

## 1. Image

- [x] 1.1 Create `opencode-oss/image/Dockerfile` (ubuntu:24.04, `OPENCODE_VERSION=2.1.4`, per-arch npm tarball + sha512 integrity build args, extract `package/bin/opencode` to `/usr/local/bin/opencode`, uid/gid 1500 home `/sandbox`, `USER sandbox`), and verify `docker build -t opencode-agent:local opencode-oss/image` succeeds and `docker run --rm opencode-agent:local opencode --version` prints `2.1.4`
- [x] 1.2 Verify the integrity check fails closed: build with a corrupted `OPENCODE_SHA512_*` build arg and confirm the build fails at the integrity step
- [x] 1.3 Verify identity and agent-only content: `docker run --rm opencode-agent:local id` reports uid/gid 1500, `command -v node bun` finds nothing, and `/sandbox` holds no `auth.json`

## 2. Config

- [x] 2.1 Write `opencode-oss/image/config/opencode.json` (`$schema`, `update: "disable"`, `share: "disabled"`, `permissions` deny ruleset for `sudo`, `su`, `ssh`, `scp`, `opencode auth`, and edits under `/sandbox/.config/**`; no allow, no `provider(s)`, `mcp`, or `plugin(s)`), COPY it to `/sandbox/.config/opencode/opencode.json`, and verify `opencode debug config` in the image lists it as the loaded source, and that `opencode models --standalone --print-logs --log-level debug` emits no WARN/ERROR line (2.1.4 skips invalid entries, logging only a "configuration normalization diagnostic" warning, so a clean load alone proves nothing)
- [x] 2.2 If 2.1.4 rejects or ignores the `permissions` ruleset, switch to the deprecated `permission` object per design D3 and record the reason in the README; verify with the same `opencode debug config` check (skip if 2.1 passes) — skipped: the ruleset loads with no diagnostic; deny behavior is proven live in 7.7

## 3. Model catalog

- [x] 3.1 Confirm whether 2.1.4 needs a build-time catalog seed (design D4: it does not; the catalog is bundled), make sure the image bakes no `service.json`, and verify `docker run --rm --network none -e <each catalog env var>=dummy opencode-agent:local timeout 30 opencode models` exits 0 and lists every OpenCode provider ID in `catalog.tsv`
- [x] 3.2 If 3.1 stalls or fails offline, find OpenCode 2.1.4's models-fetch and LSP-download disable switches in the binary or docs (`strings` / `opencode.ai/docs`), set them as image `ENV`, and verify 3.1 passes (skip if 3.1 passes as is) — skipped: offline listing returns in about 1s

## 4. Provider profiles

- [x] 4.1 Fork `examples/providers/maki-{openai,anthropic,openrouter,deepseek,synthetic,nano-gpt,opencode,opencode-go,zai-coding,kimi-for-coding,minimax-coding-plan,xiaomi-token-plan-sgp}.yaml` to `opencode-oss/providers/opencode-<name>.yaml` with new id/display_name/description/comments and `binaries: [/usr/local/bin/opencode]`, and verify `openshell profile lint -f` passes for every file
- [x] 4.2 Verify that each fork's `credentials` and `endpoints` blocks are identical to its Maki counterpart by comparing them with a scripted YAML diff that ignores id/display_name/description/binaries
- [x] 4.3 Write `opencode-oss/providers/catalog.tsv` (`profile-id`, `opencode-provider`, `env-var`, `example-model`, `note`) using provider IDs and models taken from the baked catalog, and verify every row maps to an existing profile file, every profile has exactly one row, and every `example-model` appears in the offline `opencode models` output

## 5. Policy

- [x] 5.1 Create `opencode-oss/policies/minimal.yaml` from `examples/policies/maki-minimal.yaml`, with comments that name the OpenCode image, and verify that `/sandbox`, `/tmp`, and `/dev/null` are the only read-write paths, that it sets `landlock.compatibility: hard_requirement` and `run_as_user/group: "1500"`, and that it has no `network_policies`

## 6. Guide

- [x] 6.1 Write `opencode-oss/README.md` covering: what it is and isn't (vs. the TUI bridge); build; profile import and `provider create --from-existing`; sandbox create with `--policy` and `--provider`; upload; headless `opencode run --standalone --auto --format json --model …`; `--continue` and `--session`; interactive `opencode --standalone` over `openshell sandbox exec --tty`; download; teardown; the `FROM opencode-agent:local` environment-store note; and the pin coordination note. Verify the README has no `--env`/`--env-from` credential use and no `opencode auth login`, and mentions the placeholder only in prose
- [x] 6.2 Add a one-line `opencode-oss/README.md` link to the root `README.md` Guides list, and verify the link resolves

## 7. Live verification (real OpenShell sandbox)

- [x] 7.1 Import one profile the user has a host credential for, create its provider with `--from-existing`, and create a sandbox from `opencode-agent:local` with `opencode-oss/policies/minimal.yaml`; verify `openshell sandbox list` shows it Ready and `openshell policy get <name> --full` shows only that profile's endpoint
- [x] 7.2 Run the filesystem floor check (`id`; write `/sandbox/project` and `/tmp`; attempt `/usr` and `/etc`), and verify uid 1500, two successes, and two failures
- [x] 7.3 Run the credential check (report only whether the profile env var is set and its length, never its value), and verify the sandbox holds an opaque stand-in, not the host key
- [x] 7.4 Run `curl -sS -m 10 https://example.com` in the sandbox, and verify it is denied
- [x] 7.5 Run the headless `reply OK` command with `--format json`, and verify exit 0, a JSON reply containing OK, and no stall from denied internal requests (check the OpenShell logs for denied hosts and record them)
- [x] 7.6 Run a second headless prompt with `--continue`, and verify it reuses the first session ID
- [x] 7.7 Ask a headless `--auto` run to run `sudo -n true` and to append to `/sandbox/.config/opencode/opencode.json`, and verify both are denied by permission rules and the config file is unchanged
- [x] 7.8 Attach the TUI with `openshell sandbox exec --tty … opencode --standalone`, and verify it renders and answers one prompt (if the attach cannot be scripted, record it as a manual check)
- [x] 7.9 Have the agent create `/sandbox/project/hello.txt`, run `openshell sandbox download`, and verify the host file content matches
- [x] 7.10 Run `grep -r` across `opencode-oss/` for the literal placeholder prefix (built from fragments in the shell, never typed whole), and verify there are zero matches

## 8. Record and close

- [x] 8.1 Add a verification record to `opencode-oss/README.md` (date, OpenCode 2.1.4, OpenShell version, host arch, each check's command and observed result, and any fallback from 2.2/3.2), and verify every spec scenario has a row
- [x] 8.2 Verify that `git diff --stat main...HEAD` touches only `opencode-oss/`, `openspec/changes/add-opencode-oss/`, and `README.md`, and that `openspec validate add-opencode-oss --strict` passes
