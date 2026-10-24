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
interface JourneyCheckpoint {
  id: string;
  after: number;
  expect: string;
}
interface Journey {
  slug: string;
  status: string;
  scope: string;
  evidence?: Record<string, string>;
  scenario?: { steps?: string[]; checkpoints?: JourneyCheckpoint[] };
  routes?: string[];
  features?: string[];
  acceptedDiffs?: Array<{ checkpoint: string; reason: string }>;
  reason?: string;
}

const defects: Defect[] = JSON.parse(readFileSync(path("bridge/defects.json"), "utf8"));
const statuses: Statuses = JSON.parse(readFileSync(path("bridge/compat/statuses.json"), "utf8"));
const journeys: Journey[] = JSON.parse(readFileSync(path("bridge/compat/journeys.json"), "utf8")).journeys ?? [];
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

// A route the bridge serves live is on the reachable surface by definition
// (add-route-triage): an out-of-scope live row understates the denominator.
test("every served-live route is reachable", () => {
  const bad = statuses.routes
    .filter((r) => r.status === "served-live" && r.scope !== "reachable")
    .map((r) => `${String(r.route)}: scope=${String(r.scope)}`);
  expect(bad).toEqual([]);
});

// Route triage (add-route-triage): a route's decision is derived from its
// status and the feature it links, so the suite rejects malformed links and an
// inconsistent status — but never missing triage, which is a queue.
test("route triage fields are well formed", () => {
  const featureIds = new Set(statuses.features.map((f) => String(f.id)));
  const problems: string[] = [];
  for (const r of statuses.routes) {
    if (r.feature !== undefined && !featureIds.has(String(r.feature))) {
      problems.push(`${String(r.route)}: unknown feature ${r.feature}`);
    }
    if (r.fakeReason !== undefined) {
      if (typeof r.fakeReason !== "string" || r.fakeReason.trim() === "") {
        problems.push(`${String(r.route)}: fakeReason must be a non-empty string`);
      }
      if (r.status !== "served-faked") {
        problems.push(`${String(r.route)}: fakeReason on a ${String(r.status)} row`);
      }
    }
    if (r.feature !== undefined && r.fakeReason !== undefined) {
      problems.push(`${String(r.route)}: carries both feature and fakeReason`);
    }
  }
  expect(problems).toEqual([]);
});

test("a verified, unblocked linked feature makes its route live", () => {
  const byId = new Map(statuses.features.map((f) => [String(f.id), f]));
  const problems = statuses.routes.flatMap((r) => {
    if (r.feature === undefined) return [];
    const feature = byId.get(String(r.feature));
    if (!feature) return []; // reported by the well-formed test
    const verified = feature.status === "verified" && feature.blockedBy !== "pin";
    if (verified && r.status !== "served-live") {
      return [`${String(r.route)}: feature ${String(feature.id)} is verified but route is ${String(r.status)}`];
    }
    return [];
  });
  expect(problems).toEqual([]);
});

test("the SSE stream stays live and outside the HTTP capture tally", () => {
  const event = statuses.routes.find((r) => r.route === "GET /api/event");
  expect(event?.status).toBe("served-live");
  expect(event?.scope).toBe("reachable");
  // SSE opens before dispatch and never reaches the request log; if a capture
  // ever records it, this assertion is the prompt to revisit the tally.
  expect(measuredRoutes.has("GET /api/event")).toBe(false);
});

// Journey catalog (add-tui-journey-catalog): a journey is only a claim about
// the user's experience, so its links must resolve and every status past
// `unrecorded` must be backed by committed evidence on both sides.
const COMMITTED = (evidence: string | undefined) => Boolean(evidence) && existsSync(path(String(evidence)));

test("every journey links existing route and feature rows", () => {
  const routeNames = new Set(statuses.routes.map((r) => String(r.route)));
  const featureIds = new Set(statuses.features.map((f) => String(f.id)));
  const problems = journeys.flatMap((j) => [
    ...(j.routes ?? []).filter((r) => !routeNames.has(r)).map((r) => `${j.slug}: unknown route ${r}`),
    ...(j.features ?? []).filter((f) => !featureIds.has(f)).map((f) => `${j.slug}: unknown feature ${f}`),
  ]);
  expect(problems).toEqual([]);
});

test("every journey past unrecorded cites a committed reference snapshot", () => {
  const problems = journeys
    .filter((j) => j.status !== "unrecorded")
    .filter((j) => !COMMITTED(j.evidence?.reference))
    .map((j) => `${j.slug}: status ${j.status} without evidence.reference`);
  expect(problems).toEqual([]);
});

test("every compared journey cites committed Maki-side and diff evidence", () => {
  const problems = journeys
    .filter((j) => ["parity", "diverges", "broken"].includes(j.status))
    .flatMap((j) =>
      (["maki", "diff"] as const)
        .filter((kind) => !COMMITTED(j.evidence?.[kind]))
        .map((kind) => `${j.slug}: status ${j.status} without evidence.${kind}`),
    );
  expect(problems).toEqual([]);
});

test("parity carries no unaccepted checkpoint difference", () => {
  const problems: string[] = [];
  for (const j of journeys) {
    if (j.status !== "parity") continue;
    const checkpoints = new Set((j.scenario?.checkpoints ?? []).map((c) => c.id));
    for (const d of j.acceptedDiffs ?? []) {
      if (!d.reason?.trim()) problems.push(`${j.slug}: accepted difference ${d.checkpoint} has no reason`);
      if (!checkpoints.has(d.checkpoint)) {
        problems.push(`${j.slug}: accepted difference names unknown checkpoint ${d.checkpoint}`);
      }
    }
  }
  expect(problems).toEqual([]);
});

test("a broken journey never accepts a difference", () => {
  const problems = journeys
    .filter((j) => j.status === "broken" && (j.acceptedDiffs?.length ?? 0) > 0)
    .map((j) => `${j.slug}: broken with acceptedDiffs`);
  expect(problems).toEqual([]);
});

test("every out-of-scope journey says why", () => {
  const problems = journeys
    .filter((j) => j.scope === "out-of-scope" && !j.reason?.trim())
    .map((j) => `${j.slug}: out-of-scope without a reason`);
  expect(problems).toEqual([]);
});
