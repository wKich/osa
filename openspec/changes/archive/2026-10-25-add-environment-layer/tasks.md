# Tasks

## 1. Zero the base image

- [x] 1.1 Replace `examples/maki-image/config/mcp.toml` with a comments-only
  file that declares no servers. If Maki rejects a comments-only file, omit it
  and keep the commented template in the reference store instead. Verify with
  `python3 -c 'import tomllib; d=tomllib.load(open("examples/maki-image/config/mcp.toml","rb")); assert not d.get("mcp")'`
  and `test "$(grep -c '^\[mcp\.' examples/maki-image/config/mcp.toml)" -eq 0`,
  plus a Maki startup check from task 1.5.
- [x] 1.2 Remove `BUN_VERSION`, the Bun install block,
  `ENV PATH=/sandbox/.bun/bin:$PATH`, and the
  `bun add -g synthetic-search-mcp` step from
  `examples/maki-image/Dockerfile`; keep Maki, git/curl/ca-certificates, the
  uid/gid 1500 user, and the filesystem setup. Verify with
  `! grep -Ei 'bun|synthetic' examples/maki-image/Dockerfile` and a successful
  `docker build -t maki-agent:local examples/maki-image`.
- [x] 1.3 Reduce `examples/maki-image/config/init.lua` to the folder-trust
  block only. Verify with
  `! grep -E 'always_yolo|typewriter|thinking_lines|tool_output_lines' examples/maki-image/config/init.lua`
  and `grep -q 'paths = { "/sandbox", "/sandbox/\*\*" }' examples/maki-image/config/init.lua`.
- [x] 1.4 Keep `examples/maki-image/config/permissions.toml` and the policy
  identity unchanged. Verify with
  `grep -E 'sudo|su |maki auth|ssh|scp|/sandbox/\.config' examples/maki-image/config/permissions.toml`
  showing each deny, and `grep -E 'run_as_user|run_as_group' examples/policies/maki-minimal.yaml`
  still showing `1500`.
- [x] 1.5 Build the base and verify its contents:
  `docker run --rm maki-agent:local maki --version` prints `maki 0.6.4`;
  `docker run --rm maki-agent:local ls /sandbox/.config/maki` lists
  `init.lua`, `mcp.toml`, and `permissions.toml`; and
  `docker run --rm --entrypoint sh maki-agent:local -c '! command -v bun && ! command -v synthetic-search-mcp'`
  exits 0.

## 2. Reference environment store

- [x] 2.1 Add `examples/environments/reference/Dockerfile` with
  `FROM maki-agent:local`, a pinned `BUN_VERSION`, the Bun install, the pinned
  `synthetic-search-mcp` install, `ENV PATH=/sandbox/.bun/bin:$PATH`, and a
  copy of `config/` into `/sandbox/.config/maki/`. Verify with
  `docker build -t maki-agent:reference examples/environments/reference`,
  `docker run --rm maki-agent:reference maki --version`, and
  `docker run --rm --entrypoint sh maki-agent:reference -c 'command -v bun && command -v synthetic-search-mcp'`.
- [x] 2.2 Add `examples/environments/reference/config/mcp.toml` with the
  `context7` and `synthetic` entries moved from the base, using `${VAR}`
  placeholders only. Verify with
  `python3 -c 'import tomllib; d=tomllib.load(open("examples/environments/reference/config/mcp.toml","rb")); assert set(d["mcp"]) == {"context7","synthetic"}'`
  and a secret scan such as
  `! grep -Ei 'sk-|ghp_|Bearer [A-Za-z0-9]|api_key[[:space:]]*=' examples/environments/reference/config/mcp.toml`.
- [x] 2.3 Add `examples/environments/reference/config/init.lua` with the
  trust block plus the relocated `always_yolo` and compact-UI preferences.
  Verify with
  `grep -q 'always_yolo = true' examples/environments/reference/config/init.lua`
  and `grep -q 'trust = {' examples/environments/reference/config/init.lua`.
- [x] 2.4 Add `examples/environments/reference/README.md` and
  `.dockerignore`. The README names the shipped
  `examples/providers/mcp-context7.yaml` and `mcp-synthetic.yaml`, the build
  command, the `image` setting, and the host-side provider steps; the
  `.dockerignore` excludes `.git`, local credential files, and any host-only
  profile copies. Verify both files exist and the README paths resolve.
- [x] 2.5 Build and inspect the reference image: `maki --version` matches the
  base, Bun and `synthetic-search-mcp` resolve, and
  `docker run --rm maki-agent:reference cat /sandbox/.config/maki/mcp.toml`
  shows both servers with no credential value.
- [x] 2.6 Change `examples/config.toml` to `providers = ""` with a commented
  example, and document that `image` may name a derived environment image.
  Verify with `grep '^providers' examples/config.toml` returning
  `providers = ""` and no reference-store tag selected by default.
- [x] 2.7 Keep the MCP profiles canonical under `examples/providers/`. Verify
  `test -f examples/providers/mcp-context7.yaml` and
  `test -f examples/providers/mcp-synthetic.yaml`, then run
  `make lint-profiles` when the OpenShell CLI is available.

## 3. Guidance and documentation

- [x] 3.1 Add `docs/ai/environment-playbook.md` with the agent-agnostic
  audit → classify → generate → build → verify procedure, the
  credential/`${VAR}` rule, the unsupported-item rule, and a paste-able prompt.
  Verify the file exists, names stages and source adapters, and passes
  `scripts/check-links.sh`.
- [x] 3.2 Link the new playbook from `README.md` and `AGENTS.md`. Verify with
  `grep -q 'environment-playbook.md' README.md` and
  `grep -q 'environment-playbook.md' AGENTS.md`, and
  `scripts/check-links.sh`.
- [x] 3.3 Update `docs/ai/host-playbook.md` and `docs/ai/agent-playbook.md`
  so one-time setup builds the base, optionally builds a store, and selects
  the derived image through `image`. Verify both files name the base/store
  split and the build commands, and no step claims the base ships MCP.
- [x] 3.4 Update `docs/setup-guide.md` §3 and `docs/helper.md`'s `image build`
  and `mcp status` sections to describe the base as zero-MCP and the
  environment image as the place for MCP content. Verify with
  `grep -q 'environment' docs/setup-guide.md` and
  `grep -q 'environment' docs/helper.md`, and no remaining statement that the
  base MCP config carries servers.
- [x] 3.5 Update `docs/mcp-migration.md` §4 and `docs/glossary.md` to define
  base image, environment store, derived image, and the global/project/
  credential separation. Verify each term appears in the glossary and the
  migration guide points at the reference store, not
  `examples/maki-image/config/mcp.toml`.
- [x] 3.6 Update the MCP verification section in `docs/verification.md` to
  build and select the reference environment image, and to expect the
  environment-image guidance instead of `maki-oss image build` for a missing
  server or runtime. Verify with
  `grep -n 'maki-oss image build' docs/verification.md` showing only base-build
  uses, and `scripts/check-links.sh`.
- [x] 3.7 Audit the remaining docs for claims that the base image carries MCP
  servers or Bun. Verify with
  `grep -rn -E 'baked.*(context7|synthetic)|image.*(context7|synthetic)' docs README.md AGENTS.md`
  returning only historical verification-log or archived-change references.
- [x] 3.8 Add a short dev-only note to `docs/yagni.md` that the repository's
  `.maki/skills/ponytail*` and `opencode.json` plugin are maintainer tooling,
  not part of the base image or the reference store. Verify the note exists
  and `docs/yagni.md` still passes `scripts/check-links.sh`.

## 4. Readiness guidance and tests

- [x] 4.1 Update `bin/maki-oss`'s MCP readiness fix strings so a server or
  runtime missing from the sandbox names the environment-image build and
  `docs/ai/environment-playbook.md`, not `maki-oss image build`. Verify with
  `grep -n 'environment-playbook' bin/maki-oss`, `shellcheck bin/maki-oss`,
  and the MCP cases in `make test`.
- [x] 4.2 Update `tests/run-tests.sh` expectations for the new fix strings and
  add a zero-MCP base case: a host server absent from an empty sandbox config
  is reported with the environment-image guidance. Verify with `make test`.
- [x] 4.3 Add an offline asset test that the base Dockerfile has no Bun or
  `synthetic-search-mcp`, the base `mcp.toml` declares zero servers, and the
  reference store declares the two servers and installs Bun. Verify the new
  assertion runs under `make test`.
- [x] 4.4 Run `make test` and `make lint`; both pass.

## 5. Spec consistency and OAuth retarget

- [x] 5.1 Retarget `openspec/changes/add-oauth-mcp-support/tasks.md` and
  `proposal.md` from `examples/maki-image/config/mcp.toml` to
  `examples/environments/reference/config/mcp.toml`. Verify with
  `! grep -rn 'examples/maki-image/config/mcp.toml' openspec/changes/add-oauth-mcp-support`
  and `grep -rn 'examples/environments/reference' openspec/changes/add-oauth-mcp-support`.
- [x] 5.2 Confirm the OAuth change's spec delta does not name the base config
  path and still validates. Verify with
  `openspec validate add-oauth-mcp-support --strict`.
- [x] 5.3 Validate this change. Verify with
  `openspec validate add-environment-layer --strict` exiting 0.

## 6. Live verification

- [x] 6.1 On a host with Docker and a reachable gateway, build the base and
  the reference store, set `image` to the reference tag, and create a scratch
  sandbox. Verify `maki-oss status` reports the configured tag and
  `maki-oss mcp status` reports the config/runtime gates for both servers
  (provider gates may remain missing until profiles are attached). Delete the
  scratch sandbox afterwards.
- [x] 6.2 Record the live commands and observed output in the change's
  `evidence/live.md`, including only provider placeholder shapes and never a
  credential value. Verify the file exists and
  `! grep -Ei 'sk-|ghp_|Bearer [A-Za-z0-9]' openspec/changes/add-environment-layer/evidence/live.md`.
- [x] 6.3 Run the final gate: `make test`, `make lint`, and
  `openspec validate add-environment-layer --strict` all pass.
