# Design

## Context

See `proposal.md` for motivation. The pieces that constrain this design:

- `lib/oss-core.sh` already implements the caller-mode run plumbing:
  `run_split_words` separates a `--` tail, `run_read_stdin_prompt` captures a
  piped prompt into a private file before any gateway call, and `cmd_run`
  chooses `prompt`, `null`, or inherited stdin for the exec. Both behaviours
  activate only when the front-end defines `agent_stdin_prompt` or
  `agent_passthrough_check`; `bin/claude-oss` defines them, `bin/maki-oss` does
  not.
- `maki-oss run` currently builds `maki --print --yolo --trust
  --output-format json <prompt>` and keeps the inherited stdin.
- The sandbox image sets `always_yolo = true`, so every Maki session is in YOLO
  regardless of CLI flags. Deny rules still block before YOLO.
- Maki v0.6.5 documents one-shot `--print` as Claude Code compatible: same JSON
  fields, same `--output-format` options, same `--verbose` behavior, and stdin
  prompts (`echo "..." | maki -p`). It also documents `--output-format
  stream-json`, `--allowed-tools`, `--disallowed-tools`, and `--fork-session`
  in that path. `--permission-mode` is listed for the SDK (`--input-format
  stream-json`) path only; one-shot `--print` always runs in build mode
  (<https://maki.sh/docs/headless/>, <https://maki.sh/docs/cli/>,
  <https://maki.sh/docs/permissions/>).
- Maki's permission flow is deny, allow, YOLO, prompt. An allow rule cannot
  narrow what YOLO admits, while a deny rule blocks even in YOLO.

## Goals / Non-Goals

**Goals:**

- A caller can run `up`, `sync-in`, `run`, `collect-patch`, and `rm` against
  `maki-oss` with only stdout, exit codes, and `--json` results.
- Maki's stdout is a stream Conveyor's Claude parser can consume without an
  osa-specific format.
- The prompt never enters argv, and role denials reach Maki as session deny
  rules.

**Non-Goals:**

- Any Conveyor-side host or launcher code.
- Changing `sync-in` or `collect-patch`; their spec already covers all helpers.
- Turning YOLO off. The image cannot, and M1 needs the developer pass.
- Per-command git denial. Maki's CLI deny list takes tool names, not bash
  command patterns, and M1's human-commit boundary is already kept on the host
  because `collect-patch` only returns a patch.
- Read-only role enforcement. M2 must prove a reviewer returns an empty patch;
  tool-level denies alone are not sufficient against writes through Bash.

## Decisions

### Stream-json everywhere, matching `claude-oss`

`maki-oss run` always passes `--output-format stream-json --verbose` and
streams stdout unchanged. Maki's SDK-shaped events (`system`, `assistant`,
`stream_event`, `result`) are the same shape the bridge already consumes and
that Conveyor's `ClaudeStreamParser` expects.

- **Alternative: stream only in caller mode.** It preserves the current single
  object for managed users, but makes `run`'s output depend on workspace mode
  and leaves two contracts to test and document.
- **Alternative: a new opt-in flag.** It forces Conveyor to know an osa flag
  and breaks the drop-in agent-host abstraction.
- oskhs is unaffected: it looks for the last `type: "result"` line, which
  stream-json still emits.

### Reuse the core stdin and split hooks

Add `agent_stdin_prompt` (a no-op marker) and `agent_passthrough_check` to
`bin/maki-oss`, plus `agent_exec_stdin` returning `null`. No core change is
expected: the claude front-end proves the hooks and the prompt-file relay.

- The prompt is read into a mode-700 temp file and piped to the exec, so a
  2 MiB Conveyor Context Pack never hits argv limits or process listings.
- A run with a prompt argument closes stdin, so it cannot wait on inherited
  input.
- **Alternative: prompt as an uploaded file** is the fallback if the exec relay
  proves unreliable across OpenShell versions; the core already provides the
  pipe path and claude verified it live.

### Maki-native flags only, deny-only

The `--` allowlist is `--disallowed-tools` (one value) and `--fork-session`
(no value). `--allowed-tools` is refused: with the fixed `--yolo`, an allow
list does not restrict anything, so accepting it would advertise a boundary
that does not exist. `--permission-mode` is refused because one-shot Maki does
not implement it and may accept it with a warning; forwarding it would silently
drop a role rule.

- Maki's deny rules are session rules and are checked before YOLO, so
  `--disallowed-tools Write,Edit` is effective even though `--yolo` is fixed.
- The allowlist stays small so a caller cannot point Maki at config or change
  the stream format.
- **Alternative: translate Claude's `--allowedTools`/`--disallowedTools` to
  Maki's hyphenated flags.** It couples the helper to one caller's role
  vocabulary; Conveyor's Maki host can emit Maki's native names directly.
  The old `claude-oss` pass-through stays unchanged for its own callers.

### Keep `--yolo` and `--trust` fixed

Both stay in every headless argv. `--yolo` is what makes an unattended pass
possible; `--trust` loads the synced project's `.maki` config without a prompt.
The image's `always_yolo = true` would apply anyway.

- M1's developer role applies edits without in-sandbox prompts. The human
  commit boundary is preserved because the sandbox never sees a git repository
  and the caller applies the patch on the host.
- M2 must enforce read-only roles with deny rules plus a filesystem or
  patch-emptiness check; it cannot rely on removing `--yolo`.

## Risks / Trade-offs

- **Maki's one-shot stream-json may differ from Claude Code in an edge event** →
  Run the live caller sequence with a real stream and compare event types with
  Conveyor's parser; adjust on the Conveyor side or here before M1 is called
  done.
- **The global output change breaks scripts expecting one JSON object** →
  Called out as breaking; `docs/helper.md` and the Maki reference are updated,
  and oskhs is verified against the result-line parser.
- **`--allowed-tools` is refused and a caller expects it** → The usage error
  names the flag; the caller uses `--disallowed-tools`, which is the only
  effective under-YOLO control. Documented in the helper and reference.
- **Pass-through flags could smuggle configuration** → The allowlist is two
  flags, checked before any gateway call; unknown flags fail closed.
- **A project `.maki` config arrives through `sync-in` and is trusted** → It is
  loaded only because of `--trust`, its deny rules always apply, and its allow
  lists cannot widen beyond global deny. The sandbox remains the boundary.
- **The exec relay may buffer a very large stdin differently** → Test a 2 MiB
  prompt through the same path claude uses; fall back to an uploaded prompt
  file if it fails.

## Migration Plan

1. Land the helper and tests together; the headless output change is the only
   user-visible break.
2. Update the helper, Maki reference, and playbook in the same change.
3. Verify a live caller pass on macOS, then record the event shape and the
   patch round trip in the change notes for the Conveyor Maki host.
4. Rollback is the previous helper commit; no sandbox or image change is
   involved, so existing sandboxes keep working.

## Open Questions

- Whether Conveyor's Maki host should send any `--disallowed-tools` for the
  developer role in M1. That is a Conveyor-side role decision; the helper
  contract is the same either way.
- Whether M2 needs per-command git denial. If it does, the answer is a
  project-scoped `permissions.toml` generated by the caller, not a wider CLI
  pass-through.
