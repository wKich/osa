# Spec Delta

## MODIFIED Requirements

### Requirement: Headless and interactive execution

`maki-oss run "<prompt>"` SHALL execute Maki headless with `--print --yolo --trust --output-format stream-json --verbose`, stream Maki's stdout unchanged, and exit with Maki's exit code. `maki-oss run` SHALL accept `--model <provider/model>` and pass it to Maki as its model selection.

When `maki-oss run` is given no prompt argument, or the prompt argument is `-`, the helper SHALL relay its own standard input to the in-sandbox `maki --print` as the prompt, and SHALL NOT place the prompt in any command argument. An empty stdin SHALL be a usage error before any gateway call.

`maki-oss run` SHALL accept Maki's tool flags after a `--` separator and SHALL forward them to the in-sandbox `maki --print`, after the resolved model and session flags and in the order given. Only these flags are allowed:

- `--disallowed-tools`, with exactly one value;
- `--fork-session`, which takes no value.

Any other flag after `--`, or a missing value, SHALL be a usage error before any gateway call, and the message SHALL name the rejected flag. Pass-through SHALL NOT be accepted by bare `maki-oss` or by `maki-oss maki`.

`maki-oss maki` SHALL attach an interactive TTY session running Maki in the sandbox workspace. When the `tui` setting resolves to `opencode` (config key or `MAKI_OSS_TUI`), bare `maki-oss` and `maki-oss maki` SHALL instead run the OpenCode TUI against the local `opencode-tui-bridge`, which drives Maki in the same project sandbox; this mode SHALL share the same ensure routine, model setting, and exit sync as the Maki TUI session, and the session flags `--continue`, `--resume`, and `--session-id` SHALL be refused in this mode with a usage error that names it (bridge session resume is not yet supported). Any other `tui` value SHALL be a non-zero usage error naming the key and the accepted values, and an unset `tui` SHALL keep the Maki TUI session unchanged. `maki-oss run` is unaffected by the `tui` setting.

#### Scenario: Headless JSON passthrough
- **WHEN** the user runs `maki-oss run "fix the tests"` and Maki exits 0
- **THEN** the sandbox exec runs `maki --print --yolo --trust --output-format stream-json --verbose "fix the tests"`, stdout carries Maki's stream-json event lines unchanged, and the helper exits 0

#### Scenario: Prompt from stdin
- **WHEN** a user runs `printf 'reply OK' | maki-oss run --model deepseek/deepseek-chat` against the test stub
- **THEN** the stub receives `--print --yolo --trust --output-format stream-json --verbose --model deepseek/deepseek-chat` with no prompt argument, and reads `reply OK` on stdin

#### Scenario: Large prompt from stdin
- **WHEN** a 2 MiB prompt is piped to `maki-oss run -`
- **THEN** the stub reads exactly those bytes on stdin, and no command argument recorded by the openshell stub contains the prompt

#### Scenario: Empty stdin refused
- **WHEN** `maki-oss run` gets no prompt argument and stdin is empty
- **THEN** it exits 1 before any gateway call

#### Scenario: Tool flags pass through after --
- **WHEN** a caller runs `maki-oss run "do it" -- --disallowed-tools Write,Edit --fork-session`
- **THEN** the sandbox exec runs `maki --print --yolo --trust --output-format stream-json --verbose`, then `--disallowed-tools Write,Edit --fork-session`, then `do it`

#### Scenario: Stdin prompt combines with tool flags
- **WHEN** a caller runs `printf 'do it' | maki-oss run -- --disallowed-tools Write,Edit`
- **THEN** the stub receives no prompt argument, reads `do it` on stdin, and receives `--disallowed-tools Write,Edit` after `--verbose`

#### Scenario: Permission mode is refused
- **WHEN** a caller runs `maki-oss run "do it" -- --permission-mode acceptEdits`
- **THEN** it exits 1 naming `--permission-mode`, and the openshell stub records no call

#### Scenario: Allow list is refused
- **WHEN** a caller runs `maki-oss run "do it" -- --allowed-tools Read,Bash`
- **THEN** it exits 1 naming `--allowed-tools`, and the openshell stub records no call

#### Scenario: Output format cannot be overridden
- **WHEN** a caller runs `maki-oss run "do it" -- --output-format json`
- **THEN** it exits 1 naming `--output-format`, and the openshell stub records no call

#### Scenario: Unknown flag is refused
- **WHEN** a caller runs `maki-oss run "do it" -- --mcp-config /tmp/m.json`
- **THEN** it exits 1 naming `--mcp-config`, and the openshell stub records no call

#### Scenario: Missing pass-through value is refused
- **WHEN** a caller runs `maki-oss run "do it" -- --disallowed-tools`
- **THEN** it exits 1 naming `--disallowed-tools`, and the openshell stub records no call

#### Scenario: Interactive mode takes no pass-through
- **WHEN** a user runs bare `maki-oss -- --disallowed-tools Write`
- **THEN** it exits 1 with a usage error, and no sandbox exec is recorded

#### Scenario: Non-zero Maki exit propagates
- **WHEN** Maki exits 1 in a headless run
- **THEN** the helper exits 1 without rewriting or swallowing Maki's output

#### Scenario: Model selection is passed through
- **WHEN** the user runs `maki-oss run --model opencode-go/deepseek-v4.1-flash "check"`
- **THEN** the sandbox exec invocation passes that model to Maki's `--model` option

#### Scenario: Default session stays the Maki TUI
- **WHEN** `tui` is unset and the user runs bare `maki-oss`
- **THEN** the helper attaches the interactive Maki TTY session exactly as before, and no bridge process is started

#### Scenario: OpenCode mode runs the TUI against the bridge
- **WHEN** `tui = "opencode"` is set and the user runs bare `maki-oss` in a Ready project sandbox
- **THEN** the helper starts the bridge bound to loopback, launches the OpenCode TUI pointed at it, and the bridge's Maki child runs inside the project sandbox workspace

#### Scenario: OpenCode mode keeps the shared lifecycle
- **WHEN** `tui = "opencode"` and the session ends (including Ctrl-C)
- **THEN** the bridge and TUI are torn down, the exit sync collects a patch as the Maki TUI session does, and no host-side bind mount or `--env` value was used

#### Scenario: Unknown tui value is refused
- **WHEN** the config file contains `tui = "vim"`
- **THEN** the interactive session exits non-zero with an error naming the `tui` key and the accepted values, and no sandbox exec is recorded

#### Scenario: Resume flags are refused in OpenCode mode
- **WHEN** `tui = "opencode"` and the user runs bare `maki-oss --continue`
- **THEN** the helper exits non-zero with an error stating that session resume is unsupported in OpenCode TUI mode, and no bridge or sandbox exec is started

### Requirement: Session resume flag pass-through

The helper SHALL accept `--continue`, `--resume <ID>`, and `--session-id <ID>` on bare `maki-oss`, `maki-oss maki`, and `maki-oss run "<prompt>"`, and SHALL forward them to the Maki process it execs inside the sandbox as Maki's `--continue`, `--resume <ID>`, and `--session-id <ID>` respectively. `--continue` together with `--resume` SHALL be a usage error (exit 1) that names both flags and MUST NOT launch Maki; `--session-id` SHALL be accepted alongside either of them. A missing or empty value for `--resume` or `--session-id` SHALL be a usage error. When the `tui` setting resolves to `opencode`, bare `maki-oss` and `maki-oss maki` SHALL refuse all three flags with a usage error that names OpenCode TUI mode and starts no bridge, while `maki-oss run` keeps them unchanged. On commands that do not launch Maki the flags SHALL be accepted and have no effect, exactly as `--model` behaves today. Passing resume flags SHALL NOT change what the helper syncs: the exit sync SHALL still collect only the sandbox workspace, never the sandbox's session or state directory, and the helper MUST NOT add any host-side session transcript storage.

#### Scenario: Interactive session resumes the most recent conversation
- **WHEN** the user runs `maki-oss maki --continue` against a `Ready` sandbox
- **THEN** the sandbox exec launches `maki` with `--continue` after it, and the session still syncs workspace changes back to the host on exit

#### Scenario: Headless run resumes a session by id
- **WHEN** the user runs `maki-oss run --resume CgADMGeR7WnHDw7NJRUfN "keep going"`
- **THEN** the sandbox exec launches `maki --print --yolo --trust --output-format stream-json --verbose --resume CgADMGeR7WnHDw7NJRUfN "keep going"` and stdout still carries only Maki's output

#### Scenario: Session flags are separated from the prompt
- **WHEN** the user runs `maki-oss run --continue "fix the tests"`
- **THEN** the prompt passed to Maki is exactly `fix the tests` and `--continue` appears only as an option, not inside the prompt

#### Scenario: Chosen session id is forwarded
- **WHEN** the user runs `maki-oss run --session-id ci-run-42 "start the migration"`
- **THEN** the sandbox exec passes `--session-id ci-run-42` to Maki and the exit sync behavior is unchanged

#### Scenario: Conflicting resume flags are refused
- **WHEN** the user runs `maki-oss maki --continue --resume CgADMGeR7WnHDw7NJRUfN`
- **THEN** the helper exits 1 with an error naming both flags and no sandbox exec is recorded

#### Scenario: Missing resume value is refused
- **WHEN** the user runs `maki-oss maki --resume` with no following argument, or passes an empty `--resume ""`
- **THEN** the helper exits 1 with a usage error that names `--resume` and launches no Maki process

#### Scenario: Flags on a non-session command have no effect
- **WHEN** the user runs `maki-oss status --continue`
- **THEN** the command runs as `status`, exits the way it would without the flag, and launches no Maki process

#### Scenario: Session state never crosses the boundary
- **WHEN** any session command with resume flags exits and the helper performs its sync
- **THEN** the patch source is the sandbox workspace only, and no session transcript is written to the project directory or to the helper's sync state by the helper

#### Scenario: Resume flags refused in OpenCode TUI mode
- **WHEN** `tui = "opencode"` and the user runs `maki-oss run --continue "keep going"`
- **THEN** the headless run resumes as usual, and the same flag on bare `maki-oss` exits 1 naming OpenCode TUI mode without starting a bridge
