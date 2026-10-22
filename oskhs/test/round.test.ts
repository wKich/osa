import { describe, expect, test } from "bun:test";
import { checkTaskId, newTaskId, projectName, sandboxName, worktreePath } from "../src/names.ts";
import { interpretRun } from "../src/result.ts";
import { runRound, type RoundSpec } from "../src/round.ts";
import { answerLine, fail, fakeCtx, isRun, isUp, script, type Call } from "./fake.ts";

const spec = (over: Partial<RoundSpec> = {}): RoundSpec => ({
  repo: "/host/fx",
  sandbox: "repo-fx",
  providers: ["maki-synthetic"],
  taskId: "t1",
  base: "main",
  branches: [],
  allBranches: false,
  prompt: "What is the secret word?",
  timeoutSec: 60,
  ...over,
});

const index = (calls: Call[], pred: (argv: string[]) => boolean) => calls.findIndex((c) => pred(c.argv));
const scriptHas = (needle: string) => (argv: string[]) => script(argv)?.includes(needle) ?? false;

describe("names", () => {
  test("project names are sanitized basenames", () => {
    expect(projectName("/x/My_Repo.v2")).toBe("my-repo-v2");
    expect(projectName("/x/fx/")).toBe("fx");
    expect(sandboxName("fx")).toBe("repo-fx");
  });
  test("task ids are path-safe", () => {
    expect(newTaskId(1700000000000)).toMatch(/^t1700000000000-[0-9a-f]{4}$/);
    expect(worktreePath("t1")).toBe("/sandbox/tasks/t1");
    expect(() => checkTaskId("../x")).toThrow();
    expect(() => checkTaskId("")).toThrow();
  });
});

describe("sandbox", () => {
  test("a missing sandbox is created with maki-oss up before the sync", async () => {
    const { ctx, calls } = fakeCtx({});
    const { result } = await runRound(ctx, spec());
    expect(result.kind).toBe("answer");
    const up = index(calls, isUp);
    expect(up).toBeGreaterThanOrEqual(0);
    expect(up).toBeLessThan(index(calls, scriptHas("git init -q --bare")));
    expect(calls[up]!.opts.env).toMatchObject({ MAKI_OSS_SANDBOX_NAME: "repo-fx", MAKI_OSS_PROVIDERS: "maki-synthetic" });
  });

  test("no call carries --env", async () => {
    const { ctx, calls } = fakeCtx({});
    await runRound(ctx, spec());
    for (const c of calls) expect(c.argv).not.toContain("--env");
  });
});

describe("round", () => {
  test("maki-oss run gets the worktree, sandbox, timeout, and no-sync", async () => {
    const { ctx, calls } = fakeCtx({ phase: "Ready" });
    await runRound(ctx, spec({ model: "synthetic/m" }));
    const run = calls[index(calls, isRun)]!;
    expect(run.argv).toEqual(["maki-oss", "run", "--no-sync", "--timeout", "60", "--model", "synthetic/m", "--", "What is the secret word?"]);
    expect(run.opts.env).toMatchObject({ MAKI_OSS_SANDBOX_NAME: "repo-fx", MAKI_OSS_WORKDIR: "/sandbox/tasks/t1" });
    expect(run.opts.timeoutMs).toBe(90_000);
    const add = calls[index(calls, scriptHas("worktree add"))]!.argv;
    expect(add.slice(-3)).toEqual(["/sandbox/repo", "/sandbox/tasks/t1", "main"]);
    expect(index(calls, scriptHas("worktree remove"))).toBeGreaterThan(index(calls, isRun));
  });

  test("the worktree is removed after a failed run", async () => {
    const { ctx, calls } = fakeCtx({ phase: "Ready" }, (argv) => (isRun(argv) ? fail(3, "gateway down") : undefined));
    const { result: r } = await runRound(ctx, spec());
    expect(r).toMatchObject({ kind: "failed", stage: "run", exitCode: 3 });
    expect(index(calls, scriptHas("worktree remove"))).toBeGreaterThan(index(calls, isRun));
  });

  test("a failed worktree add skips maki and removal", async () => {
    const { ctx, calls } = fakeCtx({ phase: "Ready" }, (argv) => (scriptHas("worktree add")(argv) ? fail(128, "invalid reference") : undefined));
    const { result: r } = await runRound(ctx, spec());
    expect(r).toMatchObject({ kind: "failed", stage: "worktree" });
    expect(index(calls, isRun)).toBe(-1);
    expect(index(calls, scriptHas("worktree remove"))).toBe(-1);
  });
});

describe("results", () => {
  const out = (code: number, stdout: string, timedOut = false) => ({ code, stdout, stderr: "err", timedOut });
  test("answer", () => {
    expect(interpretRun(out(0, `noise\n${answerLine}\n`), 60)).toMatchObject({ kind: "answer", text: "PELICAN", sessionId: "S1", numTurns: 2 });
  });
  test("agent error with exit 0", () => {
    const line = JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "API error (400)", session_id: "S2" });
    expect(interpretRun(out(0, line), 60)).toEqual({ kind: "agent-error", message: "API error (400)", sessionId: "S2" });
  });
  test("no result line", () => {
    expect(interpretRun(out(0, "not json"), 60)).toMatchObject({ kind: "failed", stage: "parse" });
    expect(interpretRun(out(2, ""), 60)).toMatchObject({ kind: "failed", stage: "run", exitCode: 2 });
  });
  test("timeout", () => {
    expect(interpretRun(out(124, ""), 60)).toEqual({ kind: "timeout", seconds: 60 });
    expect(interpretRun(out(137, "", true), 60)).toEqual({ kind: "timeout", seconds: 60 });
  });
});
