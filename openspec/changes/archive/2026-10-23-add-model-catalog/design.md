# Design

## Context

- Maki v0.6.4:
  - `maki models` prints `println!("{model}")` per `provider/model-id`, with
    warnings on stderr (`src/cmd/subcmd.rs` L601–L630). Providers that cannot
    be created are skipped (`maki-providers/src/provider.rs` L217–L220).
  - `maki auth status` prints one line per provider. For env-backed keys the
    line ends `(via <VAR>)`, and an unconfigured provider ends
    `(run: maki auth login …)`.
  - The sandbox gets keys only as OpenShell provider placeholders in the
    environment. `maki auth login` never runs there (project security
    invariant).
- OpenCode v2.0.32:
  - The TUI selects the first valid model, and submit needs one
    (`tui/src/context/local.tsx` L44–L48, `prompt/index.tsx` L1161–L1164).
  - "Connected" means any integration has a connection
    (`tui/src/util/connected-provider.ts` L3).
  - `Connection.EnvInfo {type: "env", name}` and
    `Integration.EnvMethod {type: "env", names}` are pinned in the vendored
    OpenAPI.

## Decisions

1. **Catalog once, model order live.** The catalog does not change for the
   bridge's lifetime. The announced model is checked on every read, which
   keeps `model-list-refresh` and `model-identity` intact.
2. **Unknown model facts stay empty, not invented.** `cost` is `[]` (a zero
   cost would read "Free"), `variants` is `[]`, and `limit` is 0 as before.
   `capabilities.tools` is true because Maki gives every model its tools.
3. **Env is the only connection method.** It is what the sandbox has. The TUI
   gets no OAuth or key method that would put credentials through it.
4. **The scripted sandbox is hermetic.** A host-installed `maki` answered the
   catalog read in the first run. The scripted sandbox now sees only system
   dirs, the real git dir and `FAKE_SANDBOX_BIN`.

## Risks / Trade-offs

- `maki auth status` is human-readable text and could change format on a pin
  bump. `compat-drift` and the parse test pin it to v0.6.4.
- Neither CLI was run against a live sandbox in this change. The shapes come
  from the pinned source.
