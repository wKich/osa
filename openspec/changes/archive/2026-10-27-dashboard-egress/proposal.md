# Proposal

## Why

Egress is deny-by-default, so the first sign that an agent needs a new endpoint is a denial in the sandbox log. The policy advisor turns some denials into rule proposals, and the dashboard already lists those, but it shows a proposal without the traffic behind it, and it does not show denials that produced no proposal at all. Reviewing a rule means opening the log view, filtering by eye, and matching hosts by hand. M3 puts the evidence next to the decision.

## What Changes

- Read recent **network denials** for a sandbox from `openshell logs <name> --since <window> --source sandbox` and parse the OCSF shorthand lines (`[OCSF ] [ocsf] NET:… [SEV] DENIED …`). Group them by destination host, port, and binary, with a count, first and last seen, and the `reason:` values.
- In the **Rules view**, show the denial groups that match each pending proposal's endpoints (and binaries, when both sides name one) under that proposal. Denials that match no pending proposal are listed separately as "denied, no proposal".
- Add a **denied count** badge on the inventory row and the project row: the number of denial groups in the window that have no pending proposal.
- Let the user pick the window (15 minutes, 1 hour, 6 hours; default 1 hour). Refresh on demand and when the Rules view opens; no background polling of logs.
- The denials route requires the session token, like the log stream, because it exposes log content.

Out of scope: approving a rule from a denial that has no proposal (writing new policy is not a review action), reading the OCSF JSON export files (`openshell sandbox exec` cannot reach them, per upstream), and gateway-side `CONFIG:*` events.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `dashboard`: ADDED "Egress denials" and "Denials beside rule proposals".

## Impact

- `dashboard/src/openshell.ts`: a bounded one-shot `logs` call and an OCSF shorthand parser.
- `dashboard/src/egress.ts` (new): grouping, proposal matching, per-sandbox cache.
- `dashboard/src/server.ts`: `GET /api/sandboxes/:name/denials`.
- `dashboard/src/app/rules.js`, `inventory.js`, `projects.js`: denial groups and badges.
- `dashboard/test/stub/openshell`, tests, `scripts/browser-check.ts`: denial log fixtures and one journey.
- `dashboard/README.md`: the egress view and its limits.
- No new network endpoints, bind mounts, or secret paths. Nothing is written.

Upstream behavior this depends on: the OCSF shorthand denial format in [Accessing logs](https://docs.nvidia.com/openshell/observability/accessing-logs.md) and the denial fields in [OCSF JSON export](https://docs.nvidia.com/openshell/observability/ocsf-json-export.md); the policy advisor's proposals in [Policy advisor](https://docs.nvidia.com/openshell/how-it-works/policies/advisor.md).
