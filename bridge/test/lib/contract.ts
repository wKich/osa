// Contract + wire validation, ported from the archived harness
// (evidence/harness/validate-bridge.mjs): bridge response bodies against the
// vendored OpenAPI 2.0.32, and the measured SSE wire rules. OpenAPI 3.1 is
// JSON Schema 2020-12, so ajv/dist/2020 — not draft-07.
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

export const spec = JSON.parse(readFileSync(new URL("../../src/openapi-2.0.32.json", import.meta.url), "utf8"));

const ID = "https://spec.local/openapi.json";
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema({ ...spec, $id: ID });

const esc = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const P = (...parts: string[]) => "/" + parts.map(esc).join("/");

const routeMatchers = Object.keys(spec.paths).map((template) => {
  const rx = new RegExp("^" + template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{[^/]+\\\}/g, "[^/]+") + "$");
  return { template, rx };
});

export function matchRoute(path: string): string | null {
  return routeMatchers.find((r) => r.rx.test(path))?.template ?? null;
}

type Validator = ((data: any) => boolean) & { errors?: any };
const validateCache = new Map<string, Validator | null>();

function validatorFor(template: string, method: string, status: number): Validator | null {
  const key = `${template} ${method} ${status}`;
  if (!validateCache.has(key)) {
    const responses = spec.paths[template]?.[method.toLowerCase()]?.responses ?? {};
    const schema = responses[String(status)]?.content?.["application/json"]?.schema;
    let compiled: Validator | null = null;
    if (schema) {
      compiled = ajv.compile({
        $ref: `${ID}#/paths${P(template)}/${method.toLowerCase()}/responses/${status}/content/application~1json/schema`,
      }) as Validator;
    }
    validateCache.set(key, compiled);
  }
  return validateCache.get(key) ?? null;
}

/** schema error detail for one (path, method, status, body), or null when valid/uncovered */
export function validateBody(path: string, method: string, status: number, body: unknown): string | null {
  const template = matchRoute(path);
  if (!template) return null;
  const v = validatorFor(template, method, status);
  if (!v) return null;
  return v(body) ? null : JSON.stringify(v.errors);
}

export interface RequestLogEntry {
  method: string;
  path: string;
  status: number;
  resp?: unknown;
  matched?: boolean;
}

/** schema exists for this (path, method, status) — the body will be checked */
export function hasSchema(path: string, method: string, status: number): boolean {
  const template = matchRoute(path);
  return template !== null && validatorFor(template, method, status) !== null;
}

export interface LogCheck {
  checked: number;
  failures: string[];
  unhandled404: string[];
}

/** every logged body against its route's response schema; 404s are unhandled routes */
export function checkRequestLog(entries: RequestLogEntry[]): LogCheck {
  const unhandled404 = entries.filter((r) => r.status === 404).map((r) => `${r.method} ${r.path}`);
  const failures: string[] = [];
  let checked = 0;
  for (const r of entries) {
    if (r.status === 404 || r.resp == null || r.resp === undefined) continue;
    if (!hasSchema(r.path, r.method, r.status)) continue;
    checked++;
    const detail = validateBody(r.path, r.method, r.status, r.resp);
    if (detail !== null) failures.push(`${r.method} ${r.path} -> ${r.status} body: ${detail}`);
  }
  return { checked, failures, unhandled404 };
}

export interface WireCheck {
  failures: string[];
  frames: Record<string, any>[];
}

/** raw SSE bytes: `data:` frames plus the `:` comments the wire carries
 * (heartbeat keepalives — mapping-table.md §0), first frame server.connected */
export function checkRawSse(raw: string): WireCheck {
  const failures: string[] = [];
  const lines = raw.split("\n").filter((l) => l.length);
  const bad = lines.filter((l) => !l.startsWith("data: ") && !l.startsWith(":"));
  if (bad.length) failures.push(`non-data SSE lines: ${JSON.stringify(bad.slice(0, 3))}`);
  const frames: Record<string, any>[] = [];
  for (const l of lines) {
    if (!l.startsWith("data: ")) continue;
    try {
      frames.push(JSON.parse(l.slice(6)));
    } catch (e) {
      failures.push(`SSE frame does not parse: ${String(e)}`);
      break;
    }
  }
  if (frames[0]?.type !== "server.connected") {
    failures.push(`first frame is ${JSON.stringify(frames[0])}, expected server.connected`);
  }
  return { failures, frames };
}

const ID_PATTERNS: [string, RegExp][] = [
  ["sessionID", /^ses/],
  ["assistantMessageID", /^msg_/],
];

/** minted ids satisfy the OpenCode patterns; durable envelopes stay complete */
export function checkIdPatterns(frames: Record<string, any>[]): string[] {
  const failures: string[] = [];
  for (const f of frames) {
    if (f.type === "server.connected") continue;
    if (!/^evt_/.test(String(f.id))) {
      failures.push(`event id pattern: ${JSON.stringify(f).slice(0, 120)}`);
      break;
    }
    for (const [field, rx] of ID_PATTERNS) {
      if (f.data?.[field] !== undefined && !rx.test(String(f.data[field]))) {
        failures.push(`${field} pattern: ${f.data[field]} on ${f.type}`);
      }
    }
    if (f.type === "permission.asked" && !/^per_/.test(String(f.data?.id))) {
      failures.push(`permission id pattern: ${f.data?.id}`);
    }
    if (f.durable) {
      const d = f.durable;
      if (d.aggregateID === undefined || d.seq === undefined || d.version === undefined) {
        failures.push(`incomplete durable envelope: ${JSON.stringify(f).slice(0, 120)}`);
      } else if (f.data?.sessionID !== undefined && d.aggregateID !== f.data.sessionID) {
        failures.push(`durable aggregateID differs from sessionID: ${JSON.stringify(f).slice(0, 120)}`);
      }
    }
  }
  return failures;
}
