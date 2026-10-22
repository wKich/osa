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

interface EvidenceRow {
  evidence: string;
  [key: string]: unknown;
}
interface Defect {
  id: string;
  status: string;
}

const statuses = JSON.parse(read("bridge/compat/statuses.json"));
const defects: Defect[] = JSON.parse(read("bridge/defects.json"));
const isOpen = (id: string) => defects.some((d) => d.id === id && d.status === "known");

const provenance: Record<string, { kind: string; note: string }> = JSON.parse(
  read("bridge/test/fixtures/provenance.json"),
);
// A captured fixture adds nothing to the claim; only authored/mixed shapes
// narrow it, which is what the report needs to say out loud.
const sourceDerived = Object.entries(provenance).filter(([, p]) => p.kind !== "captured");

const provenanceNote = (evidence: string): string => {
  if (!evidence.startsWith("bridge/test/") || evidence.includes("/fixtures/")) return "";
  let src: string;
  try {
    src = read(evidence);
  } catch {
    return ""; // a missing evidence file is crosscheck.test.ts's failure to report
  }
  return sourceDerived
    .filter(([file]) => src.includes(file.replace(/\.[^.]+$/, "")))
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

for (const r of statuses.routes as EvidenceRow[]) {
  need(Boolean(r.evidence), `route ${r.route}: missing evidence key`);
  need(ROUTE_STATUS.includes(String(r.status)), `route ${r.route}: unknown status ${r.status}`);
}
for (const f of statuses.features as EvidenceRow[]) {
  need(Boolean(f.evidence), `feature ${f.id}: missing evidence key`);
  need(FEATURE_STATUS.includes(String(f.status)), `feature ${f.id}: unknown status ${f.status}`);
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
if (failures.length) {
  console.error(`gen-compat: statuses.json is invalid:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}

const md = (s: unknown) => String(s).replace(/\|/g, "\\|");
const link = (path: string, label = path) => `[\`${label}\`](../${path})`;

const lines: string[] = [];
lines.push("# OpenCode TUI bridge — compatibility");
lines.push("");
lines.push(
  "Generated from `bridge/compat/statuses.json` and `bridge/defects.json` by " +
    "`scripts/gen-compat.ts`. Do not edit by hand — run `make compat` to " +
    "regenerate and `make compat-drift` to check the pinned contract against " +
    "the installed OpenCode.",
);
lines.push("");

lines.push("## Served routes");
lines.push("");
lines.push(
  "Statuses: `served-live` (real state behind the route), `served-faked` " +
    "(answered from the pinned spec with synthesized values), `deferred` " +
    "(spec-valid minimal answer, surface not implemented), `unhandled` " +
    "(outside the pinned contract: answered 404).",
);
lines.push("");
lines.push("| Route | Status | Evidence |");
lines.push("| --- | --- | --- |");
for (const r of statuses.routes) {
  lines.push(`| \`${md(r.route)}\` | \`${r.status}\` | ${link(r.evidence)} |`);
}
lines.push("");

lines.push("## Wire features");
lines.push("");
lines.push(
  "Statuses: `verified` (an offline test or committed fixture proves it), " +
    "`degraded` (works, with a limitation recorded in the evidence), " +
    "`unverified` (no evidence yet), `buggy` (an open inventory entry in " +
    "`bridge/defects.json` forces this status until the fix flips it).",
);
lines.push("");
lines.push("| Feature | Status | Evidence |");
lines.push("| --- | --- | --- |");
for (const f of statuses.features) {
  const forced = f.defect && isOpen(f.defect);
  const status = forced
    ? `\`buggy\` ([${f.defect}](../bridge/defects.json))`
    : `\`${f.status}\``;
  const caveat = f.caveat ? ` (${md(f.caveat)})` : "";
  const note = provenanceNote(f.evidence);
  lines.push(`| ${md(f.title)} | ${status}${caveat} | ${link(f.evidence)}${note ? ` — ${note}` : ""} |`);
}
lines.push("");

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
