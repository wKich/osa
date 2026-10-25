# Design: extract-oss-core

## Context

See proposal.md for the motivation. Current shape of `bin/maki-oss`
(3,937 lines), by section:

| Lines (approx.) | Section | Agent-specific? |
|---|---|---|
| 1–147 | header, exit codes, output helpers, `usage` | `usage` text only |
| 148–507 | repo root, defaults, config parse/resolve/write | defaults, `MAKI_OSS_*`, config path |
| 508–741 | OpenShell wrappers, safety checks (`--env` credential guard) | no |
| 742–988 | lifecycle commands (doctor, init/up, status, …) | doctor's image/engine wording |
| 989–1804 | session ensure, baseline, patch sync | `.maki-oss/git` state dir |
| 1805–1941 | idle stop | self re-exec `"$script_dir/${script##*/}" __idle-watch` |
| ~1880–2010 | `cmd_maki`, `cmd_run`, run-timeout wrapper | argv, session flags, `MAKI_OSS_RUN_TAG`, `/tmp/maki-oss-stop` |
| 1942–2436 | OpenCode TUI bridge mode (`tui = "opencode"`) | Maki-only feature |
| 2437–2632 | MCP status | parses `~/.config/maki/mcp.toml` |
| 2633–3607 | provider setup wizard | `examples/providers`, `catalog.tsv`, `maki-` custom ids, `providers.toml` hint |
| 3608–3937 | argument parsing, dispatch | `--maki-version`, Maki-only commands |

The test harness calls the script by path (`MAKI=$ROOT/bin/maki-oss`) with
stubs on `PATH`, and the fish wrapper resolves `bin/maki-oss` inside the
repo. Neither cares how the file is structured internally.

## Goals / Non-Goals

**Goals:**

- A core that a second front-end can source with no edits to the core.
- `maki-oss` stays byte-identical in observable behavior.

**Non-Goals:**

- Any OpenCode behavior, or `bin/opencode-oss`. Both belong to
  `add-opencode-oss-helper`.
- Renaming or rewording anything users see, or restructuring the tests.
- Making the bridge mode generic. It stays Maki-only.

## Decisions

### D1. Sourced library, front-end first

`bin/maki-oss` keeps its shebang, `set -eu`, and repo-root resolution. It
runs these steps in order:

1. Set the identity and default variables.
2. Define the hook functions.
3. Source the core:

   ```sh
   # shellcheck source=../lib/oss-core.sh
   . "$repo_root/lib/oss-core.sh"
   ```

4. Call `oss_main "$@"`.

The core defines functions and the shared state variables only. It runs
nothing when sourced.

- *Why sourcing, not a dispatcher binary:* this keeps one process, so
  traps, `exit` codes, and `set -eu` behave exactly as today. The front-end
  also stays the program users see in `ps` and in re-exec.
- *Alternative:* one script dispatching on `basename "$0"`. Rejected,
  because both products would always ship each other's code paths, and the
  user asked for specialized products.

### D2. Identity and defaults are front-end variables

The core reads these variables and never hard-codes them. `maki-oss` sets
today's values.

| Variable | maki-oss value |
|---|---|
| `PROGRAM` | `maki-oss` |
| `OSS_ENV_PREFIX` | `MAKI_OSS` |
| `OSS_CONFIG_NAME` | `maki-oss` (→ `$XDG_CONFIG_HOME/maki-oss/config.toml`) |
| `OSS_STATE_NAME` | `.maki-oss` (sandbox and host sync state) |
| `OSS_TMP_PREFIX` | `maki-oss` (`/tmp/maki-oss-stop`, temp files) |
| `DEFAULT_IMAGE` | `maki-agent:local` |
| `DEFAULT_POLICY` | `$repo_root/examples/policies/maki-minimal.yaml` |
| `DEFAULT_NAME` | `maki-{project}` |
| `OSS_PROFILES_DIR` | `$repo_root/examples/providers` |
| `OSS_CATALOG_FILE` | `$OSS_PROFILES_DIR/catalog.tsv` |
| `OSS_CUSTOM_PROFILE_PREFIX` | `maki-` |
| `OSS_CONFIG_EXAMPLE` | `examples/config.toml` (named in a generated config header) |
| `OSS_AGENT_NAME` | `Maki` (generated custom-profile description) |
| `OSS_AGENT_PROCESS` | `maki` (the in-sandbox process the idle stop waits on) |

`OSS_CONFIG_NAME` also names the host state directory
(`$XDG_STATE_HOME/maki-oss/sessions`). `PROGRAM` names the sync identity:
the `refs/maki-oss/*` refs, the git author, and the review branch prefix.
The front-end sets all of these before sourcing the core, because the core
splices them into its sandbox-side scripts at source time.

Env lookups such as `${MAKI_OSS_IMAGE:-}` become one helper,
`env_setting IMAGE`. It reads `${OSS_ENV_PREFIX}_IMAGE` through `eval`, and
the variable name is built only from the constant prefix and a literal key,
never from user input. Messages that name an env var interpolate the
prefix, so the text stays identical for `maki-oss`.

### D3. Agent hooks are functions the front-end must define

The core calls these hooks. `maki-oss` implements them by moving today's
code verbatim.

| Hook | Contract | maki-oss implementation |
|---|---|---|
| `agent_usage` | print the full `--help` text | today's `usage` |
| `agent_interactive_argv` | set `"$@"` to the in-sandbox argv for an interactive session, from the resolved model and session options | `maki [--model M] [--continue] [--resume ID] [--session-id ID]` |
| `agent_headless_argv PROMPT` | set `"$@"` for a headless run | `maki --print --yolo --trust --output-format json …` |
| `agent_exec_stdin` | `tty` or `null`: how the core wires exec stdin for a headless run | `tty` (today's behavior: inherited) |
| `agent_check_session_flags MODE` | reject unsupported session-flag combinations before any sandbox work | bridge-mode refusal, then the bridge session |
| `agent_dispatch CMD ARGS` | handle agent-only commands; report any other CMD as unknown | `maki`, `image`, `mcp`, `fish` |
| `agent_parse_option OPT [VAL]` | consume agent-only options; return 1 when it does not handle OPT | `--maki-version` |
| `agent_doctor_extra` | extra doctor sections after the common checks | MCP readiness table |
| `agent_setup_hint PROFILE` | text printed after a successful provider setup | `providers.toml` hint |

Implementation notes on the contracts:

- The argv hooks cannot set the caller's `"$@"`. They add words with the
  core's `argv_add WORD...` instead, which single-quotes each word into
  `agent_argv` by parameter expansion alone. The core then runs
  `eval "set -- $agent_argv"`.
- `agent_check_session_flags` takes the mode (`interactive` or
  `headless`). In OpenCode TUI mode, Maki's hook also hands the session
  to the bridge, which exits. This keeps today's check order: `idle_stop`
  first, then `tui`, then the flags.
- `agent_dispatch` reports an unknown command itself, with
  `die_usage "unknown command: CMD"`, instead of returning 1. A call inside
  `if` or `||` would turn `set -e` off for every agent command.
- `agent_parse_option` returns 1 for an option it does not handle. It sets
  `agent_opt_values` to the number of values it consumed.

Session commands (`cmd_session` for interactive, `cmd_run` for headless)
move into the core. The core owns the ensure routine, sync arming, traps,
the interrupt-to-130 mapping, and the timeout wrapper. The front-end owns
only the argv. `cmd_maki` becomes the Maki front-end's mapping of the
`maki` command and bare invocation onto `cmd_session`, after the bridge
check.

### D4. Self re-exec uses the front-end path

The idle watcher already re-execs `"$script_dir/${script##*/}"
__idle-watch`, using the script path that `$0` resolves to. Because the
core is sourced, `$0` is still the front-end, so this works unchanged.
`__idle-watch` dispatch moves into the core.

### D5. Move verbatim, then parameterize, in small commits

1. Create `lib/oss-core.sh` by moving functions verbatim.
2. Replace the hard-coded values with the D2 variables.
3. Split the agent code into the D3 hooks.

Run the full suite after each step. Do not reword, reorder, or "clean up"
anything in this change, so the diff stays a move plus substitutions.

### D6. Equivalence checks beyond the suite

The suite asserts outputs and exit codes, but it does not cover every
string. Add these checks:

- `maki-oss --help`, `maki-oss help`, and the usage error text: byte-diff
  before and after.
- `grep` the core for leftover literals (`maki`, `MAKI_OSS`, `.maki-oss`,
  `examples/`). The only hits allowed are comments and the `maki`
  credential store of provider setup. That store is a host credential
  source, like the `opencode` store, so it stays in the core.
- `make lint`, with shellcheck run on both files and
  `# shellcheck source=` so it follows the sourced file.
- One live smoke test on the real gateway: `maki-oss run "reply OK"` and
  `maki-oss status`.

## Risks / Trade-offs

- [`set -eu` and `local`-free POSIX code rely on global variable names, so a
  hook could clobber a core variable] → Hooks use a prefix (`ag_`) for
  their temporaries. The verbatim move keeps the existing names, which are
  already prefixed per function.
- [A user installed a copy of `bin/maki-oss` outside the repo] → That never
  worked: the script already needs `$repo_root/examples/` and `bridge/`.
  The doc note states that `lib/` is now required too.
- [Shellcheck cannot follow a dynamic source path] → Use the
  `# shellcheck source=` directive, and lint `lib/oss-core.sh` directly.
- [A larger function stays in the front-end by mistake] → The
  leftover-literal grep and the hook table make this visible. Anything the
  OpenCode front-end would have to copy is a missed extraction.

## Migration Plan

This change ships alone and is reverted by reverting its commits. No user
config, state directory, or env var changes. `add-opencode-oss-helper`
starts only after this change is merged.
