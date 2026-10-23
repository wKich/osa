// Offline coverage for the deferred session read surfaces (spec scenario
// "Deferred read surfaces stay empty"): the bridge does not keep message
// history, inbox bodies, or forms, so each route must answer an empty,
// contract-valid list rather than a synthesized row the TUI would render as a
// phantom entry. The same routes must 404 an unknown session, not pretend it
// has an empty transcript. Drives the shipped entrypoint over the
// MAKI_CHILD_CMD seam; no Docker, gateway, network, or real Maki process.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";
import { validateBody } from "./lib/contract.ts";

const SURFACES = ["message", "inbox", "form"] as const;
const surfacePath = (sid: string, surface: string) => `/api/session/${sid}/${surface}`;

async function getJson(bridge: BridgeHandle, path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(bridge.base + path);
  return { status: res.status, body: await res.json() };
}

describe("deferred session read surfaces", () => {
  let bridge: BridgeHandle;
  let sid: string;

  beforeAll(async () => {
    bridge = await startBridge();
    const res = await fetch(`${bridge.base}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location: { directory: bridge.workdir } }),
    });
    expect(res.status).toBe(200);
    sid = (await res.json()).data.id;

    // The child announces its model asynchronously; waiting keeps the
    // model.updated frame from landing between the read snapshots below.
    expect(await waitFor(() => bridge.frames.some((f) => f.type === "model.updated"), 10_000)).toBe(true);
  });

  afterAll(async () => {
    await bridge?.stop();
  });

  test("a live session's surfaces answer empty, contract-valid lists and emit nothing", async () => {
    const before = bridge.frames.length;
    for (const surface of SURFACES) {
      const path = surfacePath(sid, surface);
      const { status, body } = await getJson(bridge, path);
      expect(status).toBe(200);
      expect(body.data).toEqual([]);
      expect(validateBody(path, "GET", status, body)).toBeNull();
    }
    // these are pure reads: no route may drive the transcript
    expect(bridge.frames.length).toBe(before);
  });

  test("an unknown session's surfaces are 404, not empty successes", async () => {
    const unknown = "ses_unknown0000000000000000";
    for (const surface of SURFACES) {
      const path = surfacePath(unknown, surface);
      const { status, body } = await getJson(bridge, path);
      expect(status).toBe(404);
      expect(body._tag).toBe("SessionNotFoundError");
      expect(validateBody(path, "GET", status, body)).toBeNull();
    }
  });
});
