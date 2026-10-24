import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const FAKE = fileURLToPath(new URL("../../fake-maki.ts", import.meta.url));

async function waitFor(lines: any[], predicate: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await Bun.sleep(20);
  }
  throw new Error(`timed out; frames: ${lines.map((l) => l.type).join(",")}`);
}

describe("fake-maki script mode", () => {
  test("plays text deltas, a permission-gated tool use, then the next turn", async () => {
    const turns = [
      { tool: { command: "true", needsPermission: true } },
      { text: "DONE", stream: ["DO", "NE"] },
    ];
    const proc = Bun.spawn({
      cmd: ["bun", FAKE],
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      env: { ...process.env, FAKE_MAKI_SCRIPT: JSON.stringify(turns) },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const lines: any[] = [];
    let buffer = "";
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    void (async () => {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return;
        buffer += decoder.decode(chunk.value, { stream: true });
        let at: number;
        while ((at = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, at).trim();
          buffer = buffer.slice(at + 1);
          if (line) lines.push(JSON.parse(line));
        }
      }
    })();

    try {
      const user = { type: "user", message: { role: "user", content: [{ type: "text", text: "go" }] } };
      proc.stdin.write(JSON.stringify(user) + "\n");
      proc.stdin.flush();

      await waitFor(lines, () => lines.some((l) => l.type === "control_request"));
      const ask = lines.find((l) => l.type === "control_request");
      expect(ask.request.tool_name).toBe("Bash");
      expect(ask.request.input.command).toBe("true");

      proc.stdin.write(
        JSON.stringify({
          type: "control_response",
          response: { subtype: "success", request_id: ask.request_id, response: { behavior: "allow", updatedPermissions: [] } },
        }) + "\n",
      );
      proc.stdin.flush();

      await waitFor(lines, () => lines.some((l) => l.type === "result"));
      const deltas = lines
        .filter((l) => l.type === "stream_event" && l.event?.type === "content_block_delta")
        .map((l) => l.event.delta.text);
      expect(deltas.join("")).toBe("DONE");
      const assistant = lines.filter((l) => l.type === "assistant" && l.message.content[0]?.type === "text");
      expect(assistant.map((l) => l.message.content[0].text)).toEqual(["DONE"]);
      const tool = lines.find((l) => l.type === "assistant" && l.message.content[0]?.type === "tool_use");
      expect(tool.message.content[0].name).toBe("Bash");
      const result = lines.find((l) => l.type === "user");
      expect(result.message.content[0].content).toBe("");
      expect(lines.find((l) => l.type === "result").subtype).toBe("success");
    } finally {
      proc.kill();
      await proc.exited;
    }
  });
});
