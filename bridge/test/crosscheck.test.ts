// Cross-check test (design decision 5): tests, statuses, and the inventory
// are cross-checked, not auto-synced. Flipping a status or closing a defect
// stays a human edit, but it must stay consistent: verified statuses name an
// existing test or fixture, every evidence key resolves, inventory entries
// name an existing capture, and expected-failure markers pair with open
// entries in both directions, and every fixture carries a recorded provenance.
// The same pass enforces the compatibility scope: every row declares
// scope/blockedBy, and every route measured in the committed captures is
// recorded as reachable.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";

const ROOT = new URL("../..", import.meta.url); // repository root (from bridge/test/)
const path = (rel: string) => fileURLToPath(new URL(rel, ROOT));

interface Defect {
  id: string;
  status: string;
  capture: string;
  golden?: { fixture: string; want: string };
  expectedFailure?: boolean;
}
interface Row {
  evidence: string;
  status?: string;
  [key: string]: unknown;
}
interface Statuses {
  routes: Row[];
  features: Row[];
  versions: Row[];
}

const defects: Defect[] = JSON.parse(readFileSync(path("bridge/defects.json"), "utf8"));
const statuses: Statuses = JSON.parse(readFileSync(path("bridge/compat/statuses.json"), "utf8"));
const rows = [...statuses.routes, ...statuses.features, ...statuses.versions];

const SCOPES = ["reachable", "out-of-scope"];
const BLOCKERS = ["pin", "none"];
const CAPTURES = [
  "bridge/test/captures/tui-last-requests.jsonl",
  "bridge/test/fixtures/bridge-requests.jsonl",
];
const normalizeRoute = (p: string) =>
  p.replace(/\/ses_[^/]+/g, "/{sessionID}").replace(/\/per_[^/]+/g, "/{requestID}");

const measuredRoutes = new Set<string>();
for (const file of CAPTURES) {
  for (const line of readFileSync(path(file), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { method: string; path: string };
    measuredRoutes.add(`${row.method} ${normalizeRoute(row.path)}`);
  }
}

const isTestOrFixture = (evidence: string) =>
  evidence.includes(".test.") ||
  evidence.startsWith("bridge/test/") ||
  evidence.startsWith("tests/");

test("every evidence key on every row points at an existing file", () => {
  const missing = rows.filter((r) => !existsSync(path(r.evidence))).map((r) => r.evidence);
  expect(missing).toEqual([]);
});

test("every verified feature names an existing test or fixture", () => {
  const bad = statuses.features
    .filter((f) => f.status === "verified")
    .filter((f) => !isTestOrFixture(f.evidence))
    .map((f) => `${f.evidence} (feature ${f.id})`);
  expect(bad).toEqual([]);
});

// Fixture provenance (add-evidence-strength-tier): the record must stay
// complete in both directions, so a new fixture can never silently inherit
// the stronger `captured` claim, and a removed fixture cannot leave a ghost.
test("every fixture has a provenance entry, and every entry names a fixture", () => {
  const dir = path("bridge/test/fixtures");
  const onDisk = readdirSync(dir)
    .filter((f) => f !== "provenance.json")
    .sort();
  const provenance: Record<string, { kind: string }> = JSON.parse(
    readFileSync(path("bridge/test/fixtures/provenance.json"), "utf8"),
  );

  const unlisted = onDisk.filter((f) => !(f in provenance));
  expect(unlisted, "fixtures with no provenance entry").toEqual([]);

  const stale = Object.keys(provenance)
    .filter((f) => !onDisk.includes(f))
    .sort();
  expect(stale, "provenance entries naming a missing fixture").toEqual([]);

  const badKind = Object.entries(provenance)
    .filter(([, v]) => !["captured", "authored", "mixed"].includes(v.kind))
    .map(([f, v]) => `${f}: kind ${v.kind}`);
  expect(badKind, "provenance entries with an unknown kind").toEqual([]);
});

test("every inventory entry names an existing capture", () => {
  const missing = defects.filter((d) => !existsSync(path(d.capture))).map((d) => d.id);
  expect(missing).toEqual([]);
});

test("expected-failure markers pair with open inventory entries, both ways", () => {
  const problems: string[] = [];
  for (const d of defects) {
    const open = d.status === "known";
    if (d.expectedFailure && !open) problems.push(`${d.id}: marker present but status is ${d.status}`);
    if (d.expectedFailure && !d.golden) problems.push(`${d.id}: marker present but no golden`);
    if (d.expectedFailure && d.golden && !existsSync(path(`bridge/test/${d.golden.want}`))) {
      problems.push(`${d.id}: desired golden missing: ${d.golden.want}`);
    }
    if (open && d.golden && !d.expectedFailure) {
      problems.push(`${d.id}: open with a desired golden but no expected-failure marker`);
    }
  }
  expect(problems).toEqual([]);
});

test("every desired golden is claimed by exactly one inventory entry", () => {
  const dir = fileURLToPath(new URL("./golden", import.meta.url));
  const onDisk = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.startsWith("want-"))
        .map((f) => `golden/${f}`)
    : [];
  const claimed = defects.filter((d) => d.golden).map((d) => d.golden!.want);
  expect(onDisk.slice().sort()).toEqual(claimed.slice().sort());
});

test("open inventory entries and their features are linked", () => {
  for (const f of statuses.features.filter((x) => x.defect)) {
    const entry = defects.find((d) => d.id === f.defect);
    expect(entry, `unknown inventory entry ${f.defect}`).toBeDefined();
  }
});

// Compatibility scope (add-compat-burndown): the report's denominator is the
// reachable surface, so the fields it counts by must be valid on every row and
// must agree with the committed traffic captures.
test("every route and feature row declares scope and blockedBy", () => {
  const bad = [...statuses.routes, ...statuses.features]
    .filter(
      (r) =>
        !SCOPES.includes(String(r.scope)) || !BLOCKERS.includes(String(r.blockedBy)),
    )
    .map(
      (r) =>
        `${String(r.route ?? r.id)}: scope=${String(r.scope)} blockedBy=${String(r.blockedBy)}`,
    );
  expect(bad).toEqual([]);
});

test("every measured route is recorded as reachable", () => {
  const byRoute = new Map<string, Row>(
    statuses.routes.map((r): [string, Row] => [String(r.route), r]),
  );
  const problems = [...measuredRoutes].flatMap((route) => {
    const row = byRoute.get(route);
    if (!row) return [`${route}: no status row`];
    if (row.scope !== "reachable") return [`${route}: scope=${String(row.scope)}`];
    return [];
  });
  expect(problems).toEqual([]);
  expect(measuredRoutes.size).toBeGreaterThan(0);
});

test("the SSE stream stays live and outside the HTTP capture tally", () => {
  const event = statuses.routes.find((r) => r.route === "GET /api/event");
  expect(event?.status).toBe("served-live");
  expect(event?.scope).toBe("reachable");
  // SSE opens before dispatch and never reaches the request log; if a capture
  // ever records it, this assertion is the prompt to revisit the tally.
  expect(measuredRoutes.has("GET /api/event")).toBe(false);
});
