# Proposal

## Why

OpenShell **v0.1.5** shipped on 2026-10-20
(`https://github.com/NVIDIA/OpenShell/releases/tag/v0.1.5`), a week after the
v0.1.4 the repository verifies against. The docs no longer agree with each
other about which version has been tested: `docs/ai/references.md` and
`docs/setup-guide.md` say v0.1.4, while `docs/ai/host-playbook.md` still says
"Verified against OpenShell v0.1.2" — two releases stale, and the very
requirement that forbids that drift
(`host-setup` "Versions match their canonical sources") has no scenario
checking the OpenShell version, only the Maki one.

Three v0.1.5 changes land on this repository's boundary rather than beside it:

1. **`openshell sandbox create --env-from KEY[=ENVVAR]`** sets a sandbox
   environment variable from the CLI's environment
   (`https://github.com/NVIDIA/OpenShell/pull/4106`). It is a second path into
   the same place `--env` writes, and the helper's secret-hygiene guard only
   knows the first.
2. **Hostname-based network policy is now bound to supervisor-controlled DNS**
   (`https://github.com/NVIDIA/OpenShell/pull/4602`). Every curated profile in
   `examples/providers/` authorizes a hostname, so this is a hardening change
   in this repository's favour — and one that should be re-verified rather than
   assumed.
3. **The sandbox network broker denies operations when it cannot verify a
   descriptor** (`https://github.com/NVIDIA/OpenShell/pull/4494`) instead of
   falling back to native handling. That is the fail-closed behaviour the
   egress invariant already promises.

A fourth item is a risk rather than a feature: `maki-oss policy review` parses
`Chunk:` lines out of `openshell rule get` text output because v0.1.4 had no
JSON mode. If v0.1.5 added one, the parser silently breaks.

## What Changes

- Move the verified OpenShell version to **v0.1.5** in every place that states
  it — `docs/ai/references.md` (the canonical source and its 30-odd per-page
  verification cells), `docs/setup-guide.md`'s header and version row,
  `docs/ai/host-playbook.md`, `docs/verification.md`, `docs/verification-log.md`,
  and `docs/mcp-migration.md`'s version-specific note.
- Fix the host playbook's stale `v0.1.2` verification statement so the three
  files agree, which is what the `host-setup` requirement already demands.
- Extend the helper's secret-hygiene guard from `--env` to `--env-from`:
  credential-like key names are refused on both paths, `--allow-env` overrides
  for one key, and the refusal names the flag the user actually passed.
- State `--env-from` alongside `--env` in the documents that forbid putting
  secrets into a sandbox environment, so the prohibition matches the tool.
- Re-run the isolation and egress checks against v0.1.5 and record the run in
  `docs/verification-log.md`, including the hostname-policy and fail-closed
  broker behaviour above.
- Verify `openshell rule get`'s output shape at v0.1.5 and, only if it gained
  JSON, adapt the `policy review` parser — otherwise record that the text
  parse was re-confirmed.

Not breaking. Nothing here changes a command a user types today, and the pin
move is a docs-and-verification change plus one guard extension in the helper.

## Capabilities

### New Capabilities

(none — this change re-baselines a dependency's verified version and closes a
gap in an existing invariant; it introduces no new capability)

### Modified Capabilities

- `host-setup`: the "Versions match their canonical sources" requirement gains
  an OpenShell-version scenario it never had, and the playbook's stale
  verification statement is corrected to the canonical version.
- `helper-cli`: the "Secret hygiene" requirement covers `--env-from` as well as
  `--env`, so the guard has parity across both ways to write the sandbox
  environment.

## Impact

- `docs/ai/references.md` — canonical verified-version statement and the
  OpenShell section's per-page cells.
- `docs/ai/host-playbook.md` — the verification header.
- `docs/setup-guide.md`, `docs/verification.md`, `docs/verification-log.md`,
  `docs/mcp-migration.md` — version statements and the new verification run.
- `bin/maki-oss` — the env-hygiene guard and its option plumbing; the refusal
  message names whichever flag was used.
- `tests/run-tests.sh` (or the stub suite's env-hygiene cases) — coverage for
  the `--env-from` refusal and override.
- `examples/providers/` — re-verified, not edited. No profile gains a host, a
  port, or a wildcard, and no rule is relaxed to make a check pass.
- Security surface: unchanged in kind. Egress stays deny-by-default; the only
  new handling is refusing one more way to put a credential-shaped value into a
  sandbox environment. No bind mount, no secret through `--env`/`--env-from`,
  no `maki auth login` inside a sandbox, no non-root relaxation.
## Out of scope

The OpenShell v0.1.5 items that do not apply here: the OCSF log-file rename
(this repository reads logs through `openshell logs`, not file paths),
Kubernetes template annotations, the Go SDK's functional options, external
compute drivers, snap user-gateway behaviour, and the Podman CA bundle. Also
out of scope: adopting optional v0.1.5 features nobody asked for — push-based
config delivery, OTLP/OCSF export, `--annotation` metadata, and MicroVM bind
mounts (which would contradict the no-bind-mount invariant in spirit even
where the upstream feature allows it).
