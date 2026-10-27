# Design

## Context

The dashboard spawns only `osa`, and only argv shapes accepted by `isAllowedOsaArgv` in `src/projects.ts`. The runner spawns with `stdin: "ignore"`. Mutations go through `guardMutation`, which checks read-only mode and `X-Dashboard-Token`. The resolve route set the pattern for a write:

- the server builds the argv from an action name;
- it guards against concurrency with a per-sandbox in-flight set;
- it maps exit 0 to 200 and exit 2 to 409, and anything else to an error.

On loopback the page embeds the token. Off loopback the token is required for every route, but transport is plain HTTP. The README promises "No secrets through the dashboard", and this change replaces that promise with a narrower one.

`add-provider-setup-noninteractive` provides:

- `osa providers --json`: per agent, `setup` (`stdin` or `login` plus `command`), `profiles`, `gateway`, and `remembered`.
- `osa provider setup TAG --profile ID [--name N] [--attach S] [--yes] --json`: reads the credential on stdin; exit codes 0/1/2/3.

## Goals / Non-Goals

**Goals:**

- Provider setup in the browser for every agent whose setup takes a single secret.
- The credential crosses exactly one boundary inside the dashboard: request body to child stdin.
- No new spawn target, and no copy of profile logic.

**Non-Goals:**

- Setup off loopback.
- Custom profiles.
- Codex login.
- Default model selection.
- Detaching or deleting providers.
- Showing gateway provider details beyond names.

## Decisions

### D1: Two routes, two argv shapes

- **`GET /api/providers`** runs `osa providers --json`.
  - It follows the normal read rules: open on loopback, token required off loopback.
  - Nothing is cached. The section loads when the Setup tab opens and after each setup, and it is never polled.
  - The timeout is 20 s, since it lists the gateway once per agent.
- **`POST /api/providers/setup`** takes the body `{agent, profile, name?, attach?, replace?, credential}`.
  - The server validates each field: `agent` is a known tag; `profile` and `name` match the kebab regex; `attach` matches `SANDBOX_NAME` and is a registry entry with that agent; `replace` is a boolean; `credential` is a non-empty string of at most 65536 bytes with no newline.
  - It builds `["provider", "setup", agent, "--profile", profile, ...("--name", name)?, ...("--attach", attach)?, ...("--yes")?, "--json"]`.
  - The `--yes` flag is added only when `replace === true`.
- **`isAllowedOsaArgv`** gains two exact shapes: `["providers", "--json"]`, and the setup shape checked position by position against the same regexes. An argv that does not match either shape is refused.

Alternatives: one route that both lists and sets up. Rejected, because listing must work in read-only mode and setup must not.

### D2: Guard order on the setup route

The setup route checks, in this order:

1. The bind is not loopback: 403 `loopback_only`. The body is never read.
2. `guardMutation` refuses read-only mode or a bad token with 403.
3. The `Content-Type` is not `application/json`: 415.
4. The `Content-Length` is missing or over 70 KiB: 413. The body is then read with a byte-counting reader that stops at 70 KiB, which also covers chunked bodies.
5. Field validation fails: 400. The error names the field, never its value.
6. Another setup is in flight: 409 `busy`. This is one global flag, since providers are global and setups are rare.

The loopback-only check comes first, so a remote client never gets as far as sending the secret over the network to a guard that would refuse it anyway. The page shows "Provider setup is available only when the dashboard is bound to loopback" and hides the form.

### D3: The stdin runner and redaction

`OsaRunner` gains a `runWithStdin(args, input, timeoutMs)` method.

- It spawns with `stdin: "pipe"`, writes `input`, calls `end()`, and then reads stdout and stderr as `run` does.
- It goes through the same `isAllowedOsaArgv` gate, and only the setup shape may use it.
- The default timeout is 120 s, because attach `--wait` can be slow. On timeout it kills the child and returns a `timeout` error.

The route handler holds the credential in one local `const`. After the child exits:

- every occurrence in stdout and stderr is replaced with `[redacted]`, using a split/join on the exact string, before parsing or including them in an error `detail`;
- the local variable goes out of scope.

The server never logs request bodies today. A test asserts that the server's console output during a setup does not contain the fixture credential.

Error objects carry `argv`. The setup argv never contains the credential, and a test asserts that too.

### D4: Outcome mapping mirrors resolve

| osa exit | HTTP | Body |
|---|---|---|
| 0 | 200 | osa's object plus `exitCode` |
| 2 | 409 | osa's object plus `exitCode`, and `error.kind: "refused"` |
| 1 | 400 | `error` |
| 3 | 502 | osa's object plus `exitCode` and `error`, so the UI can show which steps completed |
| timeout or spawn failure | 504 / 500 | `error` |

### D5: Client wizard

`src/app/providers.js` renders the Setup tab's Providers section, one card per agent: the gateway names, the remembered names, and the profiles. Each card has a "Set up" button, or for `login` agents a copyable command.

`src/app/setup.js` renders the wizard as a form inside the card, not a modal. It has these controls:

- a profile `<select>`, whose option text shows the id, the env var, and the note;
- a name input;
- a credential `<input type="password" autocomplete="new-password" spellcheck="false">`;
- an attach `<select>` built from the projects list filtered by agent and joined with the inventory, as M1's client join does;
- a "Replace existing credential" checkbox, shown only when the name is in `gateway`.

How the credential is handled:

- It is read from the input's `.value` at submit time and passed straight into `JSON.stringify` for the `fetch` body. It is never stored in `state.js`.
- The input is cleared in a `finally` after the request, on Cancel, and on `pagehide`.
- All rendering goes through `h()` and text nodes, so the existing no-HTML-sink test covers the new modules.

The Setup tab is added beside Projects and Sandboxes. `dashboard-image-build` adds its Images section to the same tab; whichever change lands first creates the tab.

The Configure link in `detail.js` appears when `providersTable` would render "No providers attached." and the sandbox has a registry entry. It opens the Setup tab with the agent and sandbox selected.

### D6: README and threat model

The README changes in four places:

- The note "No secrets through the dashboard" becomes "Secrets only through provider setup", and it states the D2 and D3 path.
- The threat model gains a fourth asset, **provider credentials in transit**, with these guards:
  - loopback-only;
  - the token;
  - stdin-only handoff;
  - redaction;
  - no storage on the page.
- A residual risk is stated plainly: a local process that can read the token can also submit a setup, but it gains nothing it could not already do with `openshell` as the same user.
- The "No host bind mounts" bullet lists the new `osa` shapes.

## Risks / Trade-offs

- **[Credential in browser memory]** The value sits in the input and the JS heap until the field is cleared, and garbage collection is not controllable. This is acceptable on a loopback page the user opened themselves, and it is the same exposure as a password manager filling a form.
- **[Loopback plain HTTP]** Loopback traffic does not leave the host. Off loopback the route is refused, so nothing travels unencrypted over a network.
- **[`osa` echoes the secret]** It is not expected to, given the helper's own tests. Redaction is defense in depth.
- **[One global in-flight flag]** Two concurrent setups for different agents queue behind each other with a 409. Rare, and simpler than per-agent locks around the shared gateway profile import.

## Migration Plan

Additive. No config or state changes. The README promise changes wording, and the change is called out in the README itself.

## Open Questions

None.
