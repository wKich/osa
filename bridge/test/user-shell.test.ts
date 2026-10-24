// User shell (add-user-shell): `!command` runs in the sandbox; the pinned
// started/ended frames carry Shell.Info and the combined output, and the
// user-shell notice reaches the child with the next prompt
// (core session/session.ts v2.0.32 L179–L222, shell/result.ts L36–L81).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridge, waitFor, type BridgeHandle } from "./lib/bridge.ts";

let bridge: BridgeHandle;
const trace = join(mkdtempSync(join(tmpdir(), "shell-trace-")), "child.jsonl");
beforeAll(async () => {
  bridge = await startBridge({ FAKE_MAKI_TRACE: trace });
});
afterAll(async () => {
  await bridge?.stop();
});

const post = (path: string, body: unknown) =>
  fetch(bridge.base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const childPrompts = () =>
  existsSync(trace)
    ? readFileSync(trace, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((f) => f.type === "user").map((f) => f.message.content[0].text as string)
    : [];

test("a user shell runs in the sandbox, renders its output, and briefs the next turn", async () => {
  const sid = (await (await post("/api/session", { location: { directory: bridge.workdir } })).json()).data.id;
  const res = await post(`/api/session/${sid}/shell`, { id: "msg_shell000000000000001", command: "echo out-line; echo err-line 1>&2; exit 3" });
  expect(res.status).toBe(204);
  expect(await waitFor(() => bridge.frames.some((f) => f.type === "session.shell.ended" && f.data?.sessionID === sid))).toBe(true);
  const started = bridge.frames.find((f) => f.type === "session.shell.started" && f.data?.sessionID === sid)!;
  expect(started.id).toBe("evt_shell000000000000001");
  expect(started.data!.shell).toMatchObject({ status: "running", command: "echo out-line; echo err-line 1>&2; exit 3", cwd: bridge.workdir });
  expect(started.data!.shell.id).toMatch(/^sh_/);
  const ended = bridge.frames.find((f) => f.type === "session.shell.ended" && f.data?.sessionID === sid)!;
  expect(ended.data!.shell).toMatchObject({ status: "exited", exit: 3 });
  expect(ended.data!.output).toEqual({ output: "out-line\nerr-line\n", cursor: 18, size: 18, truncated: false });
  const synthetic = bridge.frames.find((f) => f.type === "session.inbox.enqueued" && f.data?.item?.type === "synthetic")!;
  expect(synthetic.data!.item.payload.description).toBeUndefined();

  await post(`/api/session/${sid}/prompt`, { text: "what happened?" });
  expect(await waitFor(() => childPrompts().length === 1)).toBe(true);
  const sent = childPrompts()[0]!;
  expect(sent).toStartWith("The following shell command was executed by the user:\n<shell id=\"sh_");
  expect(sent).toContain('state="completed" command="echo out-line; echo err-line 1>&2; exit 3">\nout-line\nerr-line\n\n\nExited with code 3\n</shell>');
  expect(sent).toEndWith("\n\nwhat happened?");
  expect((await post(`/api/session/${sid}/shell`, { command: " " })).status).toBe(400);
});
