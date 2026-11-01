# Tasks

## 1. Shared front-end skeleton

- [x] 1.1 Extend the existing `osa-core/crates/osa-core/src/agent/` module (its `profile.rs`, `config.rs`, `cli.rs`, `usage.rs`, and `usage/*.txt` files are already in place) with the `AgentProfile` type (tag, env prefix, config path, agent command, base image, owned config keys) and one constant per front-end; verify a unit test prints each profile and that no two share a config path
- [x] 1.2 Add the four `[[bin]]` targets sharing the library, with dispatch that handles `__idle-watch` before profile dispatch; verify `cargo build --release` produces all four names
- [x] 1.3 Reconcile the existing `bin/maki-oss`-style shims and their `OSA_FRONTEND_IMPL`/`OSA_FRONTEND_BIN` switch with the conformance harness's `OSA_BACKEND_*` selection so one mechanism chooses the backend, with the shell implementation under `lib/frontends/` still the default; verify the suite passes unchanged in its default run and in `OSA_BACKEND_*` mode
- [x] 1.4 Port the usage text and error exit codes per front-end; verify cases "help prints usage", "usage errors exit 1", "opencode-oss help lists the shared commands and no Maki-only ones", "claude-oss help lists the shared commands and no Maki, OpenCode, or fish ones", and "codex-oss help lists the shared commands and no Maki, OpenCode, Claude, or fish ones"

## 2. Settings and naming

- [x] 2.1 Port settings precedence and config loading with the per-front-end owned-key check; verify cases "configuration precedence: flag > env > config > default" and "unknown config key names file and key"
- [x] 2.2 Port sandbox naming, sanitization, the 19-character limit, and explicit-name validation; verify cases "sandbox names are sanitized and fit OpenShell's 19-character limit" and "invalid explicit sandbox names fail before contacting the gateway"
- [x] 2.3 Port the workspace and caller-mode resolution; verify the caller-mode cases pass with no registry entry written
- [x] 2.4 Verify conformance parity (`transport-changed` or identical, state and output identical) for every case that reaches a settings-dependent invocation

## 3. Ensure, lifecycle, and status

- [x] 3.1 Port the idempotent ensure pipeline (create, start, attach providers with `--wait`, enable the policy advisor) and its ordering; verify cases "first up creates maki-<project> with image, policy, providers", "up is idempotent: starts instead of recreating", "stopped sandbox is started instead of recreated", and "missing remembered provider is attached with --wait before exec"
- [x] 3.2 Port `up`, `status`, `start`, `stop`, `logs`, `list`, `rm`, and the create-race reuse path; verify cases "status, list, and logs report and delegate", "start and stop delegate to the gateway", "rm requires --yes when stdin is not a TTY", "losing a create race reuses the winner's sandbox", and "a session records the sandbox ID and status reads it back"
- [x] 3.3 Port the no-provider refusal and TTY bootstrap; verify cases "no provider refuses before any gateway mutation", "no provider on a TTY bootstraps through the wizard and continues", and "remembered provider missing from the gateway fails before create"
- [x] 3.4 Port provider listing without `jq`; verify cases "sandbox parsing works without jq" and "status lists every attached provider without jq" with `jq` absent from `PATH`

## 4. Upload, download, and environment guards

- [x] 4.1 Port `upload` and `download` through the gateway operations with no mount; verify cases "upload delegates and never mounts" and "download delegates to the gateway with an explicit destination"
- [x] 4.2 Port the credential-like key guard, `--allow-env`, and `--env-from` checks; verify cases "--env refuses credential-like keys", "--allow-env overrides the refusal for one key", "segment matching avoids TOKENIZERS-style false positives", "--env fails on the session path", "--env-from refuses credential-like names and names the flag", "--env-from refuses a credential-shaped source behind a neutral name", and "--allow-env overrides the --env-from refusal for one key"
- [x] 4.3 Verify the conformance leak case still passes for all four front-ends, and that no fixture value appears in an invocation, request, state file, or output

## 5. Sync, baseline, and fingerprint

- [x] 5.1 Port sync classification (clean, behind, retained, parked) and the pending-marker derivation; verify cases "a pending marker with a patch and no kind becomes retained and non-blocking", "a pending marker without a patch or kind stays parked", "a parked workspace refuses to launch Maki", "a parked workspace blocks a later session until it is discarded", and "a retained patch does not block a later session"
- [x] 5.2 Port the host fingerprint and baseline recording (git and non-git, without touching the index); verify cases "clean git baseline records branch, commit, and tree without touching the repo", "dirty git baseline uses a synthetic commit and leaves the index alone", "sandbox baseline is recorded after upload and keeps git out of the workdir", and "session state is owner-only and a second session reuses the baseline"
- [x] 5.3 Port reuse, staleness, and refresh; verify cases "a filtered host tree and its raw uploaded tree are not stale after upload", "a reused sandbox without a baseline adopts a matching workspace and warns once", and "a host change refreshes a reused workspace before Maki runs"
- [x] 5.4 Verify the state files written by the binaries are byte-identical to the conformance goldens for the flat TOML format

## 6. Run, streaming, and patch

- [x] 6.1 Port `run` with streamed shell passthrough, stdin prompt relay, the pass-through allowlist, and session flags; verify cases "run streams stdout and propagates exit codes", "maki-oss run launches maki stream-json with the model and prompt", "maki-oss run with no prompt argument, or -, relays stdin as the prompt", "maki-oss run relays a 2 MiB stdin prompt byte for byte, never in argv", "maki-oss run combines a stdin prompt with tool flags after --", "maki-oss run forwards deny and fork flags after -- before the prompt", and "maki-oss run refuses pass-through flags outside the allowlist before any gateway call"
- [x] 6.2 Port `--timeout` around the sandbox exec; verify cases "maki-oss run --timeout hands a stdin prompt to maki and still ends it with 124" and "run --timeout wraps Maki in an in-sandbox timeout"
- [x] 6.3 Port patch collection (temp worktree, renames, mode bits, symlinks, binary, deletions, large-patch-to-file); verify cases "patch carries edits, deletes, renames, mode, symlink, and binary without .git", "a large patch is written to a file, never carried through a shell value", and "SIGINT still collects the sandbox patch"
- [x] 6.4 Port patch apply for git and non-git hosts, including conflict and line-ending safety; verify cases "a clean patch applies to a plain project and preserves host-only files", "a conflicting plain patch leaves every host file unchanged", "clean git baseline applies in a worktree and fast-forwards, then cleans up", "line-ending attributes either apply cleanly or fail safely", "a moved or dirty host keeps the result branch and never merges", "without git, a text patch applies with patch and preserves unrelated files", and "without git or patch, a text change fails closed and writes nothing"
- [x] 6.5 Verify "run stdout is exactly Maki's output and sync failures keep its code" and "collection failure warns on stderr and keeps Maki's exit code"

## 7. Per-agent command behavior

- [x] 7.1 Port the OpenCode profile and commands; verify cases "opencode-oss run launches opencode run --standalone --auto with stdin closed", "bare opencode-oss attaches opencode --standalone with the model overlay", "opencode-oss maps --resume and --session-id to --session", "OpenCode mode: ensure, bridge start, TUI attach, bridge kill, sync", and "tui config key: unset keeps the Maki TUI, opencode bridges, env overrides the file, other values fail"
- [x] 7.2 Port the Claude profile and commands, including the host-only setup-token path and the permission-bypass refusal; verify cases "claude-oss run launches claude -p stream-json with bypass and stdin closed", "claude-oss run forwards role flags after -- and drops the permission bypass", "claude-oss run refuses --permission-mode bypassPermissions", and "bare claude-oss runs the key approval step, then claude with the model"
- [x] 7.3 Port the Codex profile and commands, including the host-only login and refresh configuration; verify cases "codex-oss run launches codex exec --json with bypass, the account ID, and stdin closed", "codex-oss maps --continue and --resume to codex resume and refuses --session-id", and "the codex login stub writes a ChatGPT login, fails, or interrupts its caller"
- [x] 7.4 Verify front-end isolation from each other; verify cases "opencode-oss and maki-oss keep separate sandboxes, config, env, and state", "claude-oss keeps its own sandbox, config, and state, and registers as cc", and "codex-oss keeps its own sandbox, config, and state, and registers as cx"
- [x] 7.5 Port per-agent image build; verify cases "image build passes MAKI_VERSION and tags the image", "opencode-oss image build builds opencode-oss/image as opencode-agent:local", "claude-oss image build builds claude-oss/image as claude-agent:local", and "codex-oss image build builds codex-oss/image as codex-agent:local"

## 8. Provider wizard and credentials

- [x] 8.1 Port the credential-source discovery (Maki, OpenCode, Claude, Codex stores, JSON file path, environment variable, hidden prompt) with values never in argv or generated files; verify cases "store scanner lists store, slug, and auth type without values", "generic JSON file source reads the given field", "environment variable source is used without stdin", "hidden prompt source reads a value without echoing it", and "credential values never reach argv, output, or generated files"
- [x] 8.2 Port catalog resolution, custom profile generation and lint, and the update-not-duplicate path; verify cases "provider setup resolves a stored key through the catalog", "unknown store slug generates, lints, and imports a custom profile", "declining overwrite preserves the generated profile", "profile lint failure aborts before import", and "existing provider is updated, not duplicated"
- [x] 8.3 Port the OAuth refusal, the non-TTY refusal, and provider attach; verify cases "OAuth store credentials are refused without gateway changes", "selecting an OAuth-listed credential exits non-zero", "non-TTY setup without flags makes no gateway calls", and "provider setup attaches to the project sandbox with --wait"
- [x] 8.4 Port the per-agent provider mappings; verify cases "opencode-oss provider setup maps an OpenCode store key to its opencode-* profile", "claude-oss provider setup maps a stored Anthropic key to claude-anthropic", "claude-oss provider setup takes a setup-token from the host env, never the host login", and "codex-oss provider setup logs in on the host and configures gateway refresh"

## 9. Doctor, MCP status, and policy

- [x] 9.1 Port `doctor`'s prerequisite checks and ordering; verify cases "doctor reports a missing openshell CLI first", "doctor fails when the gateway is unreachable", "doctor passes with all prerequisites present", and "doctor prints an MCP failure but still exits 0"
- [x] 9.2 Port `mcp status` and its per-agent config comparison; verify cases "mcp status reports every gate satisfied and exits 0", "mcp status names the failing gate and its fix, and exits non-zero", "mcp status judges a stdio server by its runtime gate and exits 0", "mcp status names a host-only server with the environment-image guidance", and the per-agent `mcp status` cases
- [x] 9.3 Port `policy show`, `policy review`, `policy approve`, and `policy reject`; verify cases "policy review reports an empty inbox and exits zero", "policy review passes through pending chunk text", "policy approve --yes approves exactly one chunk id", "policy reject forwards the reason to the agent", and "policy show, edit, and apply wrap the openshell commands"
- [x] 9.4 Port the session-end policy note; verify cases "session exit surfaces pending network-rule proposals", "exit prints no policy note when nothing is pending", "interrupted session still surfaces pending proposals", and "an unavailable rule command never masks Maki's exit code"

## 10. Idle stop, signals, and cleanup

- [x] 10.1 Port the config resolution for `idle_stop`; verify case "idle_stop resolves to seconds, 0 disables it, and bad values are usage errors"
- [x] 10.2 Port the detached `__idle-watch NAME PID SECS` watcher with null streams and an independent lifetime; verify cases "the sandbox stops once the idle period passes after the last session", "a session killed by SIGHUP still arms the idle stop", "a newer session cancels the pending stop until it closes", and "a running Maki inside the sandbox keeps it up"
- [x] 10.3 Verify the watcher's command line contains the helper name and `__idle-watch` so a `pkill -f` cleanup finds it, and that exactly one watcher exists per armed session
- [x] 10.4 Port signal handling with the cleanup guard and 130/143 exit codes; verify case "SIGINT during provider setup exits and cleans up" plus a new assertion that no temporary file, lock, or watcher remains
- [x] 10.5 Verify a failed idle stop is logged, silent on stdout, and not retried (case "a failed idle stop is logged, silent, and not retried")

## 11. Fish integration

- [x] 11.1 Port `fish install`, `fish uninstall`, completions, and the shared resolver; verify cases "fish install, idempotence, resolution, and uninstall", "both front-ends install twice and share one resolver", "fish uninstall leaves a foreign file at a managed path untouched", "fisher-style copy (not symlink) resolves via PATH", and "fish completions list subcommands and flags"

## 12. Flip, delete, and document

- [x] 12.1 Run the full front-end suite with every `OSA_BACKEND_*` set to the built binaries and verify zero failures and zero skips
- [x] 12.2 Run conformance parity over the full case set and verify every case reports identical or `transport-changed` with identical state and output, or carries an exclusion with a written reason
- [x] 12.3 Flip the four shims to the built binaries by default and verify `make test` and `make test-all` pass
- [x] 12.4 Delete `lib/oss-core.sh` and `lib/osa-state.sh`, and verify the repository has no reference to either file and no remaining second implementation of the registry format
- [x] 12.5 Update `docs/helper.md` (the command reference stays; the stack and implementation notes change) and the stack paragraph in `openspec/config.yaml`'s context, and verify every documented command still runs as written
- [x] 12.6 Update the host playbooks' verification steps to run each command, and verify a clean checkout builds, verifies, and passes `make test`
