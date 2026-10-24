#!/usr/bin/env bun
// Render docs/compatibility.md from the machine-readable status file and the
// defect inventory (design decision 4): a feature whose inventory entry is
// still open is forced to `buggy`, so the report cannot disagree with the
// inventory. Every row must carry an evidence key. A feature row whose
// evidence reaches a fixture authored from the pin (provenance.json) gets a
// provenance note in its Evidence cell; no status ever changes for it.
//
//   bun scripts/gen-compat.ts           write docs/compatibility.md
//   bun scripts/gen-compat.ts --check   exit 1 when the committed file differs
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), "utf8");
const REPORT = "docs/compatibility.md";

const ROUTE_STATUS = ["served-live", "served-faked", "deferred", "unhandled"];
const FEATURE_STATUS = ["verified", "unverified", "degraded", "buggy"];
const SCOPES = ["reachable", "out-of-scope"];
const BLOCKERS = ["pin", "none"];
const JOURNEY_STATUS = ["unrecorded", "referenced", "parity", "diverges", "broken"];
const AREAS = ["session", "prompt", "permission", "navigation", "model", "tools", "files", "config"];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface EvidenceRow {
  evidence: string;
  [key: string]: unknown;
}
interface Defect {
  id: string;
  status: string;
}
interface Checkpoint {
  id: string;
  after: number;
  expect: string;
}
interface AcceptedDiff {
  checkpoint: string;
  reason: string;
}
interface Journey {
  slug: string;
  name: string;
  description: string;
  area: string;
  source: string;
  scenario?: { steps?: string[]; checkpoints?: Checkpoint[] };
  routes?: string[];
  features?: string[];
  scope: string;
  blockedBy: string;
  status: string;
  evidence?: Record<string, string>;
  acceptedDiffs?: AcceptedDiff[];
  reason?: string;
  pinCitation?: string;
}

const statuses = JSON.parse(read("bridge/compat/statuses.json"));
const defects: Defect[] = JSON.parse(read("bridge/defects.json"));
const journeys: Journey[] = JSON.parse(read("bridge/compat/journeys.json")).journeys ?? [];
const isOpen = (id: string) => defects.some((d) => d.id === id && d.status === "known");
const effectiveStatus = (f: EvidenceRow) =>
  f.defect && isOpen(String(f.defect)) ? "buggy" : String(f.status);

const provenance: Record<string, { kind: string; note: string }> = JSON.parse(
  read("bridge/test/fixtures/provenance.json"),
);
// A captured fixture adds nothing to the claim; only authored/mixed shapes
// narrow it, which is what the report needs to say out loud.
const sourceDerived = Object.entries(provenance).filter(([, p]) => p.kind !== "captured");

// Whole fixture names only: `maki-stream-live` must not count as a mention of
// the authored `maki-stream`.
const mentions = (src: string, fixture: string) => {
  const base = fixture.replace(/\.[^.]+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w-])${base}([^\\w-]|$)`).test(src);
};

const provenanceNote = (evidence: string): string => {
  if (!evidence.startsWith("bridge/test/") || evidence.includes("/fixtures/")) return "";
  let src: string;
  try {
    src = read(evidence);
  } catch {
    return ""; // a missing evidence file is crosscheck.test.ts's failure to report
  }
  return sourceDerived
    .filter(([file]) => mentions(src, file))
    .map(([file, p]) =>
      p.kind === "authored"
        ? `wire shape source-derived: \`${file}\` is ${p.kind} (${p.note})`
        : `\`${file}\` is ${p.kind} (${p.note})`,
    )
    .join("; ");
};

const failures: string[] = [];
const need = (cond: boolean, msg: string) => {
  if (!cond) failures.push(msg);
};

const featureById = new Map((statuses.features as EvidenceRow[]).map((f) => [String(f.id), f]));
for (const r of statuses.routes as EvidenceRow[]) {
  need(Boolean(r.evidence), `route ${r.route}: missing evidence key`);
  need(ROUTE_STATUS.includes(String(r.status)), `route ${r.route}: unknown status ${r.status}`);
  need(SCOPES.includes(String(r.scope)), `route ${r.route}: unknown scope ${r.scope}`);
  need(BLOCKERS.includes(String(r.blockedBy)), `route ${r.route}: unknown blockedBy ${r.blockedBy}`);
  if (r.feature !== undefined) {
    need(featureById.has(String(r.feature)), `route ${r.route}: unknown feature ${r.feature}`);
  }
  if (r.fakeReason !== undefined) {
    need(
      typeof r.fakeReason === "string" && r.fakeReason.trim().length > 0,
      `route ${r.route}: fakeReason must be a non-empty string`,
    );
    need(
      r.status === "served-faked",
      `route ${r.route}: fakeReason on a ${r.status} row`,
    );
  }
  need(
    !(r.feature !== undefined && r.fakeReason !== undefined),
    `route ${r.route}: carries both feature and fakeReason`,
  );
}
for (const f of statuses.features as EvidenceRow[]) {
  need(Boolean(f.evidence), `feature ${f.id}: missing evidence key`);
  need(FEATURE_STATUS.includes(String(f.status)), `feature ${f.id}: unknown status ${f.status}`);
  need(SCOPES.includes(String(f.scope)), `feature ${f.id}: unknown scope ${f.scope}`);
  need(BLOCKERS.includes(String(f.blockedBy)), `feature ${f.id}: unknown blockedBy ${f.blockedBy}`);
  if (f.defect) {
    need(
      defects.some((d) => d.id === f.defect),
      `feature ${f.id}: unknown inventory entry ${f.defect}`,
    );
  }
  if (f.caveat !== undefined) {
    need(typeof f.caveat === "string" && f.caveat.length > 0, `feature ${f.id}: caveat must be a non-empty string`);
  }
}
for (const v of statuses.versions as EvidenceRow[]) {
  need(Boolean(v.evidence), `version row ${v.component}: missing evidence key`);
}

// Journey catalog (add-tui-journey-catalog): the same generator validates it,
// so the report cannot disagree with the rows it renders.
const nonEmpty = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const seenSlugs = new Set<string>();
for (const j of journeys) {
  const id = nonEmpty(j.slug) ? j.slug : "(missing slug)";
  need(SLUG.test(String(j.slug)), `journey ${id}: slug must be kebab-case`);
  need(!seenSlugs.has(String(j.slug)), `journey ${id}: duplicate slug`);
  seenSlugs.add(String(j.slug));
  need(nonEmpty(j.name), `journey ${id}: missing name`);
  need(nonEmpty(j.description), `journey ${id}: missing description`);
  need(nonEmpty(j.source), `journey ${id}: missing source`);
  need(AREAS.includes(String(j.area)), `journey ${id}: unknown area ${j.area}`);
  need(SCOPES.includes(String(j.scope)), `journey ${id}: unknown scope ${j.scope}`);
  need(BLOCKERS.includes(String(j.blockedBy)), `journey ${id}: unknown blockedBy ${j.blockedBy}`);
  need(JOURNEY_STATUS.includes(String(j.status)), `journey ${id}: unknown status ${j.status}`);
  need(j.evidence !== undefined && typeof j.evidence === "object", `journey ${id}: missing evidence`);
  need(Array.isArray(j.routes), `journey ${id}: routes must be an array`);
  need(Array.isArray(j.features), `journey ${id}: features must be an array`);
  need(Array.isArray(j.acceptedDiffs), `journey ${id}: acceptedDiffs must be an array`);
  if (j.scope === "out-of-scope") {
    need(nonEmpty(j.reason), `journey ${id}: out-of-scope rows need a reason`);
  }
  if (j.blockedBy === "pin") {
    need(nonEmpty(j.pinCitation), `journey ${id}: blockedBy pin needs a pinCitation`);
  }

  const steps = j.scenario?.steps;
  const checkpoints = j.scenario?.checkpoints;
  need(Array.isArray(steps) && steps.length > 0, `journey ${id}: scenario needs at least one step`);
  need(
    Array.isArray(steps) && steps.every(nonEmpty),
    `journey ${id}: every scenario step must be a non-empty string`,
  );
  need(Array.isArray(checkpoints) && checkpoints.length > 0, `journey ${id}: scenario needs at least one checkpoint`);
  const checkpointIds = new Set<string>();
  for (const c of checkpoints ?? []) {
    const cid = nonEmpty(c.id) ? c.id : "(missing checkpoint id)";
    need(nonEmpty(c.id), `journey ${id}: checkpoint needs an id`);
    need(!checkpointIds.has(String(c.id)), `journey ${id}: duplicate checkpoint ${cid}`);
    checkpointIds.add(String(c.id));
    need(
      Number.isInteger(c.after) && c.after >= 1 && c.after <= (steps?.length ?? 0),
      `journey ${id}: checkpoint ${cid} has an out-of-range after`,
    );
    need(nonEmpty(c.expect), `journey ${id}: checkpoint ${cid} needs an expected screen`);
  }
  const diffCheckpoints = new Set<string>();
  for (const d of j.acceptedDiffs ?? []) {
    need(
      checkpointIds.has(String(d.checkpoint)),
      `journey ${id}: acceptedDiff names unknown checkpoint ${d.checkpoint}`,
    );
    need(nonEmpty(d.reason), `journey ${id}: acceptedDiff ${d.checkpoint} needs a reason`);
    need(!diffCheckpoints.has(String(d.checkpoint)), `journey ${id}: duplicate acceptedDiff ${d.checkpoint}`);
    diffCheckpoints.add(String(d.checkpoint));
  }
}

if (failures.length) {
  console.error(`gen-compat: compatibility data is invalid:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}

const md = (s: unknown) => String(s).replace(/\|/g, "\\|");
const link = (path: string, label = path) => `[\`${label}\`](../${path})`;

// Derive each route's decision from its status and triage fields (design
// decision 1) so the column cannot disagree with the status beside it.
const routeDecision = (r: EvidenceRow): string => {
  if (r.status === "served-live") {
    return r.feature === undefined ? "live" : `live — \`${md(r.feature)}\``;
  }
  if (r.status !== "served-faked") return String(r.status); // deferred, unhandled
  if (r.fakeReason !== undefined) return `accept — ${md(r.fakeReason)}`;
  if (r.feature === undefined) return "untriaged";
  const pin = featureById.get(String(r.feature))?.blockedBy === "pin";
  return `${pin ? "pin" : "in progress"} — \`${md(r.feature)}\``;
};

const lines: string[] = [];
lines.push("# OpenCode TUI bridge — compatibility");
lines.push("");
lines.push(
  "Generated from `bridge/compat/statuses.json`, `bridge/compat/journeys.json` and " +
    "`bridge/defects.json` by `scripts/gen-compat.ts`. Do not edit by hand — run " +
    "`make compat` to regenerate and `make compat-drift` to check the pinned contract " +
    "against the installed OpenCode.",
);
lines.push("");

const reachableRoutes = (statuses.routes as EvidenceRow[]).filter((r) => r.scope === "reachable");
const reachableFeatures = (statuses.features as EvidenceRow[]).filter((f) => f.scope === "reachable");
const withStatus = (rows: EvidenceRow[], status: string) => rows.filter((r) => r.status === status);
const pinBlocked = (rows: EvidenceRow[]) => rows.filter((r) => r.blockedBy === "pin").length;

lines.push("## Burndown");
lines.push("");
lines.push(
  `Reachable surface: **${reachableRoutes.length} of ${statuses.routes.length} routes** ` +
    `(${ROUTE_STATUS.map((s) => `${withStatus(reachableRoutes, s).length} \`${s}\``).join(", ")}) ` +
    `and **${reachableFeatures.length} of ${statuses.features.length} features** ` +
    `(${FEATURE_STATUS.map((s) => {
      const rows = reachableFeatures.filter((f) => effectiveStatus(f) === s);
      const pin = pinBlocked(rows);
      return `${rows.length} \`${s}\`${pin ? ` (${pin} pin-blocked)` : ""}`;
    }).join(", ")}). ` +
    `Out of scope: ${statuses.routes.length - reachableRoutes.length} routes, ` +
    `${statuses.features.length - reachableFeatures.length} feature` +
    `${statuses.features.length - reachableFeatures.length === 1 ? "" : "s"}. ` +
    `Open defects: **${defects.filter((d) => d.status !== "fixed").length}**.`,
);
lines.push("");
const candidates = reachableFeatures.filter(
  (f) => effectiveStatus(f) !== "verified" && f.blockedBy !== "pin",
);
const next = candidates.slice(0, 3);
if (next.length) {
  lines.push(
    `Next (first ${next.length} of ${candidates.length} reachable, unblocked, not \`verified\`; ids match the feature tables):`,
  );
  lines.push("");
  next.forEach((f, i) => {
    lines.push(`${i + 1}. \`${f.id}\` — ${md(f.title)} (\`${effectiveStatus(f)}\`)`);
  });
  lines.push("");
}

// Route triage (add-route-triage): a reachable fake is debt until it carries a
// decision, so the untriaged ones are the second queue next to the feature one.
const untriaged = reachableRoutes.filter((r) => routeDecision(r) === "untriaged");
lines.push(`Untriaged reachable routes: **${untriaged.length}**.`);
lines.push("");
if (untriaged.length) {
  const nextRoutes = untriaged.slice(0, 3);
  lines.push(
    `Next routes (first ${nextRoutes.length} of ${untriaged.length} untriaged reachable, in status-file order):`,
  );
  lines.push("");
  nextRoutes.forEach((r, i) => lines.push(`${i + 1}. \`${md(r.route)}\``));
  lines.push("");
}

lines.push("## Served routes");
lines.push("");
lines.push(
  "Statuses: `served-live` (real state behind the route), `served-faked` " +
    "(answered from the pinned spec with synthesized values), `deferred` " +
    "(spec-valid minimal answer, surface not implemented), `unhandled` " +
    "(outside the pinned contract: answered 404).",
);
lines.push("");
// Split by scope so each table reconciles with the burndown counts; within a
// table, group by status (stable, so the status file's order survives).
const byStatus = (order: string[], status: (r: EvidenceRow) => string) => (rows: EvidenceRow[]) =>
  [...rows].sort((a, b) => order.indexOf(status(a)) - order.indexOf(status(b)));
const scoped = (rows: EvidenceRow[], scope: string) => rows.filter((r) => r.scope === scope);
const scopeHeading = (scope: string, n: number) =>
  `### ${scope === "reachable" ? "Reachable" : "Out of scope"} (${n})`;

for (const scope of SCOPES) {
  const rows = byStatus(ROUTE_STATUS, (r) => String(r.status))(scoped(statuses.routes, scope));
  lines.push(scopeHeading(scope, rows.length));
  lines.push("");
  // Only reachable rows carry a decision (add-route-triage); out-of-scope rows
  // are already excluded from the queue they would feed.
  const decision = scope === "reachable";
  lines.push(decision ? "| Route | Status | Decision | Evidence |" : "| Route | Status | Evidence |");
  lines.push(decision ? "| --- | --- | --- | --- |" : "| --- | --- | --- |");
  for (const r of rows) {
    const tail = decision ? ` ${routeDecision(r)} |` : "";
    lines.push(`| \`${md(r.route)}\` | \`${r.status}\` |${tail} ${link(r.evidence)} |`);
  }
  lines.push("");
}

lines.push("## Wire features");
lines.push("");
lines.push(
  "Statuses: `verified` (an offline test or committed fixture proves it), " +
    "`degraded` (works, with a limitation recorded in the evidence), " +
    "`unverified` (no evidence yet), `buggy` (an open inventory entry in " +
    "`bridge/defects.json` forces this status until the fix flips it). " +
    "`pin-blocked` marks a gap that needs an upstream wire change.",
);
lines.push("");

// Many rows share one evidence file and so one provenance note: print each
// note once under the tables and point the rows at it.
const notes: string[] = [];
const noteRef = (note: string) => {
  if (!notes.includes(note)) notes.push(note);
  return `fixture provenance: [note ${notes.indexOf(note) + 1}](#fixture-provenance)`;
};

for (const scope of SCOPES) {
  const rows = byStatus(FEATURE_STATUS, effectiveStatus)(scoped(statuses.features, scope));
  lines.push(scopeHeading(scope, rows.length));
  lines.push("");
  lines.push("| Id | Feature | Status | Evidence |");
  lines.push("| --- | --- | --- | --- |");
  for (const f of rows) {
    const forced = f.defect && isOpen(String(f.defect));
    const status = forced
      ? `\`buggy\` ([${f.defect}](../bridge/defects.json))`
      : `\`${f.status}\``;
    const pin = f.blockedBy === "pin" ? " · pin-blocked" : "";
    const caveat = f.caveat ? ` (${md(f.caveat)})` : "";
    const note = provenanceNote(f.evidence);
    lines.push(
      `| \`${f.id}\` | ${md(f.title)} | ${status}${pin}${caveat} | ${link(f.evidence)}${note ? ` — ${noteRef(note)}` : ""} |`,
    );
  }
  lines.push("");
}

if (notes.length) {
  lines.push("### Fixture provenance");
  lines.push("");
  lines.push("Rows citing these notes are proved against fixtures that were authored or spliced from the pinned source, not captured whole from a live run.");
  lines.push("");
  notes.forEach((n, i) => lines.push(`${i + 1}. ${md(n)}`));
  lines.push("");
}

// Journey lens (add-tui-journey-catalog): the unit the user recognizes. The
// parity score counts reachable journeys only, so an out-of-scope row can never
// inflate or deflate the claim.
const reachableJourneys = journeys.filter((j) => j.scope === "reachable");
const parityJourneys = reachableJourneys.filter((j) => j.status === "parity");
const parityScore = reachableJourneys.length
  ? `${((100 * parityJourneys.length) / reachableJourneys.length).toFixed(1)}%`
  : "n/a";
lines.push("## Journeys");
lines.push("");
lines.push(
  "Statuses: `unrecorded` (no reference recording yet), `referenced` (a reference " +
    "recording of real OpenCode exists, the Maki side is not yet compared), `parity` " +
    "(both sides match at every checkpoint), `diverges` (the journey completes with at " +
    "least one differing checkpoint), `broken` (the Maki side cannot complete it).",
);
lines.push("");
lines.push(
  `Reachable journeys: **${reachableJourneys.length} of ${journeys.length}** ` +
    `(${JOURNEY_STATUS.map(
      (s) => `${reachableJourneys.filter((j) => j.status === s).length} \`${s}\``,
    ).join(", ")}). Native parity score: **${parityScore}** ` +
    `(${parityJourneys.length} of ${reachableJourneys.length} reachable journeys at \`parity\`).`,
);
lines.push("");
for (const scope of SCOPES) {
  const rows = [...journeys.filter((j) => j.scope === scope)].sort(
    (a, b) => JOURNEY_STATUS.indexOf(a.status) - JOURNEY_STATUS.indexOf(b.status),
  );
  lines.push(scopeHeading(scope, rows.length));
  lines.push("");
  lines.push("| Slug | Journey | Area | Status | Evidence | Accepted differences |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const j of rows) {
    const evidence =
      Object.entries(j.evidence ?? {})
        .map(([kind, p]) => `${kind}: ${link(String(p))}`)
        .join(" · ") || "—";
    const accepted =
      (j.acceptedDiffs ?? [])
        .map((d) => `${md(d.checkpoint)}: ${md(d.reason)}`)
        .join("; ") || "—";
    lines.push(
      `| \`${md(j.slug)}\` | ${md(j.name)} | ${md(j.area)} | \`${j.status}\` | ${evidence} | ${accepted} |`,
    );
  }
  lines.push("");
}

lines.push("## Version matrix");
lines.push("");
lines.push("| Component | Pinned | Evidence |");
lines.push("| --- | --- | --- |");
for (const v of statuses.versions) {
  lines.push(`| ${md(v.component)} | ${md(v.value)} | ${link(v.evidence)} |`);
}
lines.push("");

const rendered = lines.join("\n");

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(new URL(REPORT, ROOT), "utf8");
  } catch {
    console.error(`gen-compat: ${REPORT} is missing — run \`bun scripts/gen-compat.ts\``);
    process.exit(1);
  }
  if (current !== rendered) {
    console.error(`gen-compat: ${REPORT} differs from the regenerated report — run \`make compat\` and commit it`);
    process.exit(1);
  }
  console.log(`gen-compat: ${REPORT} matches the regenerated report`);
} else {
  writeFileSync(new URL(REPORT, ROOT), rendered);
  console.log(`gen-compat: wrote ${REPORT}`);
}
