// Task 6.3 — validates what the bridge actually emitted (captured live by
// harness/capture-bridge.sh) against the pinned OpenAPI 2.1.4 contract and
// the measured SSE wire format. OpenAPI 3.1 is JSON Schema 2020-12
// (`prefixItems` needs ajv/dist/2020, not draft-07).
//
//   bun harness/validate-bridge.mjs        # exits 0 when every check passes
//
// Checks:
//   1. every logged bridge response body validates against the response schema
//      of its (path template, method, status) in the pinned spec
//   2. no logged request was answered 404 (an unhandled route means the TUI
//      called something the bridge does not answer)
//   3. the raw SSE byte stream is bare `data:` frames (no event:/id: lines),
//      starting with server.connected
//   4. every emitted envelope carries a minted id satisfying the OpenCode id
//      patterns (evt_/ses_/msg_/per_) and durable frames a durable envelope
import fs from "node:fs";
import url from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const here = url.fileURLToPath(new URL(".", import.meta.url));
// this repo keeps the harness inside evidence/harness/, one level down
const EV = `${here}/..`;
const spec = JSON.parse(fs.readFileSync(`${here}/../../../../../bridge/src/openapi-2.1.4.json`, "utf8"));

const ID = "https://spec.local/openapi.json";
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema({ ...spec, $id: ID });
const esc = (s) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const P = (...parts) => "/" + parts.map(esc).join("/");

let failures = 0;
const pass = (name) => console.log(`PASS ${name}`);
const fail = (name, detail) => { failures++; console.log(`FAIL ${name}\n    ${detail}`); };

// ---------- 1+2: logged responses vs the spec ----------
const routeMatchers = Object.keys(spec.paths).map((template) => {
  const rx = new RegExp("^" + template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{[^/]+\\\}/g, "[^/]+") + "$");
  return { template, rx };
});
const matchRoute = (path) => routeMatchers.find((r) => path.match(r.rx))?.template ?? null;

const requests = fs.readFileSync(`${EV}/bridge-requests.jsonl`, "utf8").trim().split("\n")
  .filter(Boolean).map((l) => JSON.parse(l));
const unhandled404 = requests.filter((r) => r.status === 404);
if (unhandled404.length) {
  fail("no unhandled 404", unhandled404.map((r) => `${r.method} ${r.path}`).join(", "));
} else {
  pass(`no unhandled 404 (${requests.length} requests logged)`);
}

const validateCache = new Map();
function validatorFor(template, method, status) {
  const key = `${template} ${method} ${status}`;
  if (!validateCache.has(key)) {
    const responses = spec.paths[template]?.[method.toLowerCase()]?.responses ?? {};
    const schema = responses[String(status)]?.content?.["application/json"]?.schema;
    validateCache.set(key, schema
      ? ajv.compile({ $ref: `${ID}#/paths${P(template)}/${method.toLowerCase()}/responses/${status}/content/application~1json/schema` })
      : null);
  }
  return validateCache.get(key);
}

let checked = 0;
for (const r of requests) {
  if (r.status === 404 || r.resp == null) continue; // 204s and unmatched routes
  const template = matchRoute(r.path);
  if (!template) continue;
  const v = validatorFor(template, r.method, r.status);
  if (!v) continue;
  checked++;
  if (!v(r.resp)) {
    fail(`${r.method} ${r.path} -> ${r.status} body`, JSON.stringify(v.errors));
  }
}
if (!failures) pass(`response bodies valid against the pinned contract (${checked} bodies)`);

// ---------- 3: raw SSE wire format ----------
const raw = fs.readFileSync(`${EV}/bridge-sse-raw.txt`, "utf8");
const lines = raw.split("\n").filter((l) => l.length);
const dataLines = lines.filter((l) => l.startsWith("data: "));
const badFrameLines = lines.filter((l) => !l.startsWith("data: "));
if (badFrameLines.length) fail("bare data: frames only", `non-data lines: ${JSON.stringify(badFrameLines.slice(0, 3))}`);
else pass(`all ${dataLines.length} SSE lines are bare "data:" frames (no event:/id: lines)`);

const frames = [];
let parseOk = true;
for (const l of dataLines) {
  try { frames.push(JSON.parse(l.slice(6))); } catch (e) { parseOk = false; fail("SSE frame parses as JSON", `${l.slice(0, 80)}: ${e}`); break; }
}
if (!parseOk) process.exit(1);
if (frames[0]?.type === "server.connected") pass(`first frame is server.connected (${JSON.stringify(frames[0]).slice(0, 60)}…)`);
else fail("first frame is server.connected", JSON.stringify(frames[0]));

// ---------- 4: minted ids + durable envelopes ----------
const patterns = [["id", /^evt_/], ["sessionID", /^ses/], ["assistantMessageID", /^msg_/]];
let idBad = 0;
for (const f of frames) {
  if (f.type === "server.connected") continue;
  if (!/^evt_/.test(String(f.id))) { idBad++; fail("event id pattern", JSON.stringify(f).slice(0, 120)); break; }
  for (const [field, rx] of patterns.slice(1)) {
    if (f.data?.[field] !== undefined && !rx.test(String(f.data[field]))) {
      idBad++; fail(`${field} pattern`, `${f.data[field]} on ${f.type}`); break;
    }
  }
  if (f.type === "permission.asked" && !/^per_/.test(String(f.data?.id))) { idBad++; fail("permission id pattern", JSON.stringify(f.data?.id)); }
  if (f.durable && (f.durable.aggregateID === undefined || f.durable.seq === undefined || f.durable.version === undefined)) {
    idBad++; fail("durable envelope", JSON.stringify(f).slice(0, 120));
  }
  if (f.id && f.data?.sessionID !== undefined && f.durable && f.durable.aggregateID !== f.data.sessionID) {
    idBad++; fail("durable aggregateID matches session", JSON.stringify(f).slice(0, 120));
  }
}
if (!idBad) pass(`minted ids satisfy the OpenCode patterns across ${frames.length} frames`);

// one assistant message id per turn: every part event of a turn shares it
const byTurn = new Map();
for (const f of frames) {
  const am = f.data?.assistantMessageID;
  if (am) byTurn.set(am, (byTurn.get(am) ?? 0) + 1);
}
pass(`assistant message ids seen: ${byTurn.size} (${[...byTurn.values()].join("+")} frames each)`);

const types = [...new Set(frames.map((f) => f.type))];
console.log(`INFO event types emitted: ${types.join(", ")}`);
console.log(failures ? `samples INVALID (${failures} failures)` : "all bridge-emitted bodies valid");
process.exit(failures ? 1 : 0);
