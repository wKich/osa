import { describe, expect, test } from "bun:test";
import { startMockProvider } from "./mock-provider.ts";

const ask = async (url: string, messages: unknown[]) => {
  const res = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "mock-model", stream: true, messages }),
  });
  return res.text();
};

describe("mock provider", () => {
  test("streams a text turn then a tool-call turn in order", async () => {
    const provider = startMockProvider([
      { text: "PONG", stream: ["PO", "NG"] },
      { tool: { command: "rm -f probe", needsPermission: true } },
    ]);
    try {
      const title = await ask(provider.url, [
        { role: "system", content: "You are a title generator. You output ONLY a thread title." },
      ]);
      expect(title).toContain('"content":"Journey"');

      const text = await ask(provider.url, [{ role: "user", content: "hi" }]);
      expect(text).toContain('"content":"PO"');
      expect(text).toContain('"content":"NG"');
      expect(text).toContain('"finish_reason":"stop"');
      expect(text).toContain('"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}');
      expect(text).toContain("data: [DONE]");

      const tool = await ask(provider.url, [{ role: "user", content: "go" }]);
      expect(tool).toContain('"name":"shell"');
      expect(tool).toContain('"arguments":"{\\"command\\":\\"rm -f probe\\"}"');
      expect(tool).toContain('"finish_reason":"tool_calls"');
      expect(provider.requests.map((r) => r.title)).toEqual([true, false, false]);
    } finally {
      provider.close();
    }
  });

  test("serves per-side tool calls, model errors, and paced chunks", async () => {
    const turns = [
      { call: { opencode: { name: "read", input: { filePath: "a" } }, maki: { name: "read", input: { path: "a" }, result: "x" } } },
      { fail: { status: 500, message: "boom" } },
      { text: "SLOW", stream: ["SL", "OW"], delayMs: 200 },
    ];
    const opencode = startMockProvider(turns);
    const maki = startMockProvider(turns, "bash");
    try {
      expect(await ask(opencode.url, [{ role: "user", content: "go" }])).toContain('"arguments":"{\\"filePath\\":\\"a\\"}"');
      expect(await ask(maki.url, [{ role: "user", content: "go" }])).toContain('"arguments":"{\\"path\\":\\"a\\"}"');
      const failed = await fetch(`${opencode.url}/chat/completions`, { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }) });
      expect(failed.status).toBe(500);
      expect(await failed.json()).toEqual({ error: { message: "boom", type: "journey_error" } });
      const started = Date.now();
      expect(await ask(opencode.url, [{ role: "user", content: "slow" }])).toContain('"content":"OW"');
      expect(Date.now() - started).toBeGreaterThanOrEqual(500);
    } finally {
      opencode.close();
      maki.close();
    }
  });
});
