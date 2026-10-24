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
});
