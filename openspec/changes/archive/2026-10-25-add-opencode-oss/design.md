# Design: add-opencode-oss

## Context

See proposal.md for motivation and specs/opencode-oss/spec.md for the
requirements. The current state that shapes the approach:

- `examples/maki-image/Dockerfile` sets the agent-only base pattern: an
  Ubuntu 24.04 base, one pinned static binary, uid/gid 1500 with home
  `/sandbox`, baked global config and deny rules, a build-time model-catalog
  snapshot, and no MCP servers or personal preferences.
- `examples/providers/maki-*.yaml` are curated OpenShell profiles whose
  `binaries` list is `/usr/local/bin/maki`. OpenShell binds a credential to
  its endpoints for the listed binaries only, and a sandbox can attach one
  provider per credential key.
- `examples/policies/maki-minimal.yaml` is already agent-neutral: it covers
  the filesystem floor, a hard Landlock requirement, and uid/gid 1500, and it
  grants no egress.
- OpenCode 2.1.4 (checked on the host binary, `opencode --version` →
  `v2.1.4`):
  - It ships as a compiled native binary in per-platform npm packages
    `@opencode/cli-linux-arm64` and `@opencode/cli-linux-x64-baseline`, at
    `package/bin/opencode`. npm publishes an sha512 `dist.integrity` for each.
  - `opencode run` accepts `--standalone`, `--auto`, `--format json`,
    `--model provider/model#variant`, `--continue`, and `--session`. The TUI
    accepts `--standalone`, `--auto`, `--continue`, and `--session`. Without
    `--standalone`, OpenCode connects to or starts a shared background
    service.
  - In the config schema (https://opencode.ai/config.json), the `permission`
    object is marked deprecated. Its replacement, `permissions`, is an
    ordered array of `{action, resource, effect}` rules with effect `allow`,
    `deny`, or `ask`. The schema also has `update` (`disable|notify|auto`)
    and `share` (`manual|auto|disabled`).
  - `opencode models` lists only providers whose credential env var is
    present. The catalog's provider IDs include `kimi-code-plan-global`
    (`KIMI_API_KEY`, `api.kimi.ai/coding/v1`), `zai-coding-plan`
    (`ZHIPU_API_KEY`), and `minimax-coding-plan` (`MINIMAX_API_KEY`,
    `api.minimax.io/anthropic/v1`).
  - Runtime state lives under `$HOME/.local/share/opencode` (database, logs),
    `$HOME/.cache/opencode` (catalog, downloaded tools), and
    `$HOME/.local/state/opencode`. With `HOME=/sandbox`, all of these are
    inside the writable floor.

## Goals / Non-Goals

**Goals:**

- Ship an image, profiles, policy, and guide that someone can follow by hand,
  with every acceptance check run against a real OpenShell sandbox.
- Keep `opencode-oss/` readable on its own. A reader should not need
  `bin/maki-oss` to understand it.

**Non-Goals:**

- A lifecycle helper, a fish plugin, or dashboard integration. These may come
  in a later, optional slice 2.
- An environment store for OpenCode (MCP servers, plugins, skills). The
  reference store under `examples/environments/` stays Maki-only. The guide
  states that the same `FROM opencode-agent:local` pattern applies.
- Supporting OpenCode OAuth logins (ChatGPT, Copilot, Anthropic Pro). Those
  need in-sandbox auth, which the security invariants forbid.

## Decisions

### D1. Parallel subproject, not an `--agent` flag

Add a top-level `opencode-oss/`, a sibling of `bridge/`, `oskhs/`, and
`dashboard/`, rather than generalizing `bin/maki-oss`.

- *Why:* the helper's lifecycle and sync code was only just landed. Adding
  agent switches would put ~130 launch and bridge lines on one more path and
  risk the Maki path. A slice-1 deliverable has no executable code to share.
- *Alternative:* `examples/opencode-image/` + `examples/providers/opencode-*`.
  This was rejected because it mixes two products' profiles into one
  `catalog.tsv` that `maki-oss provider setup` reads, and the wizard would
  then offer OpenCode-bound profiles for Maki sandboxes.

Layout:

```text
opencode-oss/
├── README.md              guide + verification record
├── image/
│   ├── Dockerfile
│   └── config/opencode.json
├── providers/
│   ├── catalog.tsv
│   └── opencode-<name>.yaml
└── policies/
    └── minimal.yaml
```

### D2. Install from the npm platform tarball with curl and integrity check

The Dockerfile picks the package from `dpkg --print-architecture` (`arm64` →
`@opencode/cli-linux-arm64`, `amd64` → `@opencode/cli-linux-x64-baseline`).
It downloads `https://registry.npmjs.org/@opencode/<pkg>/-/<pkg>-${OPENCODE_VERSION}.tgz`
with `curl` and checks it against the pinned npm sha512 integrity, using
per-arch build args next to `OPENCODE_VERSION`. It then extracts only
`package/bin/opencode` to `/usr/local/bin/opencode` and runs
`opencode --version`.

- *Why:* there is no Node or npm in the image, so it follows the agent-only
  rule. The integrity pin means a republished tarball cannot change the
  binary silently. The `-baseline` x64 build runs on CPUs without AVX2,
  including emulated amd64.
- *Alternative:* `npm i -g @opencode/cli`. This was rejected because it
  needs a Node runtime and runs a postinstall script.
- *Alternative:* the `opencode.ai/install` script. This was rejected because
  it is unpinned, network-heavy, and installs into `$HOME`.

The Ubuntu 24.04 base matches the Maki image (glibc, `ca-certificates`,
`curl`, `git`, `iproute2`). If the binary turns out to need extra shared
libraries, the build's `opencode --version` step fails, and the fix is to add
the named apt package. The base image does not change.

### D3. Global config uses the `permissions` ruleset

`image/config/opencode.json` contains `$schema`, `update: "disable"`,
`share: "disabled"`, and a `permissions` array of deny rules:

- `shell`: `sudo *`, `su *`, `ssh *`, `scp *`, `opencode auth*`
  (plus the bare `sudo`, `su` forms)
- `edit` and `write`: `/sandbox/.config/**`

*Revised during implementation:* in 2.1.4 the shell tool's permission action
is `shell`, not `bash`. The first draft used `bash`, and those rules never
fired: a live `--auto` run executed `sudo -n true`. OpenCode skips an unknown
action silently, so only a behavioral test catches it. The `write` tool is
checked as `edit`. The `write` rule is kept as defense in depth.

There is no allow rule, so anything not denied falls back to OpenCode's
default (ask). Headless runs opt into auto-approval with `--auto`, which per
`--help` "auto-approve[s] permissions that are not explicitly denied".

- *Why:* `permission` is deprecated in the 2.1.4 schema. Shipping deprecated
  config into a new subproject would mean a migration later.
- *Order semantics are an implementation-time check:* the schema says
  "ordered" but does not say whether the first or last match wins. With
  deny-only rules and no allow, order does not matter. A deny-wins test
  (spec: "Deny wins under auto-approve") proves the behavior either way.
- *Fallback:* if 2.1.4 rejects the ruleset or ignores it under `--auto`, use
  the deprecated `permission` object (`bash: {"sudo *": "deny", …}`,
  `edit: {"/sandbox/.config/**": "deny"}`) and record that in the README.
- *Defense in depth:* the sandbox user has no sudo, and `/sandbox/.config` is
  writable under the policy floor. So the edit deny is the only guard
  against the agent rewriting its own config. The bash denies mirror the
  Maki base's `permissions.toml`.

### D4. The model catalog ships in the binary; no build-time seeding

*Revised during implementation.* The original plan was to run
`opencode models` at build to seed `$HOME/.cache/opencode`, mirroring
`maki models --refresh`. Observed with 2.1.4:

- A build-time `opencode models --standalone --print-logs` makes no catalog
  request and writes no cache file.
- `opencode models --standalone` under `docker run --network none`, with
  dummy credential env vars, lists all curated providers in about one second.

So the catalog is captured at build time because it is part of the pinned
binary, and the image has no seeding step. Running `opencode models`
without `--standalone` at build was harmful: it started the background
service and baked its `service.json` password into `/sandbox`. The
Dockerfile says not to do that.

The offline scenario keeps the dummy-credential check. Dummy values passed
through plain `docker run -e` are not secrets, and that check never runs in
an OpenShell sandbox.

At run time, each `opencode run` still tries `models.opencode.ai/api.json`.
In a sandbox, OpenShell denies the connection, OpenCode logs one
`Failed to fetch models.dev` error and uses the bundled catalog, and the run
completes in about 11s. The binary has an `OPENCODE_DISABLE_MODELS_FETCH`
switch, and under plain `docker run` it removes the attempt. However,
`openshell sandbox exec` does not pass image `ENV` into the process, so
setting it in the image has no effect in a sandbox. The image does not set
it, so it does not imply protection it cannot give. The denied attempt is the
accepted state (spec: an outbound call is either disabled or denied, and it
does not stall).

### D5. Profiles: fork the curated set, rename, rebind the binary

For each curated provider, copy `examples/providers/maki-<name>.yaml` to
`opencode-oss/providers/opencode-<name>.yaml`. Then change `id`,
`display_name`, `description`, the header comments, and
`binaries: [/usr/local/bin/opencode]`. Keep the credentials, endpoints, and
env vars exactly as they are.

`catalog.tsv` columns: `profile-id`, `opencode-provider`, `env-var`,
`example-model`, `note`. Example mappings:

- `opencode-kimi-for-coding` → `kimi-code-plan-global`
- `opencode-zai-coding` → `zai-coding-plan`

Every OpenCode provider ID and example model is confirmed against the baked
catalog, not copied from Maki's slugs.

Set: openai, anthropic, deepseek, synthetic, nano-gpt, opencode,
opencode-go, zai-coding, kimi-for-coding, minimax-coding-plan,
xiaomi-token-plan-sgp. openrouter is added for parity, since it is cheap.
google, mistral, xai, and zai pay-as-you-go are left out until someone asks.

- *Alternative:* add `/usr/local/bin/opencode` to the existing `maki-*`
  profiles' `binaries`. This was rejected because it changes `examples/`,
  breaks the self-contained rule, and widens every Maki sandbox's credential
  binding to a binary it does not ship.

### D6. Always `--standalone`

Every documented OpenCode command uses `--standalone`, which gives each
process a private in-process server.

- *Why:* the default background service would start a long-lived daemon
  inside the sandbox. A daemon outlives the exec, has its own port, and makes
  `--tty` attach behavior depend on a hidden process.

### D7. File transfer is explicit upload/download

The guide uses these commands:

- `openshell sandbox upload <name> <local> /sandbox/project`
- `openshell sandbox download <name> /sandbox/project/<path> <local>`

It does not port the old overlay sync or reuse `bin/maki-oss` patch-sync.
If slice 2 builds a helper, it should copy the patch-sync design.

## Risks / Trade-offs

- [The 2.1.4 binary needs a shared library missing from ubuntu:24.04] →
  The build fails at `opencode --version`. Add the named apt package and
  record it.
- [OpenCode attempts update, catalog, share, or LSP-download egress at
  startup and stalls under deny-by-default] → `update` and `share` are
  disabled in config. D4 covers the catalog and LSP downloads. The
  "Run completes with egress restricted" scenario catches stalls, and
  OpenShell logs show any denied hosts.
- [A credential env var enables sibling providers (`KIMI_API_KEY` →
  `kimi-code-plan-cn` too; `ZHIPU_API_KEY` → `zai`, `zhipuai*`)] → Those
  providers have no endpoint rule, so calls to them are denied by egress. The
  guide names the one model ID per profile that works.
- [Duplicated profiles drift from `examples/providers/`] → The guide states
  that endpoints and env vars must match the Maki counterpart. A one-line
  `diff`-style check in the verification section compares credential and
  endpoint blocks.
- [The bridge pin change on `main` and this change both say 2.1.4 but bump
  independently] → Each has its own pin source: `opencode-oss/image/Dockerfile`
  and the bridge contract. The README states that they are independent.
- [MiniMax uses the Anthropic-protocol endpoint (`x-api-key` header)] → Keep
  the Maki profile's credential shape unchanged. The live run covers only the
  user's attached provider, and the README marks the others as lint-only.

## Migration Plan

This change is purely additive, so no migration is needed. To roll back,
delete `opencode-oss/` and the README line, then remove any imported
`opencode-*` profiles with `openshell profile` / `openshell provider delete`.

## Open Questions

- Which of the user's providers to attach for the live verification. Any one
  provider with a credential on the host proves the path. Prefer one the user
  already has a key for (for example `synthetic` or `opencode-go`).
