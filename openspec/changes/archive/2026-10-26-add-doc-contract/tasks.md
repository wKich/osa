# Tasks

## 1. Contract document

- [x] 1.1 Write `docs/ai/document-contract.md` with the canonical `P0`-`P8` phase table, the shared-versus-agent naming rule, the metadata table, and the `router`, `playbook`, `verification`, and `reference` templates. Verify the file exists and contains each section with `grep -q` for `P0`, `P8`, `| Kind |`, `### Run`, `### Verify`, `### Stop if`, and `## See also`.
- [x] 1.2 Add the metadata table and required headings to `docs/ai/host-playbook.md` without moving or renaming it. Verify `grep -q '| Kind | \`playbook\`' docs/ai/host-playbook.md`, `grep -q '^## Scope' docs/ai/host-playbook.md`, `grep -q '^### Stop if' docs/ai/host-playbook.md`, and every existing relative link still resolves with `scripts/check-links.sh docs/ai/host-playbook.md`.
- [x] 1.3 Add the metadata table and required headings to `docs/ai/agent-playbook.md` the same way. Verify the same `grep` checks pass for that file and `scripts/check-links.sh docs/ai/agent-playbook.md` reports no failures.

## 2. Checker

- [x] 2.1 Write `scripts/check-playbooks.sh` as POSIX sh. It must scan `docs/ai/**/*.md`, skip files without `Kind`, strip fenced code blocks before finding headings, require `Doc`, `Kind`, `Agent`, `Covers`, and `Verified`, require the kind's sections, require `Run`, `Verify`, and `Stop if` in playbook/verification blocks, and require `Expected:` in each `Verify`. Verify with `sh -n scripts/check-playbooks.sh` and `scripts/check-playbooks.sh` exiting 0 on the two retrofitted playbooks.
- [x] 2.2 Verify the checker fails closed: copy a playbook to a temporary file under `docs/ai/`, remove its `### Stop if`, run `scripts/check-playbooks.sh`, and confirm it exits non-zero and names the file and missing section; delete the temporary file. Do not leave the broken fixture in the repository.
- [x] 2.3 Add `lint-docs: scripts/check-playbooks.sh` to the `Makefile`. Verify `make lint-docs` exits 0.
- [x] 2.4 Add `lint-docs` to the existing `lint` target. Verify `make lint` exits 0, including shellcheck and the fish syntax checks.

## 3. Close

- [x] 3.1 Run `scripts/check-links.sh`, `make lint-docs`, and `make lint`; all must exit 0. Record the commands and any skipped check in the change's final summary.
- [x] 3.2 Run `openspec validate add-doc-contract --strict`; it must exit 0 with the `skip_specs: true` marker.
- [x] 3.3 Confirm the diff is limited to `docs/ai/document-contract.md`, `docs/ai/host-playbook.md`, `docs/ai/agent-playbook.md`, `scripts/check-playbooks.sh`, `Makefile`, and this change's directory with `git diff --stat`.
