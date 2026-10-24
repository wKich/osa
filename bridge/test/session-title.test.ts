// Session titles follow Maki's rule (add-session-title): the pinned
// title_extraction cases (maki-storage sessions.rs v0.6.4 L3429–L3445), and
// the bridge titles a session once, when its first run ends.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { makiTitle } from "../src/title.ts";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";

test.each([
  ["short title", "short title"],
  ["", undefined],
  [
    "This is a very long title that exceeds the sixty character limit and should be truncated at a word boundary",
    "This is a very long title that exceeds the sixty character…",
  ],
  ["one\n\ntwo\t three", "one two three"],
  ["x".repeat(70), `${"x".repeat(60)}…`],
  [`${"é".repeat(40)}`, `${"é".repeat(30)}…`],
])("makiTitle(%j)", (input, want) => {
  expect(makiTitle(input)).toBe(want);
});

let bridge: BridgeHandle;
beforeAll(async () => {
  bridge = await startBridge();
});
afterAll(async () => {
  await bridge?.stop();
});

const post = (path: string, body: unknown) =>
  fetch(bridge.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("the first run's end titles the session once, and reads return the title", async () => {
  const sid = (await (await post("/api/session", { location: { directory: bridge.workdir } })).json()).data.id;
  expect((await (await fetch(`${bridge.base}/api/session/${sid}`)).json()).data.title).toBeUndefined();
  const ended = () => bridge.frames.filter((f) => f.type === "session.execution.succeeded" && f.data?.sessionID === sid).length;
  await post(`/api/session/${sid}/prompt`, { text: "Reply with the word PONG only." });
  expect(await waitFor(() => ended() === 1)).toBe(true);
  await post(`/api/session/${sid}/prompt`, { text: "And again." });
  expect(await waitFor(() => ended() === 2)).toBe(true);
  const renamed = bridge.frames.filter((f) => f.type === "session.renamed" && f.data?.sessionID === sid);
  expect(renamed.map((f) => f.data!.title)).toEqual(["Reply with the word PONG only."]);
  expect(renamed[0]!.durable?.version).toBe(1);
  expect((await (await fetch(`${bridge.base}/api/session/${sid}`)).json()).data.title).toBe("Reply with the word PONG only.");
  const list = (await (await fetch(`${bridge.base}/api/session`)).json()).data;
  expect(list.find((x: any) => x.id === sid).title).toBe("Reply with the word PONG only.");
});

test("PATCH renames the session, an empty title regenerates Maki's, and the first run keeps a user title", async () => {
  const sid = (await (await post("/api/session", { location: { directory: bridge.workdir } })).json()).data.id;
  const patch = (body: unknown) =>
    fetch(`${bridge.base}/api/session/${sid}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const renames = () => bridge.frames.filter((f) => f.type === "session.renamed" && f.data?.sessionID === sid).map((f) => f.data!.title);
  expect((await patch({ title: "Renamed by journey" })).status).toBe(204);
  expect((await (await fetch(`${bridge.base}/api/session/${sid}`)).json()).data.title).toBe("Renamed by journey");
  const ended = () => bridge.frames.filter((f) => f.type === "session.execution.succeeded" && f.data?.sessionID === sid).length;
  await post(`/api/session/${sid}/prompt`, { text: "first prompt text" });
  expect(await waitFor(() => ended() === 1)).toBe(true);
  expect(renames()).toEqual(["Renamed by journey"]);
  expect((await patch({ title: null })).status).toBe(204);
  // the frame can trail the 204
  expect(await waitFor(() => renames().length === 2)).toBe(true);
  expect(renames()).toEqual(["Renamed by journey", "first prompt text"]);
  expect((await patch({ metadata: { pinned: true } })).status).toBe(204);
  expect((await (await fetch(`${bridge.base}/api/session/${sid}`)).json()).data.metadata).toEqual({ pinned: true });
  expect((await fetch(`${bridge.base}/api/session/ses_unknown000000000000`, { method: "PATCH", body: "{}" })).status).toBe(404);
});
