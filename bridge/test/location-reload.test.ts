// location.reload (reloadLocation): the bridge re-reads what it serves from
// the sandbox — here the model catalog `maki models` reports, which it
// otherwise reads once at boot.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridge, type BridgeHandle } from "./lib/bridge.ts";

let bridge: BridgeHandle;
let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "maki-oss-reload-"));
  writeFileSync(join(dir, "models"), "mock/first\n");
  bridge = await startBridge({ FAKE_SANDBOX_BIN: join(import.meta.dir, "sandbox-bin"), FAKE_SANDBOX_MODELS_FILE: join(dir, "models"), MAKI_MODEL: "mock/first" });
});
afterAll(async () => {
  await bridge?.stop();
  rmSync(dir, { recursive: true, force: true });
});

test("a reload picks up a changed model catalog", async () => {
  const ids = async () => (await (await fetch(`${bridge.base}/api/model`)).json()).data.map((m: any) => `${m.providerID}/${m.id}`);
  expect(await ids()).toEqual(["mock/first"]);
  writeFileSync(join(dir, "models"), "mock/first\nmock/second\n");
  expect(await ids()).toEqual(["mock/first"]);
  const res = await fetch(`${bridge.base}/api/location/reload`, { method: "POST" });
  expect(res.status).toBe(204);
  expect(await ids()).toEqual(["mock/first", "mock/second"]);
});
