#!/usr/bin/env bun
// Route enumeration from the vendored OpenAPI pin (rebaseline design D1/D5).
// The pin is the contract: this reads `bridge/src/openapi-2.0.32.json`, never a
// live re-capture, so a re-run is a no-op between pin bumps.
//
//   bun scripts/enumerate-routes.ts --out <file.md>   write the enumeration
//   bun scripts/enumerate-routes.ts --diff            diff the pin against
//                                                     bridge/compat/statuses.json
//                                                     (non-zero on any mismatch)
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), "utf8");
const PIN = "bridge/src/openapi-2.0.32.json";
const STATUSES = "bridge/compat/statuses.json";

const spec = JSON.parse(read(PIN));
const paths: Record<string, Record<string, unknown>> = spec.paths ?? {};

// One key per operation, `METHOD /path`. `parameters` is a Path Item field, not
// an operation; everything outside `/api/` (the `/auth/connect/{code}` OAuth
// redirect) is not part of the served API surface.
const operations = Object.entries(paths).flatMap(([p, item]) =>
  p.startsWith("/api/")
    ? Object.keys(item)
        .filter((m) => m !== "parameters")
        .map((m) => `${m.toUpperCase()} ${p}`)
    : [],
);
operations.sort();

const routeRows = (JSON.parse(read(STATUSES)).routes ?? []) as { route: string }[];
const recorded = new Set(routeRows.map((r) => r.route));

const missing = operations.filter((op) => !recorded.has(op)); // pin op with no row
const phantom = [...recorded].filter((r) => !operations.includes(r)); // row naming no pin op

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

if (args.includes("--diff")) {
  for (const r of phantom) console.error(`phantom row (absent from the pin): ${r}`);
  for (const op of missing) console.error(`no row for pinned operation: ${op}`);
  console.log(
    `pin: ${operations.length} /api/* operations | rows: ${routeRows.length} | ` +
      `missing a row: ${missing.length} | phantom: ${phantom.length}`,
  );
  process.exit(phantom.length || missing.length ? 1 : 0);
}

const out = flag("--out");
if (!out) {
  console.error("usage: bun scripts/enumerate-routes.ts --out <file.md> | --diff");
  process.exit(2);
}

const md: string[] = [];
md.push("# Route enumeration from the pinned OpenAPI contract");
md.push("");
md.push(
  `Derived from \`${PIN}\` (OpenAPI ${spec.openapi}) — the vendored pin, read ` +
    "directly rather than re-captured live (design D1). Keyed `METHOD /path`, " +
    "one entry per operation the pinned contract defines for the served API " +
    "surface. Paths outside `/api/` are not part of that surface and are " +
    "excluded.",
);
md.push("");
md.push(
  `**${operations.length} operations** · ${routeRows.length} rows in ` +
    `\`${STATUSES}\` · **${missing.length} pinned operations with no row** · ` +
    `**${phantom.length} row naming a route absent from the pin**`,
);
md.push("");
md.push("## Pinned operations");
md.push("");
for (const op of operations) {
  const row = recorded.has(op) ? "recorded" : "**missing a row**";
  md.push(`- \`${op}\` — ${row}`);
}
md.push("");
md.push("## Rows with no pinned operation (phantom)");
md.push("");
if (phantom.length) for (const r of phantom) md.push(`- \`${r}\``);
else md.push("(none)");
md.push("");

writeFileSync(new URL(out, ROOT), md.join("\n"));
console.log(`wrote ${out}: ${operations.length} operations, ${missing.length} missing a row, ${phantom.length} phantom`);
