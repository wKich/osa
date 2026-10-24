// Tool frames in the pinned child's order (fix-tool-permission-frames): the
// buffered tool_use precedes its streamed block, and every tool frame says the
// child, not the provider, ran the tool (session-event.ts v2.0.32 L508–L566).
import { expect, test } from "bun:test";
import { Translator } from "../src/translator.ts";

function run(frames: any[]) {
  const out: { type: string; data: any }[] = [];
  const t = new Translator({
    sink: { emit: (type, data) => out.push({ type, data }) },
    sessionID: "ses_test",
    agent: () => "build",
    model: () => ({ providerID: "synthetic", id: "fake" }),
  });
  t.beginTurn("msg_assistant", { text: "go", id: "msg_user", delivery: "steer" });
  for (const f of frames) t.onFrame(f);
  return out;
}

const toolUse = { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "false" } };
const streamedBlock = [
  { type: "stream_event", event: { type: "message_start", message: { role: "assistant", content: [] } } },
  { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { ...toolUse, input: {} } } },
  { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"command\":\"false\"}" } } },
  { type: "stream_event", event: { type: "content_block_stop", index: 0 } },
];

test("a streamed tool_use block after the buffered message adds no second tool part", () => {
  const out = run([{ type: "assistant", message: { role: "assistant", content: [toolUse] } }, ...streamedBlock]);
  expect(out.filter((f) => f.type === "session.tool.input.started")).toHaveLength(1);
  expect(out.filter((f) => f.type === "session.tool.input.delta")).toHaveLength(0);
  expect(out.filter((f) => f.type === "session.tool.input.ended")).toHaveLength(1);
});

test("called, failed and success frames carry executed: false", () => {
  const out = run([
    { type: "assistant", message: { role: "assistant", content: [toolUse, { ...toolUse, id: "toolu_2" }] } },
    { type: "user", message: { role: "user", content: [
      { type: "tool_result", tool_use_id: "toolu_1", content: "Exit code: 1", is_error: true },
      { type: "tool_result", tool_use_id: "toolu_2", content: "Exit code: 0", is_error: false },
    ] } },
  ]);
  const called = out.filter((f) => f.type === "session.tool.called");
  expect(called.map((f) => f.data.executed)).toEqual([false, false]);
  const failed = out.find((f) => f.type === "session.tool.failed")!;
  expect(failed.data).toMatchObject({ id: "toolu_1", executed: false, error: { type: "Error", message: "Exit code: 1" } });
  expect(out.find((f) => f.type === "session.tool.success")!.data.executed).toBe(false);
});
