# Maki-side provider spike (task 1.1)

Maki pin: **v0.6.4** (`tontinton/maki`). The findings below come from the source
at that tag and one live boot inside a throwaway OpenShell sandbox.

## How the pin configures a custom OpenAI-compatible provider

`providers.toml` lives in Maki's config directory — `~/.config/maki/providers.toml`
on Linux, `$XDG_CONFIG_HOME/maki/providers.toml` when set
(`site/docs/content/providers/_index.md:378`, read path
`maki-config/src/providers.rs:459-463` → `maki-storage/src/paths.rs:269`).
A custom slug is a table in that file. `protocol` is required for a custom
slug and `base_url` is the origin Maki appends its protocol paths to:

- `maki-config/src/providers.rs:203-208` — `Protocol` is
  `openai | openai-responses | anthropic | google`.
- `maki-config/src/providers.rs:283-357` — `ProviderDef` carries
  `display_name`, `protocol`, `base_url`, `api_key_env`, `api_key`,
  `default_model`, and `models`.
- `maki-config/src/providers.rs:367-415` — the file is parsed as TOML at
  startup; a parse error exits 2 instead of silently emptying the registry.
- `site/docs/content/providers/_index.md:378-455` — field table, including
  "Custom slugs must not reuse a built-in provider name."

Source citations use the tag URL
`https://github.com/tontinton/maki/blob/v0.6.4/<path>`.

## Working provider config

```toml
[mock]
display_name = "Mock"
protocol = "openai"
base_url = "http://127.0.0.1:47901/v1"
api_key = "journey-placeholder"
default_model = "mock/mock-model"

[[mock.models]]
id = "mock-model"
tier = "medium"
context_window = 32768
max_output_tokens = 4096
```

`api_key` is a fixed placeholder, not a credential: the stub ignores the
header. Maki sends `POST <base_url>/chat/completions` over the OpenAI protocol;
no title request is made, so one journey turn is exactly one model request.

## YOLO and permission asks

- `maki-config/src/lib.rs:339-341` — `always_yolo` is a top-level `init.lua`
  config field, default `false`.
- `maki-config/src/lib.rs:521`, `:572` — it parses from `maki.setup(...)` and
  the effective default is `false`; a project overlay wins over the global file.
- `maki-agent/src/headless.rs:343` — the resolved `yolo` value feeds the
  permission engine (`permissions_config.yolo |= params.yolo`).
- `maki-agent/src/permissions.rs:789-860` — under YOLO a matching call is
  allowed without a prompt; otherwise a `NeedsPrompt` call emits
  `AgentEvent::PermissionRequest` and waits for an answer.
- `src/sdk_mode.rs:78-86` — SDK mode maps `--permission-mode` first, then
  `--yolo`, else `Default` (asks).
- `src/sdk_mode.rs:1130-1166` — in `Default` mode the event is emitted on the
  SDK wire as `control_request` with `subtype: "can_use_tool"`, tool name and
  input; the bridge answers it with a `control_response`.

The baked image config (`examples/maki-image/config/init.lua`) sets
`always_yolo = true`, so a live journey run must upload a journey-only
`init.lua` with `always_yolo = false` to see the dialog the reference shows.
The journey config also pins the startup model, because the sandbox has no
provider credential for auto-detection:

```lua
maki.setup({
    always_yolo = false,
    provider = { default_model = "mock/mock-model" },
    trust = { paths = { "/sandbox", "/sandbox/**" }, prompt = false },
})
```

`provider.default_model` is the startup fallback
(`maki-config/src/lib.rs:839-867`, `src/setup.rs:81-91`); keeping the image's
trust paths is required or a headless run skips the project config.

## Live verification in a throwaway sandbox

Sandbox: `maki-spike-1`, created from `maki-agent:local` with
`examples/policies/maki-minimal.yaml`, no `--provider`, deleted after this
spike. `openshell sandbox provider list` reported "No providers attached".

Stub (`/tmp/stub.ts`, image Bun 1.4.3) bound `127.0.0.1:47901` inside the
sandbox and answered every `/chat/completions` request with a `PONG` stream.
Maki ran as uid 1500 with the journey-only config above:

```sh
openshell sandbox exec -n maki-spike-1 --no-login-shell --workdir /sandbox -- \
  maki --print "Reply with the word PONG only."
```

Output: `PONG` (exit 0). The stub received one request:

```
POST /v1/chat/completions model=mock-model roles=['system','user'] stream=True tools=19
```

No other endpoint was involved: the provider is on the sandbox's own
loopback, and the host's loopback is not routable from the sandbox namespace.

Effective policy during the run, `openshell policy get maki-spike-1 --full`:

```yaml
version: 1
filesystem_policy:
  include_workdir: true
  read_only:
    - /usr
    - /lib
    - /bin
    - /etc
    - /proc
    - /dev/urandom
    - /var/log
  read_write:
    - /sandbox
    - /tmp
landlock:
  compatibility: hard_requirement
process:
  run_as_user: "1500"
  run_as_group: "1500"
```

That is `examples/policies/maki-minimal.yaml` byte for byte: no provider
rules, no egress rule, no widened policy.

## Conclusion carried into the live runner

Both preconditions hold: Maki 0.6.4 targets an OpenAI-compatible endpoint from
`providers.toml`, and the minimal policy lets a sandbox process reach its own
loopback. The runner starts the harness's standalone mock provider under the
image's Bun on the sandbox loopback, uploads the journey-only `init.lua` and
`providers.toml`, and points `providers.toml` at the provider's port. No
network rule, provider profile, credential, bind mount, or `--env` value is
needed.
