# Spec Delta

## MODIFIED Requirements

### Requirement: Claude Code launch contract

- **Headless:** `claude-oss run "<prompt>"` SHALL execute
  `claude -p --output-format stream-json --verbose --dangerously-skip-permissions`,
  followed by the resolved `--model` and session flags and the prompt. Its
  stdin SHALL be closed, so the run cannot wait on input. It SHALL stream
  Claude Code's stdout unchanged and exit with Claude Code's exit code.
  With `--timeout`, it uses the same in-sandbox wrapper as `maki-oss`.
- **Headless, prompt on stdin:** when `claude-oss run` is given no prompt
  argument, or the prompt argument is `-`, the helper SHALL relay its own
  standard input to the in-sandbox `claude -p` as the prompt, and SHALL NOT
  place the prompt in any command argument. The rest of the headless contract
  stays the same. An empty stdin SHALL be a usage error before any gateway
  call.
- **Interactive:** bare `claude-oss` and `claude-oss claude` SHALL run the
  image's API key launcher step and then attach
  `claude --dangerously-skip-permissions` on a TTY, followed by the
  resolved `--model` and session flags.

The helper MUST NOT pass `--bare`, `--settings`, or a permission flag that
weakens the image's managed settings. The flags the caller passes through
(see "Caller permission pass-through") are the only exception to the fixed
headless argv.

#### Scenario: Headless argv
- **WHEN** a user runs `claude-oss run --model claude-sonnet-5-5 "reply OK"` against the test stub
- **THEN** the stub receives `-p --output-format stream-json --verbose --dangerously-skip-permissions --model claude-sonnet-5-5 "reply OK"` with stdin at end of file

#### Scenario: Prompt from stdin
- **WHEN** a user runs `printf 'reply OK' | claude-oss run --model claude-sonnet-5-5` against the test stub
- **THEN** the stub receives `-p --output-format stream-json --verbose --dangerously-skip-permissions --model claude-sonnet-5-5` with no prompt argument, and reads `reply OK` on stdin

#### Scenario: Large prompt from stdin
- **WHEN** a 2 MiB prompt is piped to `claude-oss run -`
- **THEN** the stub reads exactly those bytes on stdin, and no command argument recorded by the openshell stub contains the prompt

#### Scenario: Empty stdin refused
- **WHEN** `claude-oss run` gets no prompt argument and stdin is empty
- **THEN** it exits 1 before any gateway call

#### Scenario: Interactive argv
- **WHEN** a user runs `claude-oss --continue` against the test stub on a TTY
- **THEN** the sandbox exec runs the launcher step first, and the stub receives `--dangerously-skip-permissions --continue` and no `-p`

#### Scenario: Exit code passes through
- **WHEN** the in-sandbox `claude` exits 3
- **THEN** `claude-oss run` exits 3

## ADDED Requirements

### Requirement: Caller permission pass-through

`claude-oss run` SHALL accept Claude Code flags after a `--` separator, and
SHALL forward them to the in-sandbox `claude -p`, after the resolved model and
session flags and in the order given. Only these flags are allowed;
`--fork-session` takes no value, and each of the others takes exactly one:

- `--permission-mode`
- `--allowedTools`
- `--disallowedTools`
- `--add-dir`
- `--fork-session`
- `--effort`

Any other flag after `--`, a missing value, or `--permission-mode
bypassPermissions` SHALL be a usage error before any gateway call, and the
message SHALL name the rejected flag. When `--permission-mode`,
`--allowedTools`, or `--disallowedTools` is present, the helper SHALL omit
`--dangerously-skip-permissions` from the argv. Pass-through SHALL NOT be
accepted by bare `claude-oss` or by `claude-oss claude`.

#### Scenario: Role flags replace skip-permissions
- **WHEN** a caller runs `claude-oss run "do it" -- --permission-mode acceptEdits --disallowedTools "Bash(git commit:*)"` against the test stub
- **THEN** the stub receives `-p --output-format stream-json --verbose`, then `--permission-mode acceptEdits --disallowedTools "Bash(git commit:*)"`, then the prompt, and does not receive `--dangerously-skip-permissions`

#### Scenario: Non-permission flags keep skip-permissions
- **WHEN** a caller runs `claude-oss run "do it" -- --effort high`
- **THEN** the stub receives `--dangerously-skip-permissions` and `--effort high`

#### Scenario: Flag outside the allowlist
- **WHEN** a caller runs `claude-oss run "do it" -- --mcp-config /tmp/m.json`
- **THEN** it exits 1 naming `--mcp-config`, and the openshell stub records no call

#### Scenario: Bypass mode refused
- **WHEN** a caller runs `claude-oss run "do it" -- --permission-mode bypassPermissions`
- **THEN** it exits 1 naming `bypassPermissions`

#### Scenario: Output format cannot be overridden
- **WHEN** a caller runs `claude-oss run "do it" -- --output-format text`
- **THEN** it exits 1 naming `--output-format`
