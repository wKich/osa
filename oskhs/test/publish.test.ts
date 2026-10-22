import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitLab, gitAuthEnv } from "../src/kiss/gitlab.ts";
import { pushBranch, refreshMirror } from "../src/kiss/mirror.ts";
import { chooseBranch, mrLabels } from "../src/kiss/publish.ts";
import { sandboxRound } from "../src/kiss/sandboxRound.ts";
import { echoRound, Worker } from "../src/worker.ts";
import { fakeGitLab } from "./fake-gitlab.ts";
import { fixture, git, localSandbox } from "./local-sandbox.ts";
import { dueTask, MemoryStore } from "./memory-store.ts";

const TOKEN = "glpat-test-token-0123456789";
const gl = fakeGitLab({ token: TOKEN, users: { ivan: 7 }, members: { "g/fx": [7] }, branches: { "g/fx": ["taken/name"] } });
afterAll(() => gl.stop());

async function remotes() {
  const dir = mkdtempSync(join(tmpdir(), "oskhs-remotes-"));
  mkdirSync(join(dir, "g"), { recursive: true });
  await git(tmpdir(), "clone", "-q", "--bare", await fixture(), join(dir, "g/fx.git"));
  return dir;
}

describe("gitlab client", () => {
  test("errors never carry the token", async () => {
    const api = new GitLab({ baseUrl: gl.url, token: "wrong-token-value" });
    const err = (await api.currentUser().catch((e) => e)) as Error;
    expect(err.message).toContain("401");
    expect(err.message).not.toContain("wrong-token-value");
  });
  test("git auth goes by environment only", () => {
    const env = gitAuthEnv(TOKEN);
    expect(env.GIT_CONFIG_KEY_0).toBe("http.extraHeader");
    expect(env.GIT_CONFIG_VALUE_0).toStartWith("Authorization: Basic ");
  });
});

describe("branch and labels", () => {
  test("directive, then a free proposal, then kiss-agent/<id>", async () => {
    const taken = async (b: string) => b === "taken/name";
    expect(await chooseBranch("My Branch!", "feat/x", taken)).toBe("My-Branch");
    expect(await chooseBranch(null, "feat/add readme line", taken)).toBe("feat/add-readme-line");
    expect(await chooseBranch(null, "taken/name", taken)).toMatch(/^kiss-agent\/[0-9a-f]{8}$/);
    expect(await chooseBranch(null, undefined, taken)).toMatch(/^kiss-agent\//);
    expect(mrLabels("docs, oskhs")).toEqual(["docs", "oskhs", "ai_generated"]);
    expect(mrLabels(undefined)).toEqual(["ai_generated"]);
  });
});

describe("mirror", () => {
  test("clone, refresh, push without the token in argv", async () => {
    const remoteDir = await remotes();
    const mirrorDir = mkdtempSync(join(tmpdir(), "oskhs-mirrors-"));
    const sb = localSandbox();
    const cfg = { baseUrl: gl.url, token: TOKEN, gitBaseUrl: remoteDir };
    const mirror = await refreshMirror(sb.ctx, cfg, mirrorDir, "g/fx");
    // a commit lands upstream; the next refresh brings it
    const work = join(mkdtempSync(join(tmpdir(), "oskhs-work-")), "w");
    await git(tmpdir(), "clone", "-q", join(remoteDir, "g/fx.git"), work);
    writeFileSync(join(work, "up.txt"), "up\n");
    await git(work, "add", "-A");
    await git(work, "commit", "-qm", "up");
    await git(work, "push", "-q", "origin", "main");
    await refreshMirror(sb.ctx, cfg, mirrorDir, "g/fx");
    expect(await git(mirror, "rev-parse", "main")).toBe(await git(work, "rev-parse", "HEAD"));
    await git(mirror, "update-ref", "refs/heads/oskhs/t1", "main");
    await pushBranch(sb.ctx, cfg, mirror, "g/fx", "refs/heads/oskhs/t1", "feat/x");
    expect(await git(join(remoteDir, "g/fx.git"), "rev-parse", "feat/x")).toBe(await git(work, "rev-parse", "HEAD"));
    expect(await git(mirror, "for-each-ref", "refs/heads/oskhs")).toBe("");
    for (const c of sb.calls) expect(c.argv.join(" ")).not.toContain(TOKEN);
  });
});

describe("code round end to end", () => {
  test("a change becomes an MR and the task goes to review", async () => {
    const remoteDir = await remotes();
    const mirrorDir = mkdtempSync(join(tmpdir(), "oskhs-mirrors-"));
    const sb = localSandbox();
    sb.onRun = async (_argv, opts) => {
      const ws = sb.path(opts.env!.MAKI_OSS_WORKDIR!);
      writeFileSync(join(ws, "g_fx/README.md"), "# fx\n\nTested by oskhs.\n");
      const text = "[RESULT]\nStatus: done\nChanged: yes\nTitle: docs: note oskhs in README\nDescription: Добавлена строка.\nBranch: docs/oskhs-readme\nLabels: docs\nReply: Готово, MR создан.\nRisk: low\n[/RESULT]";
      return { code: 0, stdout: JSON.stringify({ type: "result", is_error: false, result: text, session_id: "S" }) + "\n" };
    };
    const round = sandboxRound({ ctx: sb.ctx, mirrorDir, providers: [], model: "m/x", agentName: "svc_kiss", internalModels: true, stateDir: mkdtempSync(join(tmpdir(), "oskhs-state-")), gitlab: { baseUrl: gl.url, token: TOKEN, gitBaseUrl: remoteDir } });
    const store = new MemoryStore();
    store.tasks.set("t1", dueTask("t1", { prompt: "добавь строку в README", taskRepositories: [{ projectPath: "g/fx", description: "fixture" }], authorUsername: "ivan", source: "https://chat/x" }));
    const worker = new Worker(store, round, { hostId: "h", maxRounds: 1, maxPerProject: 1, roundTimeoutSec: 30, heartbeatSec: 5, cancelPollSec: 1, abortGraceSec: 5, log: () => {}, info: () => {} });
    await worker.tick();
    await worker.drain();
    const task = store.task("t1");
    expect(task).toMatchObject({ state: "review", runtimeState: "idle_stopped", replyMessage: "Готово, MR создан.", taskDescription: "Добавлена строка." });
    expect(task.taskRepositories).toEqual([{ projectPath: "g/fx", description: "fixture", mrUrl: "https://gitlab.test/g/fx/-/merge_requests/1", mrIid: 1, branchName: "docs/oskhs-readme" }]);
    expect(gl.mrs.at(-1)).toMatchObject({ project: "g/fx", title: "docs: note oskhs in README", source_branch: "docs/oskhs-readme", target_branch: "main", labels: "docs,ai_generated", assignee_id: 14134, reviewer_ids: [7] });
    expect(gl.mrs.at(-1)!.description).toBe("Добавлена строка.\n\nИсточник задачи: https://chat/x");
    const remote = join(remoteDir, "g/fx.git");
    expect(await git(remote, "show", "docs/oskhs-readme:README.md")).toContain("Tested by oskhs.");
    expect(await git(remote, "log", "-1", "--format=%s", "docs/oskhs-readme")).toBe("docs: note oskhs in README");
    for (const c of sb.calls) expect(c.argv.join(" ")).not.toContain(TOKEN);
  });

  test("read-only tasks and answers without changes create no MR", async () => {
    const remoteDir = await remotes();
    const sb = localSandbox();
    sb.onRun = async () => ({ code: 0, stdout: '{"type":"result","is_error":false,"result":"[RESULT]\\nStatus: no_changes\\nReply: just an answer\\n[/RESULT]","session_id":"S"}\n' });
    const before = gl.mrs.length;
    const round = sandboxRound({ ctx: sb.ctx, mirrorDir: mkdtempSync(join(tmpdir(), "oskhs-mirrors-")), providers: [], model: "m/x", agentName: "k", internalModels: true, stateDir: mkdtempSync(join(tmpdir(), "oskhs-state-")), gitlab: { baseUrl: gl.url, token: TOKEN, gitBaseUrl: remoteDir } });
    const task = dueTask("t2", { taskRepositories: [{ projectPath: "g/fx" }] });
    expect(await round({ task: task as never, project: null, prompt: "", timeoutSec: 30 }, new AbortController().signal)).toEqual({ ok: true, text: "just an answer" });
    expect(await round({ task: { ...task, readOnly: true } as never, project: null, prompt: "", timeoutSec: 30 }, new AbortController().signal)).toEqual({ ok: true, text: "just an answer" });
    expect(gl.mrs.length).toBe(before);
    void echoRound;
  });

  test("a rejected MR fails the round naming the repository and step", async () => {
    const remoteDir = await remotes();
    const sb = localSandbox();
    sb.onRun = async (_argv, opts) => {
      writeFileSync(join(sb.path(opts.env!.MAKI_OSS_WORKDIR!), "g_fx/x.txt"), "x\n");
      return { code: 0, stdout: '{"type":"result","is_error":false,"result":"[RESULT]\\nTitle: t\\nReply: r\\n[/RESULT]","session_id":"S"}\n' };
    };
    const round = sandboxRound({ ctx: sb.ctx, mirrorDir: mkdtempSync(join(tmpdir(), "oskhs-mirrors-")), providers: [], model: "m/x", agentName: "k", internalModels: true, stateDir: mkdtempSync(join(tmpdir(), "oskhs-state-")), gitlab: { baseUrl: gl.url, token: "bad", gitBaseUrl: remoteDir } });
    const reply = await round({ task: dueTask("t3", { taskRepositories: [{ projectPath: "g/fx" }] }) as never, project: null, prompt: "", timeoutSec: 30 }, new AbortController().signal);
    expect(reply.ok).toBe(false);
    expect((reply as { error: string }).error).toContain("oskhs could not publish the changes");
  });
});
