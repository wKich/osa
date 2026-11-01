## MODIFIED Requirements

### Requirement: Shell preparation with one verified path per shell

The shared host playbook SHALL add the repository's `bin/` to `PATH` and verify
the shared command with `command -v osa` in a POSIX shell. The Maki playbook
SHALL cover shell preparation for both zsh and fish, choosing exactly one
primary path per shell (repository `bin/` on `PATH`, or the fish plugin through
fisher, or `maki-oss fish install`), and SHALL document `MAKI_OSS_BIN` as the
fallback when the repository location must be discovered explicitly. Every
documented path SHALL be runnable on the bare host the playbook targets: a fish
path that depends on a plugin manager SHALL be presented only as an
alternative, the primary fish path SHALL be runnable from the repository root
before anything is on `PATH` or in the fish function directory, and each
shell's verification commands SHALL be labeled so they run only in that shell.

Because every front-end command is a shim over a built binary, each shell's
verification SHALL confirm that the command actually runs, not only that it
resolves: `command -v` and `type -q` SHALL be followed by a check that the
command executes the built binary and exits zero. The playbook SHALL state that
a resolvable shim over a missing binary fails with a message naming the build
command.

#### Scenario: Shared path resolves the shared command

- **WHEN** an agent completes the shared repository step and runs
  `command -v osa`
- **THEN** the command resolves to this repository's `bin/osa`

#### Scenario: Maki fish path resolves the helper

- **WHEN** an agent completes the Maki playbook's fish section and runs
  `type -q maki-oss`
- **THEN** the command resolves to this repository's `bin/maki-oss`

#### Scenario: Maki fallback is documented

- **WHEN** neither the `PATH` entry nor the fish function can locate the Maki
  helper
- **THEN** the Maki playbook states that setting `MAKI_OSS_BIN` to the
  absolute path of `bin/maki-oss` makes the wrapper resolve it

#### Scenario: Maki fish path runs before the helper is resolvable

- **WHEN** an agent with no fisher, no `maki-oss` on `PATH`, and no installed
  fish function follows the Maki playbook's fish section from the repository
  root
- **THEN** `./bin/maki-oss fish install` runs from the repository's files and
  succeeds without a prior shell-preparation step

#### Scenario: Per-shell verification stays in its shell

- **WHEN** an agent runs the Maki playbook's POSIX verification block
- **THEN** no fish-only command (such as `type -q` or a check of
  `~/.config/fish/…`) appears in the commands it is expected to run, and the
  fish-only checks are labeled and grouped so they run only in fish

#### Scenario: Shared page stays shell-neutral

- **WHEN** `docs/ai/host-playbook.md` is read for shell integration
- **THEN** it names only the shared `bin/` on `PATH` step and points to the
  shared `docs/helper.md` Fish setup section or the agent playbook for fish
  integration and agent-specific fallback variables, with no
  `maki-oss fish install` or `MAKI_OSS_BIN` command

#### Scenario: A shim is verified by running it

- **WHEN** an agent completes a front-end command's verification step
- **THEN** the step runs the command itself and observes a zero exit status, not only a successful resolution

#### Scenario: An unbuilt checkout is diagnosed
- **WHEN** the binary behind a shim is absent and the verification command runs
- **THEN** the command exits non-zero with a message naming the build command
