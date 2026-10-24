// Line-preserving writes to the journey catalog. The catalog is hand-formatted
// one row per object, so a full JSON rewrite would bury a one-key change in a
// thousand-line diff. Each helper edits only its row's line.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CATALOG = fileURLToPath(new URL("../../../compat/journeys.json", import.meta.url));

function rowRange(lines: string[], slug: string): [number, number] {
  const at = lines.findIndex((line) => line.includes(`"slug": "${slug}"`));
  if (at < 0) throw new Error(`catalog has no journey ${slug}`);
  let start = at;
  while (start > 0 && !/^    \{$/.test(lines[start])) start--;
  let end = at;
  while (end < lines.length && !/^    \},?$/.test(lines[end])) end++;
  return [start, end];
}

export function updateJourneyStatus(slug: string, status: string): void {
  const lines = readFileSync(CATALOG, "utf8").split("\n");
  const [start, end] = rowRange(lines, slug);
  let sawStatus = false;
  for (let i = start; i <= end; i++) {
    if (/^\s*"status":/.test(lines[i])) {
      lines[i] = `      "status": "${status}",`;
      sawStatus = true;
    }
  }
  if (!sawStatus) throw new Error(`catalog journey ${slug} has no status line`);
  writeFileSync(CATALOG, lines.join("\n"));
}

export function updateJourneyEvidence(slug: string, evidence: Record<string, unknown>): void {
  const lines = readFileSync(CATALOG, "utf8").split("\n");
  const [start, end] = rowRange(lines, slug);
  for (let i = start; i <= end; i++) {
    const match = /^\s*"evidence":\s*(\{.*\}),?\s*$/.exec(lines[i]);
    if (match) {
      // Merge so an offline re-record keeps the live evidence beside it.
      const merged = { ...JSON.parse(match[1]), ...evidence };
      lines[i] = `      "evidence": { ${compact(merged)} },`;
      writeFileSync(CATALOG, lines.join("\n"));
      return;
    }
  }
  throw new Error(`catalog journey ${slug} has no evidence line`);
}

/** Sets (or replaces) the `live` key inside an existing evidence object. */
export function updateJourneyLive(slug: string, live: Record<string, unknown>): void {
  const lines = readFileSync(CATALOG, "utf8").split("\n");
  const [start, end] = rowRange(lines, slug);
  for (let i = start; i <= end; i++) {
    const match = /^\s*"evidence":\s*(\{.*\}),?\s*$/.exec(lines[i]);
    if (match) {
      const evidence = JSON.parse(match[1]) as Record<string, unknown>;
      evidence.live = live;
      lines[i] = `      "evidence": { ${compact(evidence)} },`;
      writeFileSync(CATALOG, lines.join("\n"));
      return;
    }
  }
  throw new Error(`catalog journey ${slug} has no evidence line`);
}

const compact = (value: Record<string, unknown>) =>
  Object.entries(value)
    .map(([key, item]) => `"${key}":${JSON.stringify(item)}`)
    .join(",");

/** The catalog row for one journey, as currently committed. */
export function journeyRow(slug: string): Record<string, any> {
  const journeys = JSON.parse(readFileSync(CATALOG, "utf8")).journeys ?? [];
  const row = journeys.find((j: { slug?: string }) => j.slug === slug);
  if (!row) throw new Error(`catalog has no journey ${slug}`);
  return row;
}
