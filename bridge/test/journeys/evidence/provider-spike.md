# Reference-side provider spike (task 1.1)

OpenCode pin: **v2.0.32** (`anomalyco/opencode`). The findings below come from
the source at that tag, the vendored contract, and a boot against a stub on
loopback.

## How the pin configures an OpenAI-compatible provider

A provider is an entry under top-level `providers`. `Config.Info` declares
`providers` as a record of `Config.Provider.Info`:

- `packages/schema/src/config.ts:112` — `providers: Schema.Record(Schema.String, ConfigProvider.Info)`
- `packages/schema/src/config/provider.ts:10-22` — `Settings` is a struct with
  `timeout`, `headerTimeout`, `chunkTimeout`, `compaction`, `transport`, and
  `encoding`, plus open-ended JSON keys. `baseURL`, `provider`, and `apiKey`
  ride on that open-ended part.
- `packages/core/src/plugin/provider/local.ts:188-209` — the local provider
  reads `settings.baseURL` and `settings.apiKey`, strips the suffix, and builds
  the endpoint.
- `packages/core/src/plugin/provider/local.ts:63-77` — the provider runtime
  sets `package = "@opencode/ai/providers/openai-compatible"` and
  `settings = { baseURL, provider, apiKey }`.

The package name is therefore the bundled `@opencode/ai/providers/openai-compatible`,
not an npm install. `packages/core/src/aisdk-native.ts:70` maps the AI SDK
package `@ai-sdk/openai-compatible` onto that bundled package.

The vendored contract carries the same encoded shape:
`bridge/src/openapi-2.0.32.json` → `Config.ProviderEncoded` has `package`,
`settings` (`Config.Provider.Settings`), `headers`, `models`, and `body`; the
`settings` schema is open-ended beyond the named timeouts. This is why the
config below is valid at the pin without a `baseURL` field in the schema.

Model selection uses top-level `model`, either `"provider/model"` or the
explicit object (`packages/schema/src/config/model.ts:13-34`).

## Working config

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "mock/mock-model",
  "providers": {
    "mock": {
      "name": "Mock",
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "http://127.0.0.1:47832/v1",
        "provider": "mock",
        "apiKey": "journey-placeholder"
      },
      "models": {
        "mock-model": {
          "name": "Mock Model",
          "capabilities": { "tools": true, "input": ["text"], "output": ["text"] }
        }
      }
    }
  }
}
```

Source citations use the tag URL
`https://github.com/anomalyco/opencode/blob/v2.0.32/<path>`.

## Boot against a loopback stub

Command shape (isolated home, no host credentials, stub on `127.0.0.1:47832`):

```sh
env -i PATH="$PATH" HOME="$RUN/home" \
  XDG_CONFIG_HOME="$RUN/home/.config" XDG_DATA_HOME="$RUN/home/.local/share" \
  XDG_STATE_HOME="$RUN/home/.local/state" XDG_CACHE_HOME="$RUN/home/.cache" \
  opencode run --standalone --model mock/mock-model "Reply with the word PONG only."
```

The stub received exactly the expected requests and no provider package was
fetched:

```
STUB 47832
POST /v1/chat/completions
BODY {"model":"mock-model","messages":[{"role":"system","content":"You are a title generator. ...
POST /v1/chat/completions
BODY {"model":"mock-model","messages":[{"role":"system","content":"You are an AI agent running in OpenCode, ...
```

`lsof -nP -i` scoped to the two processes started by this run (the CLI,
pid 73298, and its private server, pid 73300) shows only loopback sockets;
the only provider peer is the stub port 47832:

```
opencode. 73298 ki 10u IPv4 ... TCP 127.0.0.1:60637->127.0.0.1:60636 (ESTABLISHED)
opencode. 73298 ki 11u IPv4 ... TCP 127.0.0.1:60641->127.0.0.1:60636 (ESTABLISHED)
opencode. 73298 ki 12u IPv4 ... TCP 127.0.0.1:60642->127.0.0.1:60636 (ESTABLISHED)
opencode. 73300 ki  7u IPv4 ... TCP 127.0.0.1:60636 (LISTEN)
opencode. 73300 ki 11u IPv4 ... TCP 127.0.0.1:60636->127.0.0.1:60637 (ESTABLISHED)
opencode. 73300 ki 14u IPv4 ... TCP 127.0.0.1:60636->127.0.0.1:60641 (ESTABLISHED)
opencode. 73300 ki 15u IPv4 ... TCP 127.0.0.1:60643->127.0.0.1:47832 (ESTABLISHED)
opencode. 73300 ki 16u IPv4 ... TCP 127.0.0.1:60644->127.0.0.1:47832 (ESTABLISHED)
opencode. 73300 ki 17u IPv4 ... TCP 127.0.0.1:60636->127.0.0.1:60642 (ESTABLISHED)
```

No `*_API_KEY` or `OPENCODE_*` variable was passed, and the isolated cache was
never populated with a provider package. First use therefore needs no network
beyond the loopback scripted provider; the harness does not pre-seed a cache.

## Conclusion carried into the harness

`harness/record.ts` writes this config with the mock provider's assigned port,
selects `mock/mock-model`, and gives each run a fresh home/workdir. The
`@opencode/ai/providers/openai-compatible` package is built into the pinned
binary, so no package fetch is part of the reference run.

`opencode run` also asks for a session title before the journey turn. Two
`/chat/completions` requests are expected: the first is title traffic and does
not consume a journey turn; the second is the journey's first turn.
