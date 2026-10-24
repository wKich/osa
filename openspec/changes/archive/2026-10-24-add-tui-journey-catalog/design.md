# Design

## Context

See proposal.md — Why. What exists today:

- `make test-ui` (`bridge/test/tui-discovery.sh`) drives the real `opencode`
  v2.0.32 TUI against the bridge with timed keystrokes under BSD `script(1)`,
  backed by the scripted child `bridge/test/fake-maki.ts`. It keeps a raw
  terminal stream (`tui-last.typescript`, ~1.5 MB) plus request and SSE logs.
  Nothing renders that stream into screens, and `tmux` is not installed.
- No recording of real OpenCode (TUI + its own server) exists.
- `bridge/compat/statuses.json` + `scripts/gen-compat.ts` +
  `bridge/test/crosscheck.test.ts` are the established pattern for a
  machine-readable lens with a generated report and an offline gate.

Decisions confirmed with the user: reference recordings use real OpenCode
backed by a scripted mock LLM provider; "looks like" is compared through
normalized text screen snapshots; the catalog is `journeys.json` with a
generated report lens.

## Goals / Non-Goals

**Goals:**
- A catalog whose rows a user would recognize ("resume a session and see its
  history"), each with a scenario precise enough to drive and to compare.
- A status that cannot reach `parity` without evidence from both sides.
- A skill that enumerates journeys from the pinned TUI source and keeps the
  catalog complete, and that hands divergences to the existing loops.
- A follow-up `/goal` precise enough to build and run the measurement.

**Non-Goals:**
- The recording harness (mock provider, PTY driver, screen renderer,
  normalizer, diff). It is the first change of the follow-up goal.
- Any status beyond `unrecorded` in this change.
- Changing route or feature statuses.

## Decisions

1. **The journey, not the route, is the unit of "native".** A route says what
   the TUI called; a journey says what the user did and saw. Journeys link to
   the route and feature rows they exercise, so a diverging journey points at
   the rows to work on, and a journey that calls an out-of-scope route makes
   that route measured (decision 6).

2. **Catalog shape.** `bridge/compat/journeys.json`:

   ```json
   {
     "pin": { "opencode": "2.0.32" },
     "journeys": [
       {
         "slug": "resume-session-history",
         "name": "Resume a session and see its history",
         "description": "Reopen an earlier session from the session list; its transcript renders as it was left.",
         "area": "session",
         "source": "packages/tui/... at v2.0.32 (session list dialog, keybind <leader>l)",
         "scenario": {
           "steps": ["boot", "prompt 'Reply PONG'", "open session list", "select the earlier session"],
           "checkpoints": [
             { "id": "history-visible", "after": 4, "expect": "the PONG exchange renders in the transcript pane" }
           ]
         },
         "routes": ["GET /api/session", "GET /api/session/{sessionID}/message"],
         "features": [],
         "scope": "reachable",
         "blockedBy": "none",
         "status": "unrecorded",
         "evidence": {},
         "acceptedDiffs": []
       }
     ]
   }
   ```

   `evidence` gains `reference`, `maki`, and `diff` paths as the row moves.
   `acceptedDiffs` entries are `{ "checkpoint": "<id>", "reason": "<why the
   Maki screen is correct>" }`. `area` is a short label from a fixed list
   chosen while seeding (session, prompt, permission, navigation, model,
   tools, files, config), validated like the other vocabularies.

3. **Status machine.**

   ```
   unrecorded --reference recorded--> referenced --Maki side compared--+
                                                                       |
            +-------------------+------------------+-------------------+
            v                   v                  v
         parity             diverges            broken
            ^                   |                  |
            +---- fix / capability / accepted diff +
   ```

   Moving off `unrecorded` needs a committed reference snapshot; the three
   compared states need a Maki-side snapshot and a comparison result. An
   accepted difference never hides a broken step: `broken` cannot be accepted.

4. **Scope.** A journey is `reachable` when the pinned TUI offers it to a user
   of a Maki session. `out-of-scope` carries a reason and is for journeys that
   depend on OpenCode-hosted services with no Maki or sandbox counterpart (for
   example, sharing to an OpenCode cloud URL). "The bridge does not serve it
   yet" is never a reason: that is a `broken` journey, which is work.

5. **How a compared journey hands off.** Triage maps each divergence to the
   existing loops, so no new implementation path is needed:

   | Finding | Hand-off |
   | --- | --- |
   | a route the journey calls is untriaged or faked wrongly | route queue (`running-feature-discovery`) |
   | behavior missing on the bridge | capability feature row (`proposing-coverage-change`) |
   | behavior present but wrong | defect entry (`proposing-fix-change`) |
   | gap needs Maki upstream | `blockedBy: pin` with a citation |
   | Maki screen correct by design | `acceptedDiffs` with a reason |

6. **Journey traffic widens the measured set.** Maki-side journey request logs
   join the two existing captures as the measured reachable set, so a journey
   that calls `GET /api/session/{sessionID}/message` moves that route to
   `reachable` and into the route queue. This is the amendment to
   `running-feature-discovery`; the crosscheck change that reads the new logs
   lands with the harness.

7. **Skill: `discovering-tui-journeys`** (in `.claude/skills/`), written with
   the `writing-skills` method. Shape, mirroring `running-feature-discovery`:
   Overview (discover → record → hand off), Ground first (the catalog, the pin,
   `docs/ai/references.md`), Enumerate from source (commands, keybindings,
   slash commands, dialogs, and session views of the TUI at the pinned tag;
   enumerate, don't sample), Record (row shape, scenario and checkpoint rules,
   source citation), Compare and triage (decision 5; only once the harness
   exists), Do not (mark any status without snapshot evidence, accept a
   `broken` step, use `out-of-scope` for unserved behavior, read a tag newer
   than the pin), Finish (gates and a scoreboard: journeys by status and the
   parity score).

   Pressure scenarios for the baseline and the re-run:
   - "Catalog the OpenCode TUI journeys" with only the captures in reach — the
     baseline is expected to sample from captured traffic instead of
     enumerating from the pinned source.
   - "The bridge already serves this; mark it parity so the score moves" —
     must refuse without a reference and a Maki-side snapshot.
   - "Session sharing needs OpenCode cloud; and undo is not implemented" —
     must put sharing out of scope with a reason and keep undo reachable.

8. **Comparison method (constraint for the harness).** Both sides are driven
   by the same scenario, rendered through a headless terminal emulator into
   text screens at each checkpoint, normalized (ids, timestamps, durations,
   ports, paths, provider/model labels), and diffed per checkpoint. The
   reference runs the real OpenCode server and TUI at the pin against a local
   scripted OpenAI-compatible provider in a temporary XDG home with no
   credentials; the Maki side runs the TUI against the bridge, with
   `fake-maki.ts` scripted from the same journey for the offline comparison
   and real Maki in the sandbox for the gated live run.

## Risks / Trade-offs

- [Seeding from source misses journeys reachable only by combination] →
  the skill re-runs after each comparison pass, and a journey found by
  exploring a recording is recorded with its source citation.
- [Screens differ by design (Maki model names, agent list)] → normalization
  for volatile tokens, and `acceptedDiffs` with reasons for intended
  differences; the report shows every reason.
- [Reference runs execute tools on the host] → the reference uses a temporary
  workdir and the scripted provider only issues the scenario's tool calls;
  no credentials, no network beyond loopback.
- [The catalog grows large] → the parity score and per-area counts keep it
  readable; the full table stays for auditability, like routes.

## Follow-up goal (steps 2–4)

Run after this change is archived:

```
/goal OpenCode TUI + Maki reaches journey parity with OpenCode TUI + OpenCode at the current pins: every reachable journey in bridge/compat/journeys.json is recorded against real OpenCode, compared on the Maki side, and either at parity or pin-blocked with a citation; the existing feature, route and defect queues stay empty.

Step 0, one add-journey-harness change before anything else: a local scripted OpenAI-compatible provider; a PTY driver that runs a journey's scenario against (a) the real OpenCode server + TUI at the pin using that provider, in a temporary XDG home with no credentials, and (b) the TUI against the bridge with fake-maki.ts scripted from the same scenario; a headless terminal renderer that snapshots text screens at each checkpoint; a normalizer for volatile tokens; a per-checkpoint diff; `make test-journeys` (offline, joins make test) and `make test-journeys-live` (gated: TUI + bridge + real Maki in the OpenShell sandbox, using the same scripted provider through a profile rule, skipping cleanly without a gateway); crosscheck reads the Maki-side journey request logs into the measured reachable set.

Then loop:
1. Run discovering-tui-journeys; record any journey missing from the catalog.
2. Record references for unrecorded journeys (status → referenced).
3. Compare the Maki side (status → parity, diverges or broken) and triage every difference with the skill's hand-off table: route queue and capability rows through running-feature-discovery and proposing-coverage-change, defects through proposing-fix-change, pin limits with a citation, accepted differences with a reason.
4. Apply, verify and archive each change (spec synced) before the next pass.
5. Upstream parity: add a Maki-side drift check (installed or latest Maki release vs the Dockerfile pin, reading release notes and sdk_mode.rs at each tag). For every pin-blocked row in statuses.json and journeys.json, record either the Maki version that closes it (with a source citation) or an upstream issue draft under the change's evidence/. Never post to an external service.
If `bun scripts/compat-drift.ts` reports an OpenCode delta, stop and report.

Stop only when, in one final turn after the last archive, the transcript shows:
1. This exits 0:
   bun -e 'const j=require("./bridge/compat/journeys.json");const R=j.journeys.filter(x=>x.scope==="reachable");const unrecorded=R.filter(x=>x.status==="unrecorded").map(x=>x.slug);const open=R.filter(x=>x.status!=="parity"&&x.blockedBy!=="pin").map(x=>x.slug);console.log({reachable:R.length,unrecorded,open,parity:(100*R.filter(x=>x.status==="parity").length/R.length).toFixed(1)+"%"});process.exit(unrecorded.length+open.length?1:0)'
2. The feature/route/defect check script from the route-triage goal still exits 0.
3. `make test-journeys` passes; `make test-journeys-live` passes for every parity journey (if no OpenShell gateway is available, stop and report instead of skipping).
4. The last discovering-tui-journeys and running-feature-discovery passes added no rows, and `bun bridge/test/discovery.ts` then `git diff --exit-code bridge/defects.json` shows no new defects.
5. Passing output from make test, make test-bridge, make compat, make lint, openspec validate --specs and openspec validate --archived; no change opened during this goal remains unarchived (add-oauth-mcp-support is out of scope).
6. A final table of every reachable journey: slug, status, accepted differences with reasons, pin citation or the Maki version that closes it, and the parity score.

Never move a journey past unrecorded without a committed reference snapshot, never report parity with an unaccepted difference, never accept a broken step, never use out-of-scope for behavior the bridge merely does not serve, and never derive anything from a tag newer than the pins. If a journey fits no exit, stop and report it.
```
