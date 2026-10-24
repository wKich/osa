import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const H = "/Users/ki/Projects/experiments/maki-openshell/bridge/test/journeys/harness";
const L = await import(H + "/live-sandbox.ts");
const { bridgePort } = await import(H + "/record.ts");
const env = L.liveEnvironment();
const work = mkdtempSync(join(tmpdir(), "gencheck-"));
await L.withSandbox(env, async (sandbox: string) => {
  L.resetSandbox(env, sandbox);
  const turns = join(work, "turns.json");
  writeFileSync(turns, JSON.stringify([{ text: "PONG" }, { text: "ASIDE" }]));
  const provider = await L.startProvider(env, sandbox, turns);
  L.uploadJourneyConfig(env, sandbox, provider.port, join(work, "config"));
  const bridge = Bun.spawn({ cmd: [process.execPath, "/Users/ki/Projects/experiments/maki-openshell/bridge/src/bridge.ts"], cwd: "/Users/ki/Projects/experiments/maki-openshell/bridge", env: { ...process.env, PORT: "0", OPENSHELL_BIN: env.openshell, OPENMAKI_SANDBOX: sandbox, OPENMAKI_CWD: L.SANDBOX_WORKDIR }, stdout: "pipe", stderr: "inherit" });
  const port = await bridgePort(bridge);
  const base = "http://127.0.0.1:" + port;
  const post = (p: string, b: unknown) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  const sid = (await (await post("/api/session", {})).json()).data.id;
  await post("/api/session/" + sid + "/prompt", { text: "Reply PONG" });
  for (let i = 0; i < 100; i++) { const w = await post("/api/experimental/session/" + sid + "/wait", {}); if (w.status === 204) break; }
  await Bun.sleep(1000);
  const list = () => Bun.spawnSync([env.openshell, "sandbox", "exec", "-n", sandbox, "--no-login-shell", "--workdir", L.SANDBOX_WORKDIR, "--", "maki", "session", "list", "--json"]).stdout.toString();
  console.log("before:", list().trim());
  console.log("generate:", await (await post("/api/session/" + sid + "/generate", { prompt: "what?" })).text());
  await Bun.sleep(3000);
  console.log("after:", list().trim());
  bridge.kill(); await provider.stop();
});
