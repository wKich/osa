// API-level checks for the bridge behaviors the TUI capture cannot cover on
// its own (tasks 3.3 delete, 5.2 reject, 5.3 always-as-session-rule, 4.3 failing
// tool). Drives the bridge over HTTP against a live maki session and saves
// every emitted frame to evidence/api-check-frames.jsonl.
//
//   bun harness/api-check.ts        # exits 0 when every check passes
import { appendFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import url from "node:url";

const here = url.fileURLToPath(new URL(".", import.meta.url));
// this repo keeps the harness inside evidence/harness/, one level down
const EV = `${here}/..`;
const FRAMES = `${EV}/api-check-frames.jsonl`;
const PORT = 4621;
const BASE = `http://127.0.0.1:${PORT}`;
const DIR = "/tmp/openmaki-api-check";
const PROBE = "/tmp/openmaki-api-check-probe.txt";
mkdirSync(DIR, { recursive: true });
writeFileSync(FRAMES, "");

let failures = 0;
const pass = (n: string) => console.log(`PASS ${n}`);
const fail = (n: string, d: string) => { failures++; console.log(`FAIL ${n}\n    ${d}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// the bridge entrypoint lives in this repo's bridge/ (the spike ran it from
// the spike repo's src/); MAKI_CHILD_CMD may point the child at a scripted
// process for a sandbox-free run
const child = Bun.spawn([process.execPath, "src/bridge.ts"], {
  cwd: `${here}/../../../../../bridge`,
  env: { ...process.env, PORT: String(PORT), OPENMAKI_CWD: DIR, MAKI_MODEL: process.env.MAKI_MODEL ?? "synthetic/syn:small:text" },
  stdout: "ignore", stderr: "inherit",
});
process.on("exit", () => { try { child.kill(); } catch { /* gone */ } });

const get = async (p: string) => { const r = await fetch(BASE + p); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = async (p: string, body: any) => { const r = await fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const del = async (p: string) => { const r = await fetch(BASE + p, { method: "DELETE" }); return { status: r.status }; };

for (let i = 0; i < 30; i++) { await sleep(500); try { if ((await fetch(`${BASE}/api/info`)).ok) break; } catch { /* not up */ } }

// subscriber: every frame the bridge emits, for the evidence file
const frames: any[] = [];
const sse = await fetch(`${BASE}/api/event`);
const reader = sse.body!.getReader();
const dec = new TextDecoder();
(async () => {
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = raw.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const f = JSON.parse(line.slice(6));
        frames.push(f);
        appendFileSync(FRAMES, line.slice(6) + "\n");
      }
    }
  } catch { /* stream closed */ }
})();
await sleep(300);

const types = () => frames.map((f) => f.type);
const waitFor = async (pred: () => boolean, ms = 60_000) => {
  for (let i = 0; i < ms / 250 && !pred(); i++) await sleep(250);
  return pred();
};
const prompt = (sid: string, id: string, text: string) =>
  post(`/api/session/${sid}/prompt`, { id, text, files: [], agents: [], delivery: "steer" });

// the synthetic model sometimes calls the gated tool twice in one turn: keep
// answering every new ask (with `decision`) until the turn's result lands
async function answerPendingUntil(sid: string, pred: () => boolean, decision: string, ms = 90_000) {
  const answered = new Set<string>();
  for (let i = 0; i < ms / 250 && !pred(); i++) {
    for (const f of frames.filter((x) => x.type === "permission.asked")) {
      const id = f.data?.id;
      if (typeof id === "string" && !answered.has(id)) {
        answered.add(id);
        await post(`/api/session/${sid}/permission/${id}/reply`, { decision });
      }
    }
    await sleep(250);
  }
  return pred();
}

// --- 3.1/3.3: create (bridge-minted id) -> read -> list -> delete ---
const created = await post("/api/session", { location: { directory: DIR } });
const sid = created.body?.data?.id;
if (created.status === 200 && /^ses_/.test(String(sid))) pass(`create returns a minted ses_ id (${sid})`);
else fail("create returns a minted ses_ id", JSON.stringify(created).slice(0, 200));

const read = await get(`/api/session/${sid}`);
if (read.status === 200 && read.body?.data?.id === sid && read.body?.data?.location?.directory === DIR) pass("read returns the owned session with its directory");
else fail("session read", JSON.stringify(read).slice(0, 240));

const list = await get("/api/session");
if (list.status === 200 && list.body?.data?.some((s: any) => s.id === sid)) pass("list contains the owned session");
else fail("session list", JSON.stringify(list).slice(0, 240));

// --- 5.2 reject: maki blocks, deny maps to a rejected tool, target untouched ---
writeFileSync(PROBE, "probe\n");
await prompt(sid, "msg_reject0000000000000001", "Use your shell tool to run exactly: rm -f /tmp/openmaki-api-check-probe.txt . Then reply with the single word DONE.");
if (await waitFor(() => types().includes("permission.asked"))) pass("reject path: can_use_tool became a permission.asked event");
else fail("permission.asked emitted", types().join(", "));
const pending = await get(`/api/session/${sid}/permission`);
const per1 = pending.body?.data?.[0]?.id;
if (pending.body?.data?.length === 1 && /^per_/.test(String(per1))) pass(`pending ask listed with a minted per_ id (${per1})`);
else fail("permission list", JSON.stringify(pending).slice(0, 240));
const rejected = await post(`/api/session/${sid}/permission/${per1}/reply`, { decision: "reject" });
if (rejected.status === 204) pass("reject reply answers 204");
else fail("reject reply status", String(rejected.status));
if (await waitFor(() => types().includes("session.tool.failed"))) {
  const failed = frames.find((f) => f.type === "session.tool.failed");
  const err = failed?.data?.error;
  if (err?.type === "Error" && typeof err?.message === "string" && /denied/i.test(err.message)) {
    pass(`reject maps to session.tool.failed with the spec {type,message} shape (${err.message.slice(0, 60)}…)`);
  } else fail("tool.failed error shape", JSON.stringify(err));
} else fail("session.tool.failed emitted", types().join(", "));
if (existsSync(PROBE)) pass("reject leaves the target file untouched");
else fail("reject leaves the target file untouched", "probe file was deleted");
if (await waitFor(() => types().includes("session.execution.succeeded"), 30_000)) pass("turn completes after the deny (maki reports rejection, bridge ends the turn)");
else fail("turn completes after the deny", types().join(", "));

// --- 5.3 "always" becomes maki's session rule (AllowSession); the bridge caches nothing ---
await prompt(sid, "msg_always0000000000000001", "Use your shell tool to run exactly: rm -f /tmp/openmaki-api-check-probe.txt . Then reply with the single word DONE.");
if (await waitFor(() => types().filter((t) => t === "permission.asked").length === 2)) pass("second gated call asks again (no ask seen yet answered 'always')");
else fail("second permission.asked", types().join(", "));
const per2 = frames.filter((f) => f.type === "permission.asked")[1]?.data?.id;
const always = await post(`/api/session/${sid}/permission/${per2}/reply`, { decision: "always" });
if (always.status === 204) pass("always reply answers 204 (allow + updatedPermissions)");
else fail("always reply status", String(always.status));
if (await waitFor(() => types().includes("session.tool.success"))) pass("always executes the gated call");
else fail("tool executes after always", types().join(", "));
if (!existsSync(PROBE)) pass("the gated rm ran (probe deleted) after the always answer");
else fail("the gated rm ran", "probe file still exists");
// wait for the turn's result: a prompt sent mid-turn would queue behind this
// turn (its own run at the pin), which this check does not exercise
if (await waitFor(() => types().filter((t) => t === "session.execution.succeeded").length >= 2)) pass("always turn completes");
else fail("always turn completes", types().join(", "));
await prompt(sid, "msg_always0000000000000002", "Use your shell tool to run exactly: rm -f /tmp/openmaki-api-check-probe.txt . Then reply with the single word DONE.");
if (await waitFor(() => types().filter((t) => t === "session.execution.succeeded").length >= 3)) pass("a later matching call runs under maki's session rule");
else fail("matching call after always", types().join(", "));
if (types().filter((t) => t === "permission.asked").length === 2) pass("no re-ask after 'always' (maki's session rule covers rm *)");
else fail("no re-ask after always", types().join(", "));

// --- 4.3 failing tool: exit 1 -> session.tool.failed ---
const failsBefore = types().filter((t) => t === "session.tool.failed").length;
await prompt(sid, "msg_fail000000000000000001", "Use your shell tool to run exactly: false . Then reply with the single word DONE.");
if (await waitFor(() => types().filter((t) => t === "session.tool.failed").length > failsBefore)) {
  const err = frames.filter((f) => f.type === "session.tool.failed").at(-1)?.data?.error;
  if (err?.type === "Error" && /exit code: 1/i.test(String(err.message))) pass(`failing tool call maps to tool.failed (${err.message})`);
  else fail("failing tool error shape", JSON.stringify(err));
} else fail("failing tool emits tool.failed", types().join(", "));
if (await answerPendingUntil(sid, () => types().filter((t) => t === "session.execution.succeeded").length >= 4, "reject")) pass("turn with a failing tool still completes");
else fail("turn with failing tool completes", types().slice(-14).join(", "));

// --- 3.3 delete: kills the maki child, later reads 404 ---
const removed = await del(`/api/session/${sid}`);
if (removed.status === 204) pass("delete answers 204");
else fail("delete status", String(removed.status));
const after = await get(`/api/session/${sid}`);
if (after.status === 404 && after.body?._tag === "SessionNotFoundError") pass("deleted session reads back as SessionNotFoundError");
else fail("deleted session read", JSON.stringify(after).slice(0, 200));
await sleep(500);

console.log(failures ? `api checks FAILED (${failures})` : "all api checks passed");
try { unlinkSync(PROBE); } catch { /* absent */ }
process.exit(failures ? 1 : 0);
