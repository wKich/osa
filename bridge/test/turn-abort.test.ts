// Spec scenario "Child exit fails the in-flight turn" and "A prompt to a dead
// child fails closed": the scripted child (FAKE_MAKI_CRASH) emits one assistant
// frame and exits without a `result`. The abort frame is bridge lifecycle, not
// wire input, so it is asserted here rather than through a golden replay.
// Deleting Translator.abortTurn fails this file on the missing
// session.execution.failed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";

const count = (b: BridgeHandle, type: string) => b.frames.filter((f) => f.type === type).length;

describe("child exit mid-turn over the shipped bridge", () => {
  let bridge: BridgeHandle;
  let sid: string;

  beforeAll(async () => {
    bridge = await startBridge({ FAKE_MAKI_CRASH: "1" });
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
  });

  test("a dead child fails the turn once and refuses later prompts", async () => {
    const prompt = () =>
      fetch(`${bridge.base}/api/session/${sid}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "msg_turnabort000000001", text: "Reply with the word PONG only.", files: [], agents: [], delivery: "steer" }),
      });

    const sent = await prompt();
    expect(sent.status).toBe(200);

    // the child exited without a result: the turn ends with one failure
    expect(await waitFor(() => count(bridge, "session.execution.failed") > 0, 30_000)).toBe(true);
    // let the exit travel through the bridge if it has not yet
    await waitFor(() => count(bridge, "session.execution.failed") > 1, 500);

    // partial output survives the abort
    const texts = bridge.frames.filter((f) => f.type === "session.text.ended").map((f) => f.data?.text);
    expect(texts).toContain("PONG");
    expect(count(bridge, "session.text.started")).toBe(1);

    const failed = bridge.frames.filter((f) => f.type === "session.execution.failed");
    expect(failed.length).toBe(1);
    expect(failed[0]!.data?.error?.type).toBe("Error");
    expect(failed[0]!.data?.error?.message).toBe("maki process exited");
    expect(count(bridge, "session.execution.succeeded")).toBe(0);

    // a prompt to the dead child fails closed: 503, no new turn
    const started = count(bridge, "session.execution.started");
    const again = await prompt();
    expect(again.status).toBe(503);
    expect(count(bridge, "session.execution.started")).toBe(started);
  }, 60_000);
});
