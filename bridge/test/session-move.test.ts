// Moving a session (`/cd`, core session/move.ts v2.1.4 L64–L157): the
// destination must be a directory in the sandbox workdir; Maki has no control
// that changes a child's workdir, so the bridge restarts the child there,
// resuming the same Maki session (`-r`), and records session.moved.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

let bridge: BridgeHandle;
beforeAll(async () => {
  // the script's position survives the child's restart, as a turn would in Maki
  bridge = await startBridge({
    FAKE_MAKI_SCRIPT: JSON.stringify([{ text: "ONE" }, { tool: { command: "pwd" } }, { text: "TWO" }]),
    FAKE_MAKI_SCRIPT_STATE: join(tmpdir(), `maki-oss-session-move-${process.pid}.state`),
  });
});
afterAll(async () => {
  await bridge?.stop();
  rmSync(join(tmpdir(), `maki-oss-session-move-${process.pid}.state`), { force: true });
});

const post = (path: string, body: unknown) =>
  fetch(bridge.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("a move restarts the child in the new directory, resuming its session", async () => {
  mkdirSync(join(bridge.workdir, "sub"), { recursive: true });
  writeFileSync(join(bridge.workdir, "plain.txt"), "");
  const sid = (await (await post("/api/session", { location: { directory: bridge.workdir } })).json()).data.id;
  await post(`/api/session/${sid}/prompt`, { text: "one" });
  expect(await waitFor(() => bridge.frames.filter((f) => f.type === "session.execution.succeeded" && f.data?.sessionID === sid).length === 1, 15_000)).toBe(true);

  for (const [directory, message] of [["missing", "Directory does not exist"], ["plain.txt", "Not a directory"], ["/etc", "outside the project"]] as const) {
    const bad = await post(`/api/session/${sid}/move`, { directory });
    expect(bad.status).toBe(400);
    expect((await bad.json()).message).toContain(message);
  }

  const inits = bridge.frames.filter((f) => f.type === "model.updated" && f.data?.sessionID === sid).length;
  expect((await post(`/api/session/${sid}/move`, { directory: "sub" })).status).toBe(204);
  const target = join(bridge.workdir, "sub");
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "session.moved"))).toBe(true);
  const moved = bridge.frames.find((f) => f.type === "session.moved")!;
  expect(moved.data).toMatchObject({ sessionID: sid, location: { directory: target }, subpath: "sub" });
  expect(moved.durable).toMatchObject({ aggregateID: sid, version: 1 });
  // the restarted child announces itself again
  expect(await waitFor(() => bridge.frames.filter((f) => f.type === "model.updated" && f.data?.sessionID === sid).length > inits, 10_000)).toBe(true);
  expect((await (await fetch(`${bridge.base}/api/session/${sid}`)).json()).data.location).toEqual({ directory: target });

  // the next turn runs there: the scripted child's `pwd` prints its workdir
  await post(`/api/session/${sid}/prompt`, { text: "two" });
  expect(await waitFor(() => bridge.frames.filter((f) => f.type === "session.execution.succeeded" && f.data?.sessionID === sid).length === 2, 15_000)).toBe(true);
  const pwd = bridge.frames.find((f) => f.type === "session.tool.success" && f.data?.sessionID === sid)!;
  expect(JSON.stringify(pwd.data!.content)).toContain(target);

  const path = `/api/session/${sid}/message`;
  const history = await (await fetch(`${bridge.base}${path}`)).json();
  expect(validateBody(path, "GET", 200, history)).toBeNull();
  expect(history.data.find((m: any) => m.type === "location-switched")).toMatchObject({ location: { directory: target }, previous: { location: { directory: bridge.workdir } } });
}, 60_000);
