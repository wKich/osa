# Spec Delta

## MODIFIED Requirements

### Requirement: Versions match their canonical sources

Every version the playbook pins (Maki version, OpenShell version, container
engine minimum) SHALL match the repository's canonical source for that value —
`examples/maki-image/Dockerfile` for Maki, `docs/ai/references.md` for the
verified OpenShell and Maki versions — and the playbook SHALL link
`docs/ai/references.md` rather than restate external documentation links.

The OpenShell version a document claims to be verified against SHALL match
`docs/ai/references.md` on every page that states one, and a page claiming an
older verified version than the canonical one SHALL be treated as stale rather
than as a second opinion. Bumping the canonical version SHALL be accompanied by
a re-verification run recorded in `docs/verification-log.md`, so the claim is a
measurement rather than an edited string.

#### Scenario: Maki version consistency

- **WHEN** `MAKI_VERSION` in `examples/maki-image/Dockerfile` and the Maki
  version stated in `docs/ai/host-playbook.md` are compared
- **THEN** they are identical

#### Scenario: External links stay centralized

- **WHEN** `docs/ai/host-playbook.md` is searched for `https://` links
- **THEN** every such link is one of the URLs already listed in
  `docs/ai/references.md`

#### Scenario: OpenShell version consistency

- **WHEN** the OpenShell versions stated in `docs/ai/host-playbook.md`,
  `docs/setup-guide.md`, `docs/verification.md`, and `docs/ai/references.md`
  are compared
- **THEN** all four name the same version, and it is the version the
  verification log records as tested

#### Scenario: A version claim without a verification run is incomplete

- **WHEN** a page is changed to claim verification against a newer OpenShell
  version
- **THEN** `docs/verification-log.md` carries a dated entry for that version,
  and the checklist in `docs/verification.md` was run against it rather than
  carried forward
