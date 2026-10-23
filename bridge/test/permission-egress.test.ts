// Permission egress tests over the black-box bridge: the permission round trip
// is verified by its effects elsewhere, but the child's stdin is the wire that
// actually unblocks the tool. The scripted child records inbound frames with
// FAKE_MAKI_TRACE, so this file asserts the exact `control_response` written
// for each decision path — Maki's request_id, a bare allow/deny, exactly once.
// One spawned bridge; no Docker, gateway, network, or real Maki process.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle, type Frame } from "./lib/bridge.ts";

const tracePath = join(tmpdir(), `maki-oss-permission-egress-trace-${process.pid}.jsonl`);

function trace(): any[] {
  if (!existsSync(tracePath)) return [];
  return readFileSync(tracePath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}
/** the child's outbound can_use_tool asks (dir:"out" marks child -> bridge) */
const asks = () => trace().filter((f) => f.dir === "out" && f.type === "control_request");
/** the bridge's inbound answers (bridge -> child) */
const answers = () => trace().filter((f) => f.type === "control_response");
const count = (b: BridgeHandle, type: string) => b.frames.filter((f) => f.type === type).length;

function post(b: BridgeHandle, path: string, body: unknown): Promise<{ status: number; json: any }> {
  return fetch(b.base + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null) }));
}

describe("permission egress over the spawned bridge", () => {
  let bridge: BridgeHandle;
  let sid: string;

  beforeAll(async () => {
    rmSync(tracePath, { force: true });
    bridge = await startBridge({ FAKE_MAKI_TRACE: tracePath });
    const res = await fetch(`${bridge.base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: { directory: bridge.workdir } }),
    });
    expect(res.status).toBe(200);
    sid = (await res.json()).data.id;
  });

  afterAll(async () => {
    await bridge?.stop();
    rmSync(tracePath, { force: true });
  });

  /** drive one gated turn, answer it, and return the frames around the reply */
  async function askAndReply(decision: string, probeName: string) {
    const probe = join(bridge.workdir, probeName);
    writeFileSync(probe, "probe\n");
    const askedBefore = count(bridge, "permission.asked");
    const repliedBefore = count(bridge, "permission.replied");
    const askedInTrace = asks().length;
    const answeredInTrace = answers().length;
    const doneBefore = count(bridge, "session.execution.succeeded");

    const sent = await post(bridge, `/api/session/${sid}/prompt`, {
      id: `msg_permissionegress${String(askedBefore).padStart(6, "0")}`,
      text: `Use your shell tool to run exactly: rm -f ${probe} . Then reply with the single word DONE.`,
      files: [],
      agents: [],
      delivery: "steer",
    });
    expect(sent.status).toBe(200);
    expect(await waitFor(() => count(bridge, "permission.asked") > askedBefore, 30_000)).toBe(true);
    expect(await waitFor(() => asks().length > askedInTrace, 5_000)).toBe(true);

    const asked = bridge.frames.filter((f) => f.type === "permission.asked").at(-1)!;
    const ask = asks().at(-1)!;
    const reply = await post(bridge, `/api/session/${sid}/permission/${asked.data?.id}/reply`, { decision });

    expect(await waitFor(() => answers().length > answeredInTrace, 5_000)).toBe(true);
    // settle the turn so the four cases never overlap in the child
    expect(await waitFor(() => count(bridge, "session.execution.succeeded") > doneBefore, 30_000)).toBe(true);
    return {
      ask,
      reply,
      answered: answers().slice(answeredInTrace),
      replied: bridge.frames.filter((f: Frame) => f.type === "permission.replied").slice(repliedBefore),
    };
  }

  test("`once` answers Maki's request with a bare allow", async () => {
    const { ask, answered, replied, reply } = await askAndReply("once", "once-probe.txt");
    expect(reply.status).toBe(204);
    expect(answered).toHaveLength(1);
    expect(answered[0].response.request_id).toBe(ask.request_id);
    expect(answered[0].response.behavior).toBe("allow");
    expect(Object.keys(answered[0].response).sort()).toEqual(["behavior", "request_id"]);
    expect(replied.map((f) => f.data?.reply)).toEqual(["once"]);
  }, 60_000);

  test("`always` answers this call with a bare allow", async () => {
    const { ask, answered, replied, reply } = await askAndReply("always", "always-probe.txt");
    expect(reply.status).toBe(204);
    expect(answered).toHaveLength(1);
    expect(answered[0].response.request_id).toBe(ask.request_id);
    expect(answered[0].response.behavior).toBe("allow");
    expect(Object.keys(answered[0].response).sort()).toEqual(["behavior", "request_id"]);
    expect(replied.map((f) => f.data?.reply)).toEqual(["always"]);
  }, 60_000);

  test("`reject` answers Maki's request with a bare deny", async () => {
    const { ask, answered, replied, reply } = await askAndReply("reject", "reject-probe.txt");
    expect(reply.status).toBe(204);
    expect(answered).toHaveLength(1);
    expect(answered[0].response.request_id).toBe(ask.request_id);
    expect(answered[0].response.behavior).toBe("deny");
    expect(Object.keys(answered[0].response).sort()).toEqual(["behavior", "request_id"]);
    expect(replied.map((f) => f.data?.reply)).toEqual(["reject"]);
  }, 60_000);

  test("an invalid decision fails closed with a bare deny and no `permission.replied`", async () => {
    const { ask, answered, replied, reply } = await askAndReply("yes", "invalid-probe.txt");
    expect(reply.status).toBe(400);
    expect(reply.json?._tag).toBe("InvalidRequestError");
    expect(answered).toHaveLength(1);
    expect(answered[0].response.request_id).toBe(ask.request_id);
    expect(answered[0].response.behavior).toBe("deny");
    expect(Object.keys(answered[0].response).sort()).toEqual(["behavior", "request_id"]);
    expect(replied).toEqual([]);
  }, 60_000);
});
