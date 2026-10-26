# Tasks

## 1. Test harness

- [x] 1.1 In `tests/run-tests.sh`, pin the existing tests to their current names by exporting `MAKI_OSS_SANDBOX_NAME=maki-myproject` (and the OpenCode equivalent) in the shared runner, and point `XDG_STATE_HOME` at the test work dir. Leave the naming tests free to unset it. Verify with `make test` passing unchanged before any helper edit.
- [x] 1.2 Add test helpers that read a registry entry and a `pending` marker as data, plus a fixture for a project path containing spaces and quotes. Verify with a self-check test that runs under `make test`.

## 2. Shared state root

- [x] 2.1 Change state root resolution in `lib/oss-core.sh` (`session_state_dir` and the `state_base` setup) to `${XDG_STATE_HOME:-$HOME/.local/state}/osa/` for both front-ends, with session directories under `sessions/` and the registry under `projects/`. Verify with a new test that runs `maki-oss up` and `opencode-oss up` in one folder and asserts both write under `osa/` and nothing under `maki-oss/` or `opencode-oss/`.
- [x] 2.2 Add a test that plants a `pending` marker under the old `maki-oss/sessions/` root and asserts a session neither reads nor changes it. Verify with `make test`.

## 3. Flat TOML contract

- [x] 3.1 Generalize `parse_config_file` so callers pass a key allowlist, keeping the config file's current key set and error messages. Verify with the existing config tests (`Unknown config key fails loudly`) still passing.
- [x] 3.2 Add a flat TOML writer for the state files: quoted values with `\"` and `\\` escaping, atomic rename, mode 600. Verify with a round-trip test using the spaces-and-quotes fixture, read back by the helper and by `bun -e 'Bun.TOML.parse(...)'` when `bun` is present.
- [x] 3.3 Write and read `pending` as flat TOML with `version = "1"` and the fields in the spec (`kind`, `patch`, `sandbox`, `sandbox_id`, `created`, `reason`, `result_tree`). Verify with the existing retained/parked sync tests passing and a new assertion that a retained session leaves `kind = "retained"` with an existing `patch` path.

## 4. Sandbox naming

- [x] 4.1 Derive `{project}` from the `origin` remote's last path segment without `.git`, falling back to the folder name when there is no git, no repository, or no `origin`. Verify with tests for an SSH remote, an HTTPS remote, a repository without `origin`, and a plain folder named `My App`.
- [x] 4.2 Add the `{hash}` placeholder (the existing 4-hex `cksum` hash of the absolute physical path) and change the defaults to `mk-{project}-{hash}` in `bin/maki-oss` and `oc-{project}-{hash}` in `bin/opencode-oss`. Keep today's project-name hash suffix for user templates without `{hash}`. Verify by updating `test_sandbox_name_fit` and adding tests for the 19-character cap, two worktrees getting names that differ only in the hash, and a long name shortened to 11 project characters.
- [x] 4.3 Make a registered sandbox name win over the default, and refuse a name registered to a different host path before any gateway call, with an error that suggests `--name`. Verify with tests in which the stub log shows no gateway call on refusal and the registered name `maki-myproject` is reused.

## 5. Project registry

- [x] 5.1 Write `projects/<sandbox-name>.toml` on create with `version`, `agent`, `host_path`, `project`, `sandbox_name`, `sandbox_id`, and `created`, and update `sandbox_id` and `last_session` on each session. Verify with a test that asserts the fields after `maki-oss up` and after a session, and that no credential or `--env` value appears in the file.
- [x] 5.2 Remove the registry entry when `rm` deletes the sandbox, alongside the existing state archive. Keep the entry when `rm` is refused for a parked workspace. Verify with tests for both cases.

## 6. Host fingerprint

- [x] 6.1 Compute the fingerprint from `git rev-parse HEAD` plus a hash of `git status --porcelain` output, without hashing the tree, and record it in the registry at the first upload, each refresh, and each clean apply. Record nothing for a plain folder or when `git` is missing. Verify with tests showing that an unstaged edit changes it, no edit keeps it, a commit changes it, and a plain folder has no `fingerprint` key.

## 7. osa command

- [x] 7.1 Add `bin/osa`. It sources `lib/oss-core.sh` with no agent set and offers `projects`, `status`, and `help`; any other command is a usage error that lists them. Verify with a test for `osa up`, and with `make lint` (shellcheck) clean.
- [x] 7.2 Implement `osa projects [--json]` across all registry entries, adding `pending` (from each `pending` marker) and `orphan` (missing `host_path`). With `--json`, stdout holds only one array. Verify with tests for `mk` plus `oc` entries, an orphan, an empty registry printing `[]`, and the stdout output parsing as JSON with `jq` when present.
- [x] 7.3 Implement `osa status [PATH] [--json]` (full mode), one entry per agent registered for the absolute physical `PATH`, using each agent's front-end classification. Verify with tests in which `osa status --json` and `maki-oss status` agree on `behind`, `retained`, and `parked`, and an unregistered path prints `[]`.
- [x] 7.4 Implement `--quick`: pending kind from the files plus fingerprint `changed`, `unchanged`, or `unknown`, never `clean` or `behind`, and no tree hash. Verify with tests for a commit after sync (`changed`), no change (`unchanged`), and a plain folder (`unknown`), and with the stub log showing no upload or exec call.
- [x] 7.5 Assert that `osa` is read-only: run `osa projects` and both `osa status` modes against a stopped stub sandbox and check that the stub log has no create, start, stop, delete, upload, or exec call and that no file under the state root changes. Verify with `make test`.

## 8. Shell integration and docs

- [x] 8.1 Add `fish/completions/osa.fish` for `projects`, `status`, `help`, `--json`, and `--quick`, and add it to the `make lint` fish checks next to the `maki-oss` and `opencode-oss` files. Fisher picks it up from `fish/completions/`. The front-ends' symlink `fish install` keeps installing only its own files, and the docs say so. Verify with `make lint` and the existing fish tests.
- [x] 8.2 Update `docs/helper.md` (the state root, registry, default name rules, and the `osa` commands), `docs/opencode-oss.md` (the `oc-{project}-{hash}` default and shared state root), and `docs/glossary.md` (project layer, registry, fingerprint, state contract). Verify by checking that each `{project}`, `{hash}`, state path, and `osa` command in the docs matches `bin/osa help` and the spec examples.
- [x] 8.3 Document the flat TOML state contract (the files, keys, `version`, and the rule that only keys may be added) in `docs/helper.md`. Note that M1 clients rely on it. Verify that the documented keys match the fields asserted in tasks 3.3 and 5.1.
- [x] 8.4 Note in `README.md` that state moved to `$XDG_STATE_HOME/osa/` and the default name became `mk-{project}-{hash}`. Verify by reviewing the README diff.

## 9. Host migration (by hand, no code)

- [x] 9.1 Stop running sessions, then copy `$XDG_STATE_HOME/maki-oss/sessions/` and `$XDG_STATE_HOME/opencode-oss/sessions/` to `$XDG_STATE_HOME/osa/sessions/`. Verify by comparing the before and after directory listings and file counts.
- [x] 9.2 Rewrite each copied `pending` marker as flat TOML with `version = "1"`, pointing `patch` paths at the new root. Verify that every `patch` path exists.
- [x] 9.3 Write a registry entry for each existing sandbox with its current name, host path, and sandbox ID, then run the matching front-end's `status` in each project. Verify that the sync state matches what it reported before the move.
- [x] 9.4 Remove the old `maki-oss/` and `opencode-oss/` state roots after 9.3 passes, and record the migration in `docs/verification-log.md`. Verify that `osa projects` lists every migrated project.

## 10. Final verification

- [x] 10.1 Run `make test`, `make lint`, and `openspec validate add-oss-project-layer --strict`. Verify that all pass.
- [x] 10.2 Live pass against the real gateway: create a sandbox with the new default name in a scratch git repository, run a session that leaves a retained patch, and check `osa projects --json`, `osa status --json`, and `osa status --quick --json`. Then delete the sandbox and confirm the registry entry is gone. Record the results in `docs/verification-log.md`.
