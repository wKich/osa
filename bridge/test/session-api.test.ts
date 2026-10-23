// Session API tests over the black-box bridge (spec scenario "The permission
// round trip runs offline"): each test file gets one spawned `bun
// src/bridge.ts` with PORT=0, the scripted fake child on MAKI_CHILD_CMD, and
// the listen line parsed exactly the way wait_for_bridge_port does. No
// Docker, no gateway, no network, no real Maki process.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sleep, startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";

const types = (b: BridgeHandle) => b.frames.map((f) => f.type);
const count = (b: BridgeHandle, type: string) => b.frames.filter((f) => f.type === type).length;

/** first direct child of the bridge process (the scripted maki child), 0 if none */
async function directChild(pid: number): Promise<number> {
  const proc = Bun.spawn(["pgrep", "-P", String(pid)], { stdout: "pipe", stderr: "ignore" });
  await proc.exited;
  const out = await new Response(proc.stdout).text();
  return Number(out.split("\n").find((l) => l.trim()) ?? 0) || 0;
}

function alive(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function post(b: BridgeHandle, path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(b.base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null) };
}

function prompt(b: BridgeHandle, sid: string, id: string, text: string) {
  return post(b, `/api/session/${sid}/prompt`, { id, text, files: [], agents: [], delivery: "steer" });
}

describe("session API over the spawned bridge", () => {
  let bridge: BridgeHandle;
  let sid: string;
  let childPid = 0;
  const probe = join("/tmp", `maki-oss-session-api-probe-${process.pid}.txt`);

  beforeAll(async () => {
    bridge = await startBridge();
    const res = await fetch(`${bridge.base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: { directory: bridge.workdir } }),
    });
    expect(res.status).toBe(200);
    sid = (await res.json()).data.id;
    // record this bridge's scripted child so teardown can prove it dies too
    for (let i = 0; i < 20 && childPid === 0; i++) {
      childPid = await directChild(bridge.pid);
      if (childPid === 0) await sleep(250);
    }
    expect(childPid).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await bridge?.stop();
    // teardown must take the scripted child with it (task 2.3)
    for (let i = 0; i < 40 && alive(childPid); i++) await sleep(250);
    expect(alive(childPid)).toBe(false);
  });

  test("boot routes answer 2xx", async () => {
    for (const path of ["/api/info", "/api/model", "/api/agent", "/api/project", "/api/session"]) {
      const res = await fetch(bridge.base + path);
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
    }
    expect(String(sid)).toMatch(/^ses/);
  }, 30_000);

  test("a prompt turn renders text frames to completion", async () => {
    const done = count(bridge, "session.execution.succeeded");
    const sent = await prompt(bridge, sid, "msg_sessionapi0000000001", "Reply with the word PONG only.");
    expect(sent.status).toBe(200);
    expect(await waitFor(() => types(bridge).includes("session.execution.succeeded"), 30_000)).toBe(true);
    expect(count(bridge, "session.execution.succeeded")).toBe(done + 1);
    const texts = bridge.frames.filter((f) => f.type === "session.text.ended").map((f) => f.data?.text);
    expect(texts).toContain("PONG");
  }, 60_000);

  test("a failing tool maps to session.tool.failed", async () => {
    const before = count(bridge, "session.tool.failed");
    await prompt(bridge, sid, "msg_sessionapi0000000002", "Use your shell tool to run exactly: false . Then reply with the single word DONE.");
    expect(await waitFor(() => count(bridge, "session.tool.failed") > before, 30_000)).toBe(true);
    const failed = bridge.frames.filter((f) => f.type === "session.tool.failed").at(-1)!;
    expect(failed.data?.error?.type).toBe("Error");
    expect(String(failed.data?.error?.message)).toMatch(/exit code: 1/i);
    expect(await waitFor(() => count(bridge, "session.execution.succeeded") >= 2, 30_000)).toBe(true);
  }, 60_000);

  test("permission round trip: deny blocks the child and leaves the target untouched", async () => {
    writeFileSync(probe, "probe\n");
    const asks = count(bridge, "permission.asked");
    const results = count(bridge, "session.tool.success") + count(bridge, "session.tool.failed");
    await prompt(bridge, sid, "msg_sessionapi0000000003", `Use your shell tool to run exactly: rm -f ${probe} . Then reply with the single word DONE.`);
    expect(await waitFor(() => count(bridge, "permission.asked") > asks, 30_000)).toBe(true);

    // the child is blocked: no tool outcome may exist yet, target untouched
    await sleep(500);
    expect(count(bridge, "session.tool.success") + count(bridge, "session.tool.failed")).toBe(results);
    expect(existsSync(probe)).toBe(true);

    const list = await fetch(`${bridge.base}/api/session/${sid}/permission`);
    expect(list.status).toBe(200);
    const pending = (await list.json()).data;
    expect(pending.length).toBe(1);
    expect(String(pending[0].id)).toMatch(/^per_/);

    const reply = await post(bridge, `/api/session/${sid}/permission/${pending[0].id}/reply`, { decision: "reject" });
    expect(reply.status).toBe(204);
    // deny path observed on the child's stdin: the command was not run
    expect(await waitFor(() => count(bridge, "session.tool.failed") > results, 30_000)).toBe(true);
    const denied = bridge.frames.filter((f) => f.type === "session.tool.failed").at(-1)!;
    expect(String(denied.data?.error?.message)).toMatch(/permission denied/i);
    expect(existsSync(probe)).toBe(true);
    expect(await waitFor(() => count(bridge, "session.execution.succeeded") >= 3, 30_000)).toBe(true);
  }, 90_000);

  test("permission round trip: allow runs the child's command", async () => {
    const asks = count(bridge, "permission.asked");
    const successes = count(bridge, "session.tool.success");
    await prompt(bridge, sid, "msg_sessionapi0000000004", `Use your shell tool to run exactly: rm -f ${probe} . Then reply with the single word DONE.`);
    expect(await waitFor(() => count(bridge, "permission.asked") > asks, 30_000)).toBe(true);
    const asked = bridge.frames.filter((f) => f.type === "permission.asked").at(-1)!;
    const reply = await post(bridge, `/api/session/${sid}/permission/${asked.data.id}/reply`, { decision: "once" });
    expect(reply.status).toBe(204);
    // allow path observed on the child's stdin: the gated command executed
    expect(await waitFor(() => count(bridge, "session.tool.success") > successes, 30_000)).toBe(true);
    expect(existsSync(probe)).toBe(false);
    expect(await waitFor(() => count(bridge, "session.execution.succeeded") >= 4, 30_000)).toBe(true);
  }, 90_000);

  test("permission round trip: always becomes the child's session rule and the bridge caches nothing", async () => {
    const reask = join("/tmp", `maki-oss-session-api-reask-${process.pid}.txt`);
    // fresh sessions: the session rule lives in one child and must not leak
    // into this file's other permission tests
    const fresh = async () => (await post(bridge, "/api/session", { location: { directory: bridge.workdir } })).json.data.id as string;
    const sidA = await fresh();
    writeFileSync(reask, "probe\n");
    const asks = count(bridge, "permission.asked");
    const successes = count(bridge, "session.tool.success");
    const done = count(bridge, "session.execution.succeeded");

    // first gated call: `always` is forwarded as Maki's session-scoped allow
    await prompt(bridge, sidA, "msg_sessionapi0000000005", `Use your shell tool to run exactly: rm -f ${reask} . Then reply with the single word DONE.`);
    expect(await waitFor(() => count(bridge, "permission.asked") > asks, 30_000)).toBe(true);
    const first = bridge.frames.filter((f) => f.type === "permission.asked").at(-1)!;
    const reply = await post(bridge, `/api/session/${sidA}/permission/${first.data.id}/reply`, { decision: "always" });
    expect(reply.status).toBe(204);
    expect(await waitFor(() => count(bridge, "session.tool.success") > successes, 30_000)).toBe(true);
    expect(existsSync(reask)).toBe(false);
    expect(await waitFor(() => count(bridge, "session.execution.succeeded") >= done + 1, 30_000)).toBe(true);

    // a matching call in the same session: the child's rule covers it, so no
    // ask reaches the TUI and the tool runs
    writeFileSync(reask, "probe\n");
    const asks2 = count(bridge, "permission.asked");
    const successes2 = count(bridge, "session.tool.success");
    await prompt(bridge, sidA, "msg_sessionapi0000000006", `Use your shell tool to run exactly: rm -f ${reask} . Then reply with the single word DONE.`);
    expect(await waitFor(() => count(bridge, "session.tool.success") > successes2, 30_000)).toBe(true);
    expect(existsSync(reask)).toBe(false);
    expect(await waitFor(() => count(bridge, "session.execution.succeeded") >= done + 2, 30_000)).toBe(true);
    expect(count(bridge, "permission.asked")).toBe(asks2);

    // another session (another child) asks again: the bridge cached nothing
    const sidB = await fresh();
    writeFileSync(reask, "probe\n");
    await prompt(bridge, sidB, "msg_sessionapi0000000007", `Use your shell tool to run exactly: rm -f ${reask} . Then reply with the single word DONE.`);
    expect(await waitFor(() => count(bridge, "permission.asked") > asks2, 30_000)).toBe(true);
    const second = bridge.frames.filter((f) => f.type === "permission.asked").at(-1)!;
    expect(second.data.sessionID).toBe(sidB);
    expect((await post(bridge, `/api/session/${sidB}/permission/${second.data.id}/reply`, { decision: "once" })).status).toBe(204);
    expect(await waitFor(() => count(bridge, "session.execution.succeeded") >= done + 3, 30_000)).toBe(true);
    expect(existsSync(reask)).toBe(false);
  }, 90_000);

  test("permission round trip: an invalid decision fails closed", async () => {
    const invalid = join("/tmp", `maki-oss-session-api-invalid-${process.pid}.txt`);
    writeFileSync(invalid, "probe\n");
    const asks = count(bridge, "permission.asked");
    const failedBefore = count(bridge, "session.tool.failed");
    const done = count(bridge, "session.execution.succeeded");
    await prompt(bridge, sid, "msg_sessionapi0000000007", `Use your shell tool to run exactly: rm -f ${invalid} . Then reply with the single word DONE.`);
    expect(await waitFor(() => count(bridge, "permission.asked") > asks, 30_000)).toBe(true);
    const asked = bridge.frames.filter((f) => f.type === "permission.asked").at(-1)!;

    const reply = await post(bridge, `/api/session/${sid}/permission/${asked.data.id}/reply`, { decision: "yes" });
    expect(reply.status).toBe(400);
    expect(reply.json?._tag).toBe("InvalidRequestError");

    // fail closed: the child saw deny, the target stays, the pending ask is gone
    expect(await waitFor(() => count(bridge, "session.tool.failed") > failedBefore, 30_000)).toBe(true);
    const failed = bridge.frames.filter((f) => f.type === "session.tool.failed").at(-1)!;
    expect(String(failed.data?.error?.message)).toMatch(/permission denied/i);
    expect(existsSync(invalid)).toBe(true);
    const list = await fetch(`${bridge.base}/api/session/${sid}/permission`);
    expect(list.status).toBe(200);
    expect((await list.json()).data.length).toBe(0);
    expect(await waitFor(() => count(bridge, "session.execution.succeeded") >= done + 1, 30_000)).toBe(true);
  }, 90_000);

  test("delete answers 204 and the session reads back 404", async () => {
    const del = await fetch(`${bridge.base}/api/session/${sid}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    const gone = await fetch(`${bridge.base}/api/session/${sid}`);
    expect(gone.status).toBe(404);
    const body = await gone.json();
    expect(body._tag).toBe("SessionNotFoundError");
  }, 30_000);
});
