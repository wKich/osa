# Tasks

## 1. Upgrade and capture the baseline

- [ ] 1.1 Record the current install before touching it — `openshell
      --version`, the gateway version from `openshell status`, and the
      compute driver version — into the new verification-log entry, and verify
      the recorded values match `docs/ai/references.md`'s current v0.1.4 claim
      so the rollback path is documented
- [ ] 1.2 Install v0.1.5 with the version-pinned command
      (`curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh
      | OPENSHELL_VERSION=v0.1.5 sh`), and verify `openshell --version`,
      `openshell status`, and the driver line all report 0.1.5 with the gateway
      `Connected`

## 2. Re-verify before claiming anything

- [ ] 2.1 Check `openshell rule get <sandbox> --status pending` output at
      v0.1.5 against the parser's expectation, and verify the verdict is
      recorded: either the `Chunk:` text parse is re-confirmed, or the added
      JSON mode is adopted in `bin/maki-oss` and the note at
      `docs/ai/references.md:52` is rewritten — no third outcome
- [ ] 2.2 Run the `docs/verification.md` isolation checklist against v0.1.5
      end to end, and verify every check's actual output is recorded in the new
      `docs/verification-log.md` entry rather than marked "unchanged since
      v0.1.4"
- [ ] 2.3 Verify the hostname-policy binding still opens a curated provider
      host and still denies an unlisted one, and verify the denial line carries
      a `reason:` value — if a legitimate host is now refused, record it as a
      finding and do NOT add a host, widen a port, or relax a rule to make the
      check pass
- [ ] 2.4 Verify an unlisted egress destination outside the deny-by-default
      policy is refused with the broker failing closed (no silent fallback to
      native handling), and record the refusal line in the verification-log
      entry

## 3. Widen the env guard to `--env-from`

- [ ] 3.1 Parse `--env-from KEY` and `--env-from KEY=ENVVAR` in the helper's
      option loop and pass the value through to `openshell sandbox create` as
      `--env-from`, and verify `maki-oss init --env-from EDITOR` with a benign
      `EDITOR` reaches the sandbox
- [ ] 3.2 Apply `credential_like()` to both the sandbox-side name and the
      source name, and verify `maki-oss init --env-from HARMLESS_NAME=ANTHROPIC_API_KEY`
      is refused before any gateway mutation while
      `--env-from EDITOR` is not
- [ ] 3.3 Parameterize `env_refusal()` with the flag actually passed, and
      verify the refusal for `--env-from ANTHROPIC_API_KEY` names `--env-from`
      rather than `--env`
- [ ] 3.4 Add the `--env-from` cases to the stub suite in `tests/run-tests.sh`
      — refused credential-shaped name, refused laundered source name, allowed
      benign value, `--allow-env` override — and verify `make test` exits 0

## 4. Move the version statements

- [ ] 4.1 Update the canonical statement in `docs/ai/references.md` — the
      "Verified against OpenShell v0.1.5 …" header and the OpenShell section's
      per-page verification cells — and verify no `v0.1.4` remains in that file
- [ ] 4.2 Correct `docs/ai/host-playbook.md`'s stale "Verified against
      OpenShell v0.1.2" header, pin the install command to
      `OPENSHELL_VERSION=v0.1.5`, and verify the playbook, `docs/setup-guide.md`,
      `docs/verification.md`, and `docs/ai/references.md` all state the same
      version
- [ ] 4.3 Update `docs/setup-guide.md`'s header and version row,
      `docs/verification.md`'s expected version, and the version-specific note
      in `docs/mcp-migration.md`, and verify `grep -rn '0\.1\.4' docs/` returns
      only the historical verification-log entries that record what was tested
      at that version
- [ ] 4.4 Name `--env-from` next to `--env` everywhere the secret-in-sandbox
      prohibition is stated — `docs/helper.md`, `docs/providers.md`,
      `docs/migrating-providers.md`, and `AGENTS.md` — and verify each of those
      files mentions both flags

## 5. Verify

- [ ] 5.1 Run `make test`, `make lint`, and
      `openspec validate "actualize-openshell-015"` in one pass, and verify all
      exit 0
- [ ] 5.2 Verify the security invariants are unchanged by inspection: no new
      host or port in `examples/providers/` (`git diff --stat examples/`
      empty), no bind-mount option in the helper's create argv, and no `--env`
      or `--env-from` value placed on a command line
- [ ] 5.3 Add a wrap-up note naming the dated archive path each evidence file
      must be rewritten to at archive time, and verify any evidence path
      pointing into this change dir is covered
