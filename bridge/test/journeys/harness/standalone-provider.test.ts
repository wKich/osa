import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startMockProvider } from "./mock-provider.ts";
import type { Turn } from "./journey.ts";

const ENTRY = fileURLToPath(new URL("./standalone-provider.ts", import.meta.url));

const PILOT: Turn[] = [
  { text: "PONG", stream: ["PO", "NG"] },
  { tool: { command: "rm -f probe.txt", needsPermission: true } },
  { text: "DONE", stream: ["DO", "NE"] },
];

interface Standalone {
  url: string;
  stop(): Promise<void>;
}

async function startStandalone(dir: string, turns: Turn[]): Promise<Standalone> {
  const turnsFile = join(dir, "turns.json");
  writeFileSync(turnsFile, JSON.stringify(turns));
  const proc = Bun.spawn([process.execPath, ENTRY, "--turns", turnsFile, "--port", "0"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const url = await (async () => {
    let out = "";
    for await (const part of proc.stdout) {
      out += new TextDecoder().decode(part, { stream: true });
      const port = /listening on 127\.0\.0\.1:(\d+)/.exec(out)?.[1];
      if (port) return `http://127.0.0.1:${port}/v1`;
    }
    throw new Error("standalone provider exited before listening");
  })();
  return {
    url,
    async stop() {
      proc.kill();
      await Promise.race([proc.exited, Bun.sleep(3000)]);
    },
  };
}

const ask = (url: string, path: string, body: unknown) =>
  fetch(`${url}${path}`, {
    method: path.endsWith("/models") ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: path.endsWith("/models") ? undefined : JSON.stringify(body),
  }).then(async (res) => `${res.status} ${await res.text()}`);

const user = (text: string) => ({ model: "mock-model", stream: true, messages: [{ role: "user", content: text }] });
const title = {
  model: "mock-model",
  stream: true,
  messages: [{ role: "system", content: "You are a title generator. You output ONLY a thread title." }],
};

describe("standalone provider", () => {
  test("serves the same chunks as the in-process harness provider for the pilot turns", async () => {
    const dir = mkdtempSync(join(tmpdir(), "journey-standalone-"));
    const local = startMockProvider(PILOT, "bash");
    const external = await startStandalone(dir, PILOT);
    try {
      for (const [path, body] of [
        ["/models", {}],
        ["/chat/completions", title],
        ["/chat/completions", user("first")],
        ["/chat/completions", user("second")],
        ["/chat/completions", user("third")],
        ["/nope", {}],
      ] as const) {
        expect(await ask(external.url, path, body)).toBe(await ask(local.url, path, body));
      }
      expect(external.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
      // The standalone side binds loopback only; nothing else is configured.
      expect(new URL(external.url).hostname).toBe("127.0.0.1");
    } finally {
      await external.stop();
      local.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
