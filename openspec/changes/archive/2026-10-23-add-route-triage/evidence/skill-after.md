# Skill after (GREEN) — route triage

Re-run of the baseline prompt (design decision 6) against the rewritten
`.claude/skills/running-feature-discovery/SKILL.md`. Recorded verbatim. The
acceptance bar: `GET /api/vcs` is triaged as live work with a sandbox-sourced
capability row, and `GET /api/info` is accepted with a reason that justifies
the fake.

- Date: 2026-10-23
- Skills: `.claude/skills/running-feature-discovery/SKILL.md` (route queue),
  `.claude/skills/proposing-coverage-change/SKILL.md` (route flip rule)
- Subagent session: `ses_e96a961b7ffeQPLAxZCn4UV9qD`

## Prompt

> You are working in the repository /Users/ki/Projects/experiments/maki-openshell.
>
> Read `.claude/skills/running-feature-discovery/SKILL.md` first, in full, and
> follow it as your instructions for this task.
>
> Task: triage the reachable `served-faked` routes `GET /api/vcs` and
> `GET /api/info` from `bridge/compat/statuses.json`.
>
> Do not edit any files. When you are done, reply with, for each route:
>
> - the decision/action you chose under the skill's triage rules,
> - the exact `statuses.json` fields you would write for it,
> - your rationale, in your own words,
> - the next hand-off (if any).

## Response (verbatim)

## Ground truth I checked

- `bridge/compat/statuses.json` — both rows are `served-faked`, `reachable`, `blockedBy: none`, no triage field; 21 untriaged reachable routes ([docs/compatibility.md:50–51](../docs/compatibility.md)).
- Live behavior: both fall through `synthesize()` (`bridge/src/bridge.ts:513`), so `GET /api/info` returns `{version:"2.0.32",pid:0,urls:["sample"],paths:{tmp:"sample"}}` (`bridge/src/spec-answers.ts:26,128`) and `GET /api/vcs` returns `data.branch.current: "sample"` (captured in `bridge/test/fixtures/bridge-requests.jsonl` and `bridge/test/captures/tui-last-requests.jsonl`).
- Pinned TUI at `v2.0.32` (installed copy is 2.0.32): `packages/cli/src/services/server-connection.ts:35–39` reads `server.info().version` on the `--server` attach path and warns on mismatch; `packages/tui/src/context/session-terminals.tsx:61–66` reads only `capabilities?.persistentPty`; `packages/tui/src/component/prompt/index.tsx:1620` renders `branch.current` in the footer as `directory:branch`; `packages/client/src/solid/data.ts:1368` fetches it via `vcs.get`.
- `git` is in the image (`examples/maki-image/Dockerfile:25`), and the bridge already execs into the sandbox for Maki (`bridge/src/maki.ts:39`).

---

## `GET /api/info` — decision: `accept`

**Action:** `accept` (skill: "no code; status/doc edit in this change"). No feature linked.

**Exact `statuses.json` row** (replaces the current line for this route):

```json
{ "route": "GET /api/info", "status": "served-faked", "scope": "reachable", "blockedBy": "none", "evidence": "bridge/test/fixtures/bridge-requests.jsonl", "fakeReason": "the bridge is the emulated 2.0.32 server, so the pinned version is the truthful answer, not a placeholder: the client reads server.info().version on the only attach path this repo ships (opencode --server, bin/maki-oss L1284) and warns on any mismatch (server-connection.ts v2.0.32 L35–L39); pid/urls/paths are read only by managed-service and pair flows this deployment never takes, and an absent capabilities is the client's own pre-field fallback (session-terminals.tsx v2.0.32 L61–L66)" },
```

**Rationale, in my words.** This fake is not standing in for missing data — the identity being reported belongs to the emulated server, so the pinned version is what a correct 2.0.32 server would say. The TUI's attach path uses exactly one field, `version`, and any other value would produce a visible warning; the remaining fields are consumed only by flows this deployment never enters (`service-probe.ts` health re-registration, `opencode pair`), and omitting `capabilities` is precisely what the client documents for older servers. The skill's own example of a valid `fakeReason` is this route, and the check "is the synthesized data *correct*?" answers yes. Deliberately do not link the PTY/terminal capability here: this route's payload is right; the terminal surfaces are separate (and out-of-scope) rows.

**Hand-off.** None beyond recording: add this `fakeReason` in the discovery change, extend the copied-forward `opencode-tui-features.md` "Server handshake" row with the `server-connection.ts`/`session-terminals.tsx` citations and the accept rationale, and regenerate `docs/compatibility.md` (`bun scripts/gen-compat.ts`). Report then shows `accept — …` and untriaged drops by one.

---

## `GET /api/vcs` — decision: `capability` (link a feature)

**Action:** `capability` → `proposing-coverage-change`, implementation branch. Discovery must record the feature row in the same change (skill: "Never open a capability change discovery has not recorded"), then link it.

**Exact `statuses.json` changes.**

Route row (add `feature`; status/scope/evidence unchanged):

```json
{ "route": "GET /api/vcs", "status": "served-faked", "scope": "reachable", "blockedBy": "none", "evidence": "bridge/test/fixtures/bridge-requests.jsonl", "feature": "vcs-branch-live" },
```

New feature row:

```json
{ "id": "vcs-branch-live", "title": "GET /api/vcs reports the sandbox checkout's current git branch for the prompt footer's `directory:branch` label instead of the synthesized \"sample\"", "status": "unverified", "scope": "reachable", "blockedBy": "none", "evidence": "bridge/test/captures/tui-last-requests.jsonl" },
```

(Both `feature` and `fakeReason` must not coexist; `crosscheck.test.ts:180–213` accepts this pairing, and the route stays `served-faked` until the feature is `verified`.)

**Rationale, in my words.** The TUI renders this value to the user: the prompt footer label is `directory:branch` from `data.location.vcs.info(...).branch.current`, so the current behavior displays `…/maki-openshell:sample` — a branch that does not exist. That is not "synthesized data is correct"; it is missing data. The value is not on the Maki SDK wire at the pin, but it *is* in the sandbox: the checkout Maki edits has a real HEAD, `git` is installed in the pinned image, and the bridge already owns an OpenShell exec transport. By the skill's rule ("both pins support it" scopes the wire branch, not the route; the sandbox is a valid data source) this is `capability`, not `accept`. It is not pin-blocked because nothing on the Maki side forbids it. Scope the capability to this one route: `/api/vcs/base|branch|status|diff` and `POST /api/vcs/init` stay out-of-scope — the capture never calls them ("contract-only"), and the footer only needs `current`.

**Hand-off.** `proposing-coverage-change` opens a change that:
- answers `GET /api/vcs` from one sandbox exec (`openshell sandbox exec … --worktree/CANONICAL -- git …`) using the *existing* transport and the `MAKI_CHILD_CMD`-style seam for offline tests; no host path read, no new transport, no bind mount, no `--env`;
- returns a schema-valid `Vcs.Info` fallback (or the pin's 404 shape) when the workdir is not a git repo — decide from the real server at the pin, not from the faked capture;
- ships one offline test/fixture as evidence, then flips `vcs-branch-live` → `verified` and this route → `served-live` in the same change (enforced by `crosscheck.test.ts:204–213`), and regenerates `docs/compatibility.md`.
- Extends the copied-forward `opencode-tui-features.md` "Location/project" row with the pin citation (`prompt/index.tsx` v2.0.32 L1620, `solid/data.ts` L1368) and the sandbox source; if the change's matrix path is cited anywhere, the archive commit rewrites it to the archived path.

Report in the meantime: `in progress — \`vcs-branch-live\``. Scoreboard delta after recording both: untriaged reachable routes **21 → 19**, reachable faked stays 21 (one accept, one linked), features **+1 unverified** (`30 of 33`, 26 verified / 1 unverified / 4 degraded).

---

**Note, not recorded here:** the pinned client also handles the ephemeral `vcs.branch.updated` event (`packages/schema/src/vcs-event.ts` at v2.0.32; `solid/data.ts:1273`), which the bridge never emits and the event matrices (enumerated from `session-event.ts`) do not list. That is a separate discovery finding for the next pass — it is not needed for this route's read and I did not fold it into the capability.

Skipped: I did not run `bun bridge/test/discovery.ts`, `make test-ui`, the suite, or `gen-compat` (no files changed, so there was nothing to verify); I did not check the real OpenCode server's `/api/vcs` answer for a non-repo location. Risk: the `accept` on `/api/info` is correct only for the TUI/`--server` path this repo ships — a desktop-app client would read `paths.tmp`/`urls` and make that payload real work.

## Green check

- `GET /api/vcs` — triaged as live work through a `feature` link
  (`capability` → `proposing-coverage-change`), with the sandbox named as the
  data source through the existing OpenShell exec transport and the security
  invariants restated. Not `accept`, not a scope statement.
- `GET /api/info` — `accept` with a `fakeReason` that justifies the fake: the
  pinned version is the truthful answer for the emulated server and the TUI
  warns on any mismatch. Not a placeholder excuse.
