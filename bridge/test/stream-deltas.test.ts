// Spec scenario "Deltas reach the stream through the shipped bridge": the
// scripted child emits `stream_event` frames (FAKE_MAKI_STREAM) and the SSE
// stream must carry them, not just the buffered message. Dropping the
// partial-message flag from SDK_FLAGS fails this file's sibling argv test.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";

const count = (b: BridgeHandle, type: string) => b.frames.filter((f) => f.type === type).length;

describe("streamed deltas over the shipped bridge", () => {
  let bridge: BridgeHandle;
  let sid: string;

  beforeAll(async () => {
    bridge = await startBridge({ FAKE_MAKI_STREAM: "1" });
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

  test("deltas arrive before the buffered message, with no duplicate part", async () => {
    const res = await fetch(`${bridge.base}/api/session/${sid}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "msg_streamdeltas00000001", text: "Reply with the word PONG only.", files: [], agents: [], delivery: "steer" }),
    });
    expect(res.status).toBe(200);
    expect(await waitFor(() => count(bridge, "session.execution.succeeded") > 0, 30_000)).toBe(true);

    const deltas = bridge.frames.filter((f) => f.type === "session.text.delta");
    const ended = bridge.frames.filter((f) => f.type === "session.text.ended");
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((f) => f.data?.delta).join("")).toBe("PONG");

    // the deltas precede the message's end, both on the wire and by index
    const lastDelta = bridge.frames.lastIndexOf(deltas.at(-1)!);
    const endedAt = bridge.frames.lastIndexOf(ended.at(-1)!);
    expect(lastDelta).toBeLessThan(endedAt);

    // one part only: the buffered `assistant` frame added no duplicate start/end
    expect(count(bridge, "session.text.started")).toBe(1);
    expect(ended.length).toBe(1);
    expect(ended[0]!.data?.text).toBe("PONG");
  }, 60_000);
});
