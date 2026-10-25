# Proposal: extract-oss-core

## Why

`opencode-oss` needs full helper parity with `maki-oss`: lifecycle, safe
patch sync, policy review, provider setup, doctor, and run timeouts. About
95% of `bin/maki-oss` (3.9k lines, 128 functions) is agent-neutral. Only
about 41 lines name Maki, and the rest of the coupling sits in a few
seams: identity, defaults, launch argv, MCP status, image build, and the
bridge mode.

A second 3.9k-line copy would mean every sync, policy, or provider fix has
to land twice and would drift. Extracting the shared core first, as its own
change with no behavior change, gives `add-opencode-oss-helper` a stable
base. It also keeps this refactor reviewable and revertible on its own.

This supersedes the earlier "do not refactor maki-oss" decision from
`add-opencode-oss` (archived). That decision fitted an image-and-guide-only
subproject. It does not fit helper parity.

## What Changes

- Move the agent-neutral helper code into `lib/oss-core.sh`, a POSIX sh
  library sourced from `$repo_root`. This covers:
  - output helpers and exit codes
  - config and env resolution
  - OpenShell wrappers and safety checks
  - the session ensure routine, baseline, and patch sync
  - idle stop and the run-timeout wrapper
  - upload/download, status/list/logs/start/stop/rm
  - policy show/edit/apply/review/approve/reject
  - provider add/attach/list and the provider-setup engine
  - doctor's common checks
  - argument parsing and dispatch of the common commands
- Turn `bin/maki-oss` into a thin Maki front-end. It sets the identity and
  defaults, defines the agent hooks (interactive and headless argv, session
  flags, MCP status, image build, usage, post-setup hints), keeps the
  Maki-only commands (`maki`, the `tui = "opencode"` bridge mode,
  `mcp status`, `image build`, `fish`), and hands over to the core.
- Make the hard-coded Maki values in the core come from the front-end: the
  `MAKI_OSS_` env prefix, the config path, the `.maki-oss` state directory,
  the `/tmp/maki-oss-*` paths, the profiles directory and catalog file, and
  the sandbox-name default. `maki-oss` sets them to today's values.
- **No behavior change.** Every command, flag, message, exit code, default,
  file path, and env var of `maki-oss` stays byte-identical. The proof is
  that the existing 128-test stub suite passes with zero test edits, and
  `make lint` passes on both files.
- **Not in this change:** `bin/opencode-oss`, any OpenCode behavior, and
  doc changes beyond a short "code layout" note in `docs/helper.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a pure refactor (`skip_specs: true`): the `helper-cli`
requirements describe observable behavior, and none of them changes.

## Impact

- **Code:** `bin/maki-oss` shrinks to a front-end, and the new
  `lib/oss-core.sh` holds the core. `lib/` is a new top-level directory.
- **Install:** no change. `bin/maki-oss` already resolves `$repo_root` at
  startup and loads repo files from it (`examples/policies`,
  `examples/providers`, `bridge/`). The fish wrapper and PATH installs
  resolve `bin/maki-oss` inside the repo as before.
- **Tests and lint:** `tests/run-tests.sh` is unchanged. The `make lint`
  shellcheck target gains `lib/oss-core.sh`.
- **Risk:** a regression in a just-landed helper. This is mitigated by the
  unchanged suite, a before/after `--help` and usage diff, and one live
  `maki-oss run` smoke test.
