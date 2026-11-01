# Design

## Context

See `proposal.md` - Why. The Rust port changed helper resolution from "the
script is in `bin/`" to "the shim execs a release binary built by
`make build`". The migration updated `docs/helper.md` and the shared host
playbook because its task list named them, but the first-run pages were
outside that task's scope. The investigation that produced this change left
partial first-run edits in the working tree; the tasks treat every edit as
unverified until its check runs.

Constraints:

- `docs/ai/host-playbook.md` is the one ordered host sequence and already
  owns the toolchain install, the `make build` step, and the `osa --help`
  check.
- `docs/ai/references.md` is the only index of external documentation links.
- `scripts/check-playbooks.sh` (`make lint-docs`) checks `docs/ai` structure;
  `scripts/check-links.sh` checks link resolution. CI runs `make test-all`,
  not the doc checks.
- Historical records (`docs/verification-log.md`, archived changes) keep the
  state at the time of each run.

## Goals / Non-Goals

**Goals:**

- Every clean-host entry page tells a reader how the helper becomes runnable,
  in command order, before the first helper command.
- The onboarding spec no longer defines helper readiness as clone + `PATH`.
- The Maki playbook's per-shell check runs the shim, not only resolves it.
- The rustup reference is indexed and the dashboard states its `osa` build
  dependency.

**Non-Goals:**

- No behavior, command, flag, environment variable, config key, state file, or
  security-invariant change.
- No second build tutorial: the host playbook keeps the install and recovery
  detail; entry pages show the minimum and link it.
- No new documentation lint or CI job. The spec scenarios are the review
  contract; an automated ordering check is deferred until drift recurs.
- No edits to active change artifacts or to historical records.

## Decisions

### D1. Fix the requirement, not only the pages

The `agent-onboarding` requirement "First-run documentation is executable"
currently allows clone + `bin/` `PATH` as the whole resolution story. That is
what let the pages pass review after the port. The delta makes the core build
part of the requirement and adds two scenarios: README builds before the first
helper command, and an unbuilt shim is not readiness.

Alternative: docs-only patch. Rejected because the next implementation change
would face the same stale contract.

### D2. One ordered build path, repeated as a minimum

Every clean-host page shows the same two lines before its first helper command:

```sh
make build
./bin/<front-end> --help
```

The pinned toolchain is named as a prerequisite, and the host playbook link
carries the install and failure recovery. A page that deliberately starts
after README Install may say so and link instead, as the requirement allows.
This keeps pages executable without duplicating the toolchain tutorial four
times.

Alternative: repeat `rustup show active-toolchain` and the rustup install
fallback on every page. Rejected as duplication of the host playbook's owned
step; the prerequisite and the link are enough.

### D3. Verify a shim by running it

The Maki playbook's POSIX and fish checks follow resolution with
`maki-oss --help`, matching the host playbook's shared check. `--help` exits 0,
starts no sandbox, and makes no gateway call. The verification text also states
that a shim over a missing binary exits non-zero naming `make build`.

Alternative: keep `command -v` only. Rejected because it is exactly the failure
the port introduced: a resolvable shim is not a working helper.

### D4. Index the toolchain link

Add a rustup row to `docs/ai/references.md` under a project-toolchain section.
The host playbook keeps its inline link, which the index now covers, and the
first-run pages point at the host playbook rather than adding another external
URL.

Alternative: remove the URL from the host playbook and describe rustup in
prose. Rejected because a bare "install rustup" sends the reader searching for
an unindexed source.

### D5. Keep the check surface as-is

Use `make lint-docs`, `scripts/check-links.sh`, and a temporary-clone run of
the first-run commands. Do not add a static "must contain `make build`" check:
it would need `make lint-docs` added to CI to matter, and it cannot distinguish
a page that legitimately starts after README Install. The spec scenarios cover
that judgment.

## Risks / Trade-offs

- **Duplicated build lines drift between pages** -> they are two identical
  commands, and the host playbook owns the detail; a change that moves the
  build updates this checklist.
- **The spec scenario is not automated** -> recurrence risk. Mitigation: the
  scenario names the exact pages and the failure text; if drift recurs, add the
  deferred lint guard.
- **`references.md` grows a non-agent section** -> the file already groups by
  upstream source; a short project-toolchain section keeps the index the single
  place without pretending rustup is an agent doc.
- **A reader on a host without `rustup` still fails at `make build`** -> every
  page names the pinned toolchain as a prerequisite and links the host
  playbook, which owns the install command.
- **Dashboard README could overpromise a standalone dashboard** -> it gains one
  requirement line, not a build sequence; `osa dashboard` still hands off to
  the dashboard.

## Migration Plan

1. Correct the `agent-onboarding` requirement and scenarios (this change's
   spec delta).
2. Update the eight pages in the proposal's Impact list.
3. Run `make lint-docs`, `scripts/check-links.sh` on the touched files, and
   `openspec validate align-docs-with-rust-core --strict`.
4. In a temporary clone with no `osa-core/target`, run the first-run block:
   confirm the pre-build helper fails naming `make build`, run `make build`,
   and confirm `./bin/<front-end> --help` exits 0.
5. Rollback is a docs revert; no runtime state or released artifact is
   affected.
