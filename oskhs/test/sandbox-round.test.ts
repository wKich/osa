import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sandboxFor, sandboxRound } from "../src/kiss/sandboxRound.ts";
import { fixture, git, localSandbox } from "./local-sandbox.ts";

async function mirrors(...paths: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "oskhs-mirrors-"));
  for (const p of paths) await git(tmpdir(), "clone", "-q", "--mirror", await fixture(), join(dir, `${p}.git`));
  return dir;
}

const task = (over: Record<string, unknown> = {}) => ({
  _id: "ab12cd34",
  prompt: "What is the secret word?",
  state: "processing",
  projectId: "p1",
  taskRepositories: [{ projectPath: "g/fx", description: "fixture" }, { projectPath: "g/two" }],
  source: "https://chat.skbkontur.ru/_redirect/pl/root1",
  authorUsername: "ivan",
  threadContext: { previousComments: [{ author: "ivan", text: "hello" }], threadUrl: "https://chat/t" },
  ...over,
});

describe("sandbox round", () => {
  test("answers from both repositories with kiss's prompt; the Reply field is the reply", async () => {
    const mirrorDir = await mirrors("g/fx", "g/two");
    const sb = localSandbox();
    let prompt = "";
    let workspace: string[] = [];
    sb.onRun = async (argv, opts) => {
      prompt = argv.at(-1)!;
      const ws = sb.path(opts.env!.MAKI_OSS_WORKDIR!);
      workspace = [readFileSync(join(ws, "g_fx/README.md"), "utf8"), readFileSync(join(ws, "AGENTS.md"), "utf8")];
      expect(opts.env!.MAKI_OSS_RUN_TAG).toBe("oskhs-ab12cd34");
      const text = "thinking…\n[RESULT]\nStatus: no_changes\nChanged: no\nReply: PELICAN\nRisk: low\n[/RESULT]";
      return { code: 0, stdout: JSON.stringify({ type: "result", is_error: false, result: text, session_id: "S" }) + "\n" };
    };
    const round = sandboxRound({ ctx: sb.ctx, mirrorDir, providers: ["maki-synthetic"], model: "m/x", agentName: "svc_kiss" });
    const reply = await round({ task: task() as never, project: { _id: "p1", title: "kiss-local" }, prompt: "", timeoutSec: 5 }, new AbortController().signal);
    expect(reply).toEqual({ ok: true, text: "PELICAN" });
    expect(prompt).toContain("**Task from @ivan:** What is the secret word?");
    expect(prompt).toContain("**Thread URL:** https://chat/t");
    expect(workspace[0]).toContain("PELICAN");
    expect(workspace[1]).toContain("### `g_two/`");
    const run = sb.calls.find((c) => c.argv[1] === "run")!;
    expect(run.opts.env).toMatchObject({ MAKI_OSS_SANDBOX_NAME: "repo-kiss-local", MAKI_OSS_PROVIDERS: "maki-synthetic" });
    expect(run.argv).toContain("m/x");
    // read-only: nothing comes back
    expect(sb.calls.some((c) => c.argv.includes("download"))).toBe(false);
  });

  test("a follow-up uses the sub-task's own prompt", async () => {
    const mirrorDir = await mirrors("g/fx", "g/two");
    const sb = localSandbox();
    let prompt = "";
    sb.onRun = async (argv) => ((prompt = argv.at(-1)!), { code: 0, stdout: '{"type":"result","is_error":false,"result":"plain answer","session_id":"S"}\n' });
    const round = sandboxRound({ ctx: sb.ctx, mirrorDir, providers: [], agentName: "svc_kiss" });
    const reply = await round({ task: task() as never, project: null, prompt: "kiss-built follow-up prompt", subTask: { _id: "s1", taskId: "ab12cd34", type: "thread_instruction", prompt: "x", state: "processing" }, timeoutSec: 5 }, new AbortController().signal);
    expect(prompt).toBe("kiss-built follow-up prompt");
    expect(reply).toEqual({ ok: true, text: "plain answer" });
  });

  test("a missing mirror fails before any sandbox call", async () => {
    const mirrorDir = await mirrors("g/fx");
    const sb = localSandbox();
    const round = sandboxRound({ ctx: sb.ctx, mirrorDir, providers: [], agentName: "k" });
    const reply = await round({ task: task() as never, project: null, prompt: "", timeoutSec: 5 }, new AbortController().signal);
    expect(reply.ok).toBe(false);
    expect((reply as { error: string }).error).toContain(join(mirrorDir, "g/two.git"));
    expect(sb.calls.some((c) => c.argv[0] === "openshell")).toBe(false);
  });

  test("an agent error becomes the round error", async () => {
    const mirrorDir = await mirrors("g/fx", "g/two");
    const sb = localSandbox();
    sb.onRun = async () => ({ code: 0, stdout: '{"type":"result","is_error":true,"result":"API error (401)","session_id":"S"}\n' });
    const round = sandboxRound({ ctx: sb.ctx, mirrorDir, providers: [], agentName: "k" });
    const reply = await round({ task: task() as never, project: null, prompt: "", timeoutSec: 5 }, new AbortController().signal);
    expect(reply).toEqual({ ok: false, error: "Maki reported an error: API error (401)" });
  });

  test("sandbox names follow the project title", () => {
    expect(sandboxFor({ title: "Kiss Local" }, "x")).toBe("repo-kiss-local");
    expect(sandboxFor({ _id: "6ab5f8ff" }, "x")).toBe("repo-6ab5f8ff");
    expect(sandboxFor(null, "p1")).toBe("repo-p1");
  });
});

test("an abort asks maki-oss's wrapper to stop the run, then the workspace goes", async () => {
  const mirrorDir = await mirrors("g/fx", "g/two");
  const sb = localSandbox();
  const controller = new AbortController();
  let release: () => void = () => {};
  sb.onRun = () => new Promise((resolve) => (release = () => resolve({ code: 143 })));
  sb.intercept = async (argv) => {
    const i = argv.indexOf("-c");
    if (argv[i + 1]?.includes("maki-oss-stop")) {
      expect(argv.at(-1)).toBe("oskhs-ab12cd34");
      release();
      return { code: 0 };
    }
    return undefined;
  };
  const round = sandboxRound({ ctx: sb.ctx, mirrorDir, providers: [], agentName: "k" });
  const pending = round({ task: task() as never, project: null, prompt: "", timeoutSec: 30 }, controller.signal);
  const { until } = { until: async (c: () => boolean) => { while (!c()) await Bun.sleep(5); } };
  await until(() => sb.calls.some((c) => c.argv[1] === "run"));
  controller.abort("cancelled");
  const reply = await pending;
  expect(reply.ok).toBe(false);
  expect(readdirSync(sb.path("/sandbox/tasks"))).toEqual([]);
});
