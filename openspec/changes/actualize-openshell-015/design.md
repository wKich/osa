# Design

## Context

The repository's OpenShell knowledge lives in three places that must agree:
`docs/ai/references.md` states the verified version and stamps each OpenShell
doc link with it, `docs/setup-guide.md` repeats it in its header and version
row, and `docs/ai/host-playbook.md` restates what was tested. Today they read
v0.1.4, v0.1.4, and **v0.1.2** respectively — the playbook's statement was
left behind by the 0.1.4 upgrade, and `host-setup`'s "Versions match their
canonical sources" requirement has a Maki-version scenario but no
OpenShell-version one, which is why nothing caught it.

`docs/ai/host-playbook.md:89` installs with
`curl -LsSf .../install.sh | sh` — no version argument, so a fresh host gets
whatever is current, then is asked to verify against a version the repository
claims. Maki avoids this by pinning `ARG MAKI_VERSION` in
`examples/maki-image/Dockerfile`; OpenShell has no equivalent pin because it is
installed on the host rather than baked into the image.

The helper's guard is `credential_like()` at `bin/maki-oss:593` — a
credential-shaped-segment test mirroring OpenShell's own heuristic — applied
through `check_env_hygiene()` to `opt_envs` only. `env_refusal()` at `:620`
hardcodes "refusing --env". v0.1.5 adds `--env-from KEY[=ENVVAR]`, which writes
the same sandbox environment from the caller's environment, so a guard that
knows only `--env` is a guard with a documented bypass.

`maki-oss policy review` parses `Chunk:` lines out of `openshell rule get
<sandbox> --status pending` text output (`bin/maki-oss:577-583`), because
v0.1.4 has no JSON mode — recorded in `docs/ai/references.md:52`. That is the
one place a same-minor OpenShell release could break the helper silently.

See proposal.md for why this change exists; this document is how the version
moves and how the guard widens.

## Goals / Non-Goals

**Goals:**

- One OpenShell version stated everywhere, backed by a dated verification run.
- A reproducible host install: the playbook asks for the version the repository
  verified, not "latest".
- The env-hygiene guard has parity across `--env` and `--env-from`, including
  the laundering case where the sandbox-side name is neutral.
- The `rule get` parser is either confirmed still valid or adapted, never
  silently left to break.

**Non-Goals:**

- Adopting optional v0.1.5 features (push config delivery, OTLP/OCSF export,
  `--annotation`, MicroVM bind mounts) — listed in the proposal.
- Adding a `doctor` version check. Useful eventually, but `doctor` answers
  "is my host ready", not "is my host the verified version", and nobody asked.
- Changing any provider profile, policy rule, or egress destination.
- Bumping the Maki pin. Maki v0.6.4 is unchanged and this change does not
  touch it.

## Decisions

### D1 — Pin the installer to the verified version in the playbook

The playbook's install step becomes the version the repository verified —
`OPENSHELL_VERSION=v0.1.5` for the install script, matching the flag the
v0.1.5 release notes document — with a one-line note that bumping the pin is
the same act as re-verifying, not a separate chore.

**Why:** an unpinned install makes the verification claim unenforceable. A host
that installs "latest" is running something nobody tested, and the playbook
then asks it to confirm `Status: Connected` — a check that passes on any
version. Maki gets reproducibility from a Dockerfile arg; OpenShell needs the
equivalent at the install step.

**Alternative considered:** leave the install unpinned and only state the
verified version. Rejected — it is the current state, and it is what allowed
the playbook to drift to v0.1.2 unnoticed.

**Alternative considered:** a `doctor` check that fails below the verified
version. Rejected for now (Non-Goals): it widens `doctor`'s contract beyond
"host readiness" and duplicates a claim the docs already make.

### D2 — The guard checks both names for `--env-from`

For `--env-from KEY` the sandbox holds `KEY`; for `--env-from KEY=ENVVAR` it
holds `KEY` with the value read from `ENVVAR`. Both names go through
`credential_like()`, and a hit on either refuses.

**Why:** checking only the sandbox-side name leaves `--env-from
HARMLESS_NAME=ANTHROPIC_API_KEY` as a one-line bypass, which is exactly the
exposure the invariant exists to prevent. The spec delta spells this out as its
own scenario so it cannot be "simplified" away later.

**Alternative considered:** check only the source name, since that is where the
value comes from. Rejected — `--env-from MY_API_KEY` (no explicit source) is
credential-shaped on the sandbox side and must refuse too.

**Alternative considered:** refuse `--env-from` outright rather than support it.
Rejected — the helper already sanctions non-secret `--env` values behind the
same guard, and a blanket refusal would push users to call `openshell
sandbox create` directly, where no guard runs at all.

### D3 — Reuse `credential_like()`; parameterize the refusal's flag name

`env_refusal()` takes the flag it was called for, so the message names
`--env-from` when that is what the user typed. The segment list, the
`--allow-env` override, and the ordering ("before any gateway mutation") stay
as they are.

**Why:** a copy of the character-class test would drift from the original, and
a refusal that says "refusing --env" after a user typed `--env-from` reads like
a bug and invites them to retry with the flag the message names.

### D4 — Verify `rule get` at v0.1.5 before deciding anything about it

The first thing done against the upgraded binary is the shape check on
`openshell rule get <sandbox> --status pending`. If it still emits the text the
parser expects, the existing parse is re-confirmed and the `references.md:52`
note simply moves to v0.1.5. If it gained JSON, the parser switches to that and
the note is rewritten.

**Why:** this is the only same-minor change that can break the helper silently,
and the correct response depends on an observation nobody has made yet. Writing
either answer down in advance would be the guessing this repository's
verification discipline exists to avoid.

### D5 — Upgrade, verify, then edit the version strings

Order is: install v0.1.5 on the host, run the `docs/verification.md` checklist,
record the run in `docs/verification-log.md`, and only then update the version
statements across the four docs. The spec delta makes this ordering a
requirement (`A version claim without a verification run is incomplete`).

**Why:** the failure mode this change is repairing is a version string edited
without a run behind it. Doing it in the same order again would recreate it.

## Risks / Trade-offs

- **[A v0.1.5 behaviour change breaks a check that passed at v0.1.4]** → The
  checklist runs before any version string changes, so the run is the source of
  truth; a failure is recorded as a defect and the version claim does not land.
- **[The hostname-policy change rejects a legitimate provider host]** → Do not
  relax the rule to make it pass. Egress stays deny-by-default; never `tls:
  skip`, `access: full`, or a wildcard host. Record the denial with its
  `reason:` line and treat it as a finding.
- **[`--env-from` has a syntax variant upstream may change]** → Only the two
  documented forms (`KEY` and `KEY=ENVVAR`) are accepted; anything else fails
  closed with a usage error rather than being passed through.
- **[Pinning the installer makes this repo lag upstream]** → That is the point:
  the pin is the contract, and moving it is a re-verification, not an edit.
  The playbook says so next to the command.
- **[Upgrading the local binary is not cleanly reversible]** → The install
  script takes a version; the rollback path is recorded in the verification-log
  entry (`OPENSHELL_VERSION=v0.1.4`).

## Migration Plan

Docs plus one guard, so deployment is a merge. Sequence inside the change:
upgrade the host binary → run the checklist → record it → edit the strings →
widen the guard and its tests. Rollback is `OPENSHELL_VERSION=v0.1.4` on the
host plus a revert of the docs commit; the helper change is independent of the
version bump and can be kept or reverted on its own.

## Open Questions

None that change the specs, the approach, or the task breakdown. Whether to
adopt any optional v0.1.5 feature is deferred and listed in the proposal's
out-of-scope section.
