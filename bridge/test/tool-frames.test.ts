// Tool frames in the pinned child's order (fix-tool-permission-frames): the
// buffered tool_use precedes its streamed block, and every tool frame says the
// child, not the provider, ran the tool (session-event.ts v2.1.4 L513–L571).
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

test("a multi-call turn's step carries the last call's tokens, not the run total", () => {
  const usage = { input_tokens: 1, output_tokens: 1 };
  const out = run([
    { type: "assistant", message: { role: "assistant", content: [toolUse], usage } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "Exit code: 0" }] } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "DONE" }], usage } },
    { type: "result", subtype: "success", result: "DONE", usage: { input_tokens: 2, output_tokens: 2 }, total_cost_usd: 0 },
  ]);
  const ended = out.find((f) => f.type === "session.step.ended")!;
  expect(ended.data.tokens).toMatchObject({ input: 1, output: 1 });
});

test("a failed run fails its step with the error; each retried attempt restarts the step", () => {
  const failed = run([{ type: "result", subtype: "error_during_execution", is_error: true, result: "API error (400): no" }]);
  expect(failed.find((f) => f.type === "session.step.failed")!.data.error).toEqual({ type: "Error", message: "API error (400): no" });
  expect(failed.some((f) => f.type === "session.step.ended")).toBe(false);

  const retried = run([
    { type: "system", subtype: "api_retry", attempt: 1, retry_delay_ms: 1000, error: "API error (503): busy" },
    { type: "system", subtype: "api_retry", attempt: 2, retry_delay_ms: 2000, error: "API error (503): busy" },
    { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
  ]);
  const kinds = retried.filter((f) => f.type === "session.step.started" || f.type === "session.retry.scheduled").map((f) => f.type.split(".")[1]);
  expect(kinds).toEqual(["step", "retry", "step", "retry", "step"]);
  expect(retried.filter((f) => f.type === "session.retry.scheduled").map((f) => f.data.attempt)).toEqual([2, 3]);
});

test("tool parts use the TUI's rendering vocabulary and keep their input", () => {
  const todos = [
    { content: "Map the names", status: "completed" },
    { content: "Render the list", status: "in_progress" },
  ];
  const cases: [string, string][] = [
    ["TodoWrite", "todowrite"],
    ["todo_write", "todowrite"],
    ["WebFetch", "webfetch"],
    ["WebSearch", "websearch"],
    ["CodeExecution", "execute"],
    ["Bash", "bash"],
  ];
  for (const [wire, rendered] of cases) {
    const input = wire === "TodoWrite" ? { todos } : { sample: true };
    const out = run([{ type: "assistant", message: { role: "assistant", content: [
      { type: "tool_use", id: "toolu_1", name: wire, input },
    ] } }]);
    expect(out.find((f) => f.type === "session.tool.input.started")!.data.name).toBe(rendered);
    expect(out.find((f) => f.type === "session.tool.called")!.data.input).toEqual(input);
  }
});
