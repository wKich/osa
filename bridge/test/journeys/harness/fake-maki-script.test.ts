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
  const startScript = (turns: unknown[]) => {
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
    const prompt = (text: string) => {
      proc.stdin.write(
        JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n",
      );
      proc.stdin.flush();
    };
    return { proc, lines, prompt };
  };

  test("plays text deltas, a permission-gated tool use, then the next turn", async () => {
    const turns = [
      { tool: { command: "true", needsPermission: true } },
      { text: "DONE", stream: ["DO", "NE"] },
    ];
    const { proc, lines, prompt } = startScript(turns);

    try {
      prompt("go");

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
      const tool = lines.findIndex((l) => l.type === "assistant" && l.message.content[0]?.type === "tool_use");
      expect(lines[tool].message.content[0].name).toBe("Bash");
      // the pinned order: buffered tool_use, streamed tool_use block, then the ask
      const streamed = lines.findIndex((l) => l.type === "stream_event" && l.event?.content_block?.type === "tool_use");
      const asked = lines.findIndex((l) => l.type === "control_request");
      expect(tool).toBeLessThan(streamed);
      expect(streamed).toBeLessThan(asked);
      // a silent success answers as the pinned bash plugin does
      const result = lines.find((l) => l.type === "user");
      expect(result.message.content[0].content).toBe("Exit code: 0");
      expect(lines.find((l) => l.type === "result").subtype).toBe("success");
    } finally {
      proc.kill();
      await proc.exited;
    }
  });

  test("a second prompt consumes the next turn instead of replaying the script", async () => {
    const { proc, lines, prompt } = startScript([{ text: "ONE" }, { text: "TWO" }]);
    try {
      prompt("first");
      await waitFor(lines, () => lines.filter((l) => l.type === "result").length >= 1);
      prompt("second");
      await waitFor(lines, () => lines.filter((l) => l.type === "result").length >= 2);

      const assistant = lines
        .filter((l) => l.type === "assistant" && l.message.content[0]?.type === "text")
        .map((l) => l.message.content[0].text);
      expect(assistant).toEqual(["ONE", "TWO"]);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });

  test("a paced text turn stops on interrupt with only the cancelled result", async () => {
    const { proc, lines, prompt } = startScript([{ text: "ABCDEF", stream: ["AB", "CD", "EF"], delayMs: 400 }]);
    try {
      prompt("go");
      await waitFor(lines, () => lines.some((l) => l.event?.delta?.text === "AB"));
      proc.stdin.write(JSON.stringify({ type: "control_request", request_id: "r1", request: { subtype: "interrupt" } }) + "\n");
      proc.stdin.flush();
      await waitFor(lines, () => lines.some((l) => l.type === "result"));
      const result = lines.find((l) => l.type === "result");
      expect(result.subtype).toBe("error_during_execution");
      expect(lines.some((l) => l.type === "assistant")).toBe(false);
      expect(lines.some((l) => l.event?.delta?.text === "EF")).toBe(false);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });

  test("a call turn speaks Maki's tool name and returns the scripted result", async () => {
    const { proc, lines, prompt } = startScript([
      { call: { opencode: { name: "read", input: { path: "a" } }, maki: { name: "read", input: { path: "a" }, result: "1: x" } } },
      { text: "OK" },
    ]);
    try {
      prompt("go");
      await waitFor(lines, () => lines.some((l) => l.type === "result"));
      const call = lines.find((l) => l.type === "assistant" && l.message.content[0]?.type === "tool_use");
      expect(call.message.content[0]).toMatchObject({ name: "Read", input: { path: "a" } });
      expect(lines.find((l) => l.type === "user").message.content[0]).toMatchObject({ content: "1: x", is_error: false });
      expect(lines.find((l) => l.type === "result").subtype).toBe("success");
    } finally {
      proc.kill();
      await proc.exited;
    }
  });

  test("a failing model call is retried on 5xx and ends the run on 4xx", async () => {
    const { proc, lines, prompt } = startScript([
      { fail: { status: 503, message: "busy" } },
      { text: "OK" },
      { fail: { status: 400, message: "bad request" } },
    ]);
    try {
      prompt("first");
      await waitFor(lines, () => lines.some((l) => l.type === "result"), 8000);
      expect(lines.find((l) => l.subtype === "api_retry")).toMatchObject({ attempt: 1, error: "Server error (503)" });
      expect(lines.find((l) => l.type === "result").subtype).toBe("success");
      prompt("second");
      await waitFor(lines, () => lines.filter((l) => l.type === "result").length === 2, 8000);
      expect(lines.filter((l) => l.type === "result")[1]).toMatchObject({
        is_error: true,
        result: 'API error (400): {"error":{"message":"bad request","type":"journey_error"}}',
      });
    } finally {
      proc.kill();
      await proc.exited;
    }
  });

  test("a tool turn runs its command in the workdir, never the process cwd", async () => {
    const { mkdtempSync, existsSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const work = mkdtempSync(join(tmpdir(), "fake-workdir-"));
    const proc = Bun.spawn({
      cmd: ["bun", FAKE],
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      env: { ...process.env, OPENMAKI_CWD: work, FAKE_MAKI_SCRIPT: JSON.stringify([{ tool: { command: "touch marker.txt" } }, { text: "OK" }]) },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "go" }] } }) + "\n");
      proc.stdin.flush();
      const deadline = Date.now() + 5000;
      while (!existsSync(join(work, "marker.txt")) && Date.now() < deadline) await Bun.sleep(20);
      expect(existsSync(join(work, "marker.txt"))).toBe(true);
      expect(existsSync(fileURLToPath(new URL("../../../marker.txt", import.meta.url)))).toBe(false);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });

  test("a subagent call emits the subagent's turn flagged with the task id", async () => {
    const { proc, lines, prompt } = startScript([
      { call: { opencode: { name: "subagent", input: {} }, maki: { name: "task", input: { description: "d", prompt: "p" }, result: "MARK" }, subagent: true } },
      { text: "MARK" },
      { text: "DONE" },
    ]);
    try {
      prompt("go");
      await waitFor(lines, () => lines.some((l) => l.type === "result"));
      const task = lines.find((l) => l.type === "assistant" && l.message.content[0]?.name === "Task").message.content[0].id;
      const sub = lines.filter((l) => l.parent_tool_use_id === task);
      expect(sub.map((l) => l.message.content[0].text)).toEqual(["MARK"]);
      // its stream events carry no flag, as the pinned child's do not
      const at = lines.indexOf(sub[0]);
      expect(lines.slice(0, at).some((l) => l.type === "stream_event" && l.event?.delta?.text === "MARK" && !l.parent_tool_use_id)).toBe(true);
      expect(lines.find((l) => l.type === "user" && !l.parent_tool_use_id).message.content[0]).toMatchObject({ tool_use_id: task, content: "MARK" });
      const texts = lines.filter((l) => l.type === "assistant" && !l.parent_tool_use_id && l.message.content[0]?.type === "text");
      expect(texts.map((l) => l.message.content[0].text)).toEqual(["DONE"]);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });
});
