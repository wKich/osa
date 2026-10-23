# Design

## Context

See proposal.md — Why. Today `bridge/compat/statuses.json` holds 143 route
rows: 32 `reachable` (10 `served-live`, 21 `served-faked`, 1 `deferred`) and
111 `out-of-scope` (107 `served-faked`, 3 `deferred`, 1 `served-live`). The
live out-of-scope row is `POST /api/session/{sessionID}/interrupt`: it went
live in `add-interrupt-forwarding`, but neither committed request capture
records it, so its scope was never revisited. The existing requirement
already defines a route served live as reachable.

The feature queue is empty at the pin (26 `verified`; 4 `degraded`, all
`blockedBy: pin` with `sdk_mode.rs` citations). The report, the crosscheck,
and both skills key work off features only, so the 21 reachable fakes have no
path into the loop.

## Goals / Non-Goals

**Goals:**
- Record one decision per reachable `served-faked` route in the status file,
  so "done" can be checked from data rather than asserted.
- Make untriaged routes a visible queue in the burndown, next to the feature
  queue.
- Fail the offline suite on inconsistent triage, never on missing triage.
- Rewrite the two skills so an agent following them triages routes instead of
  accepting them by default, and prove the rewrite with a before/after run.

**Non-Goals:**
- Triaging any of the 21 routes; that is the follow-up loop.
- Any change to the out-of-scope 107 faked routes.
- Bridge runtime changes, new routes, or sandbox plumbing for route data.
- A separate route skill: routes enter the existing capability branch as
  feature rows.

## Decisions

1. **Two optional fields, decision derived — not a `decision` enum.**
   `feature` and `fakeReason` plus the existing status and the linked
   feature's `status`/`blockedBy` determine the decision:

   | Route status | Field | Linked feature | Decision |
   | --- | --- | --- | --- |
   | `served-live` | any | — | live |
   | `deferred` | — | — | deferred |
   | `served-faked` | `fakeReason` | — | accept |
   | `served-faked` | `feature` | `blockedBy: pin` | pin |
   | `served-faked` | `feature` | not verified, not pin | in progress |
   | `served-faked` | none | — | untriaged |

   An explicit enum would duplicate the status and could disagree with it;
   deriving keeps one source of truth, the same reasoning that kept `action`
   out of `statuses.json` in `add-compat-burndown`.

2. **Untriaged is a queue, not a failure.** A crosscheck that failed on every
   untriaged route would turn the suite red the moment this change lands (21
   rows) and would push the next agent to invent `fakeReason`s to get green —
   the gaming the triage is meant to prevent. The suite fails only on
   malformed triage (proposal — What Changes); progress is the burndown count
   and the `/goal` check script.

3. **A `feature` link is the only way a route becomes live work.** "Live"
   always needs a capability feature row, because a feature row is what the
   existing capability branch implements and verifies. The crosscheck rule "a
   verified, unblocked linked feature implies `served-live`" closes the loop
   from the feature side, so a capability change cannot verify the feature
   and forget the route.

4. **The sandbox is a valid data source.** The discovery skill's capability
   test ("both pins support it") read as Maki-only. The rewrite states that a
   route's real data may come from the Maki wire at the pin or from the
   sandbox environment through the OpenShell exec transport. Security
   invariants hold: the bridge reads no host path on the client's behalf, adds
   no bind mount, and reaches sandbox state only through the transport it
   already uses (`bin/maki-oss`).

5. **`fakeReason` must justify the fake, not the cost of the real thing.**
   The skill text states it: a valid reason explains why synthesized data is
   correct (e.g. `GET /api/info` must report the pinned server version so the
   TUI does not warn). "No Maki counterpart" or "needs sandbox plumbing" is a
   reason to link a feature, not to accept.

6. **Skills are rewritten with the `writing-skills` method.** Baseline first:
   a subagent given the current `running-feature-discovery` text and a
   reachable fake such as `GET /api/vcs` is expected to classify it as
   accept/scope statement; that transcript is recorded in
   `evidence/skill-baseline.md`. The rewrite is accepted only when the same
   prompt against the new text triages `GET /api/vcs` as live with a
   sandbox-sourced capability row and `GET /api/info` as accept with a reason
   that justifies the fake, recorded in `evidence/skill-after.md`.

7. **Report shape.** The reachable route table gains a Decision column using
   the table above; accepted rows show their reason and linked rows show the
   feature id. The burndown adds "untriaged reachable routes: N" and a "Next
   routes" list (first three untriaged, in status-file order), after the
   feature Next list.

## Risks / Trade-offs

- [An agent satisfies the queue with weak `fakeReason`s] → Skill rule 5, the
  `/goal` requirement to print every decision with its reason, and review of
  the final route table.
- [A capture refresh adds reachable routes] → they arrive untriaged and show
  in the burndown; no suite failure, same as today's measured-route rule.
- [A `feature` link to an out-of-scope feature row] → allowed only for
  pin-blocked records; the crosscheck rejects a link to a missing row, and
  the skill states a live route's feature must be reachable.
- [Flipping `interrupt` to reachable changes the burndown denominator to 33]
  → intended: the requirement already defines live routes as reachable.

## Migration Plan

Additive: existing rows stay valid without the new fields. Rollback is a
revert of the change commit; no runtime behavior depends on it.
