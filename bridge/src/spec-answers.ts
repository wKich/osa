// Spec-derived answer set for the OpenCode 2.0.32 HTTP surface (design
// decision 1). Every boot and deferred route is answered from the pinned
// OpenAPI document, then normalized with the rules the spike measured as
// load-bearing for the TUI: location consistency (project canonical == session
// directory, absolute paths, empty subpath), hostile enum defaults
// (migration/agent), and empty fake lists for surfaces Maki cannot answer.
//
//   synthesize(method, path, url, body, canonical) -> {status, payload}
//
// Session CRUD, prompt, and permission routes are stateful and live in
// bridge.ts; they call this for their schema-valid envelope.
import { readFileSync } from "node:fs";

export type AnyObj = Record<string, any>;

type PathItem = AnyObj;
type OpenAPI = { paths: Record<string, PathItem>; components: { schemas: Record<string, any> } };

// read instead of `import ... from "*.json"` so no tsconfig change is needed
const specDoc = JSON.parse(
  readFileSync(new URL("./openapi-2.0.32.json", import.meta.url), "utf8"),
) as OpenAPI;

// the bridge reports itself as the pinned server: a mismatched version makes
// the TUI warn (spike evidence/pinned-versions.txt)
export const PINNED_VERSION = "2.0.32";

// ---------- spec routing ----------
const routeMatchers = Object.keys(specDoc.paths).map((template) => {
  const rx = new RegExp(
    "^" + template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{[^/]+\\\}/g, "[^/]+") + "$",
  );
  return { template, rx };
});

function matchRoute(path: string): { template: string; item: PathItem } | null {
  for (const { template, rx } of routeMatchers) {
    if (path.match(rx)) return { template, item: specDoc.paths[template]! };
  }
  return null;
}

function resolveRef(ref: string): any {
  if (!ref.startsWith("#/")) throw new Error(`external $ref: ${ref}`);
  let node: any = specDoc;
  for (const part of ref.slice(2).split("/")) node = node?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  return node;
}

// ---------- JSON Schema (2020-12) -> minimal instance ----------
function sample(schema: any): any {
  if (!schema || typeof schema !== "object") return null;
  if (schema.const !== undefined) return schema.const;
  // enums first: many TUI-facing fields are string enums (status, type,
  // delivery, mode...) and a generic "sample" string fails client decoding
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (schema.$ref) return sample(resolveRef(schema.$ref));
  if (Array.isArray(schema.allOf)) {
    const merged: AnyObj = {};
    for (const s of schema.allOf) Object.assign(merged, sample(s) ?? {});
    return merged;
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    if (Array.isArray(schema[key])) {
      const branch = schema[key].find((s: any) => s?.type !== "null") ?? schema[key][0];
      return sample(branch);
    }
  }
  const isObject = schema.type === "object" || (!schema.type && (schema.properties || schema.required));
  if (isObject) {
    const out: AnyObj = {};
    for (const key of schema.required ?? []) out[key] = sample(schema.properties?.[key]);
    for (const [k, v] of Object.entries(schema.properties ?? {})) {
      if (!(k in out) && (v as any)?.default !== undefined) out[k] = (v as any).default;
    }
    if (!Object.keys(out).length && schema.additionalProperties === false) {
      for (const [k, v] of Object.entries(schema.properties ?? {})) { out[k] = sample(v); break; }
    }
    return out;
  }
  switch (schema.type) {
    case "array": {
      if (Array.isArray(schema.prefixItems)) return schema.prefixItems.map(sample);
      return schema.items ? [sample(schema.items)] : [];
    }
    case "string": return patternSample(schema.pattern) ?? "sample";
    case "integer": case "number": return 0;
    case "boolean": return false;
    case "null": return null;
    default: return null;
  }
}

// literal-prefix patterns (^ses, ^msg_) are satisfiable; the rest get "sample"
function patternSample(pattern?: string): string | null {
  if (!pattern) return null;
  const lit = /^\^([A-Za-z0-9_-]+)/.exec(pattern);
  return lit ? `${lit[1]}_sample` : "sample";
}

function successResponse(item: PathItem, method: string): { status: number; content: AnyObj } | null {
  const responses = item[method]?.responses;
  if (!responses) return null;
  const status = ["200", "201", "202", "204", "206"].find((s) => responses[s]) ?? Object.keys(responses)[0]!;
  return { status: Number(status), content: responses[status]?.content ?? {} };
}

// ---------- answer set ----------
// `canonical` is the one directory every answer must agree on (design: the
// project canonical equals the session directory).
export function synthesize(
  method: string,
  path: string,
  url: URL,
  body: any,
  canonical: string,
): { status: number; payload: any; matched: boolean } {
  const match = matchRoute(path);
  const op = match && match.item[method.toLowerCase()];
  if (!op) return { status: 404, payload: { error: `no spec route for ${method} ${path}` }, matched: false };

  const res = successResponse(match.item, method.toLowerCase());
  const status = res?.status ?? 200;
  const json = res?.content?.["application/json"]?.schema;
  let payload: any = status === 204 ? null : sample(json);

  // identify as the pinned server (see PINNED_VERSION)
  if (path === "/api/info" && payload) payload = { ...payload, version: PINNED_VERSION };
  // with a synthesized non-enum status the TUI polls forever, and the first
  // enum value ("required") blocks submission until a migration runs
  if (path === "/api/experimental/migration/v1") payload = { status: "completed" };
  // a synthesized config document (path "sample") makes the TUI try to load a
  // config file that does not exist and it stalls before submit
  if (method === "GET" && path === "/api/config") payload = [];
  // enum order puts "subagent" first: with no primary agent the composer has
  // nothing to submit as and Enter does nothing
  // Maki's agents are its two modes, build and plan, which the pinned SDK
  // switches with set_permission_mode (sdk_mode.rs v0.6.4 L77–L111,
  // L846–L860); named agents have no surface (`initialize` ignores `agents`,
  // L828–L839). The descriptions are Maki's (docs commands/_index.md L52,
  // permissions/_index.md L52)
  if (method === "GET" && path === "/api/agent" && Array.isArray(payload?.data)) {
    const [template] = payload.data;
    const mode = (id: string, description: string) => ({ ...template, id, name: id, description, mode: "primary", hidden: false, permissions: [] });
    payload = {
      ...payload,
      data: [
        mode("build", "Maki's default mode: tools run under the permission rules."),
        mode("plan", "Maki's plan mode: file writes go only to the plan file."),
      ],
    };
  }
  // surfaces with nothing behind them answer empty rather than a synthesized
  // row the TUI renders as real (defect boot-lists-phantom-rows): no OpenCode
  // plugin, reference alias, or shell runs in the bridge, and the
  // pinned SDK mode runs no custom command (sdk_mode.rs v0.6.4 L624), so a
  // listed one would make submit POST session.command for nothing
  if (method === "GET" && /^\/api\/(plugin|reference|shell|command)$/.test(path)) {
    payload = { ...payload, data: [] };
  }
  // the resource catalog needs a live MCP client, which the bridge is not
  if (method === "GET" && path === "/api/mcp/resource") {
    payload = { ...payload, data: { resources: [], templates: [] } };
  }
  // synthesized list items act as phantom forms/permission prompts and block
  // the transcript; these surfaces stay empty
  if (method === "GET" && /\/(form|permission|terminal)$/.test(path) && payload && typeof payload === "object") {
    payload = { ...payload, data: [] }; // keep required `location`
  }
  if (method === "GET" && path === "/api/session") payload = { ...payload, data: [] };
  if (method === "GET" && /\/(message|inbox)$/.test(path)) payload = { ...payload, data: [] };
  // every response that names a directory must agree with the directory the
  // TUI asked for: a mismatch (or a relative path that resolves nowhere) makes
  // it treat the location as unavailable and the composer stops accepting
  // submits
  // relative paths are synthesized filler ("sample"): they must not become
  // `<canonical>/sample`, a path that exists nowhere and reads as an
  // unavailable location, so they collapse onto the canonical directory
  const resolveDir = (d?: string | null) => (d?.startsWith("/") ? d : canonical);
  const qLoc = url.searchParams.get("location[directory]");
  if (path === "/api/location") {
    const dir = resolveDir(qLoc ?? payload?.directory);
    payload = { directory: dir, project: { id: "sample", directory: canonical, canonical } };
  } else if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    if (payload.location && typeof payload.location === "object") {
      payload.location = { ...payload.location, directory: resolveDir(qLoc ?? payload.location.directory) };
    }
  }
  if (method === "GET" && path === "/api/project") {
    // a project canonical pointing at a subdirectory (or a synthetic sandbox
    // path) makes the TUI move the session into it and then declare the
    // location unavailable
    const patch = (pr: AnyObj) => ({ ...pr, canonical, sandboxes: [] });
    if (Array.isArray(payload)) payload = payload.map(patch);
    else if (Array.isArray(payload?.data)) payload = { ...payload, data: payload.data.map(patch) };
  }
  // synthesized strings love the value "sample": any directory-shaped field
  // pointing nowhere sends the TUI chasing a move it then refuses as
  // unavailable, and a synthesized subpath like "sample" fails its existence
  // check when joined onto the session directory
  const absDirs = (o: any): any => {
    if (Array.isArray(o)) return o.map(absDirs);
    if (o && typeof o === "object") {
      const out: AnyObj = {};
      for (const [k, v] of Object.entries(o)) {
        if (k === "subpath" && typeof v === "string") out[k] = "";
        else out[k] = (k === "directory" || k === "canonical") && typeof v === "string" ? resolveDir(v) : absDirs(v);
      }
      return out;
    }
    return o;
  };
  if (payload && typeof payload === "object") payload = absDirs(payload);
  if (method === "GET" && path === "/api/worktree") {
    payload = Array.isArray(payload) ? [] : { ...payload, data: [] };
  }

  return { status, payload, matched: true };
}
