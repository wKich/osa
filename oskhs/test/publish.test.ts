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
  test("MR creation retries while GitLab does not see the pushed branch yet", async () => {
    gl.late.remaining = 2;
    const api = new GitLab({ baseUrl: gl.url, token: TOKEN, mrRetryDelaysMs: [1, 1] });
    const mr = await api.createMR("g/fx", { title: "t", description: "d", source: "late/branch", target: "main", labels: [] });
    expect(mr.iid).toBe(gl.mrs.at(-1)!.iid);
    gl.late.remaining = 3;
    const err = (await new GitLab({ baseUrl: gl.url, token: TOKEN, mrRetryDelaysMs: [1, 1] }).createMR("g/fx", { title: "t", description: "d", source: "late/2", target: "main", labels: [] }).catch((e) => e)) as Error;
    expect(err.message).toContain("does not exist");
    gl.late.remaining = 0;
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
    expect(task.taskRepositories).toEqual([{ projectPath: "g/fx", description: "fixture", mrUrl: gl.mrs.at(-1)!.web_url, mrIid: gl.mrs.at(-1)!.iid, branchName: "docs/oskhs-readme" }]);
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

  const answerWith = (fields: string) => ({ code: 0, stdout: JSON.stringify({ type: "result", is_error: false, result: `[RESULT]\n${fields}\n[/RESULT]`, session_id: "S" }) + "\n" });

  async function followUpSetup(edit: (ws: string) => void, fields: string, task: Record<string, unknown>) {
    const remoteDir = await remotes();
    const sb = localSandbox();
    sb.onRun = async (_argv, opts) => {
      edit(sb.path(opts.env!.MAKI_OSS_WORKDIR!));
      return answerWith(fields);
    };
    const round = sandboxRound({ ctx: sb.ctx, mirrorDir: mkdtempSync(join(tmpdir(), "oskhs-mirrors-")), providers: [], model: "m/x", agentName: "svc_kiss", internalModels: true, stateDir: mkdtempSync(join(tmpdir(), "oskhs-state-")), gitlab: { baseUrl: gl.url, token: TOKEN, gitBaseUrl: remoteDir } });
    const store = new MemoryStore();
    store.tasks.set("f1", dueTask("f1", task));
    store.subTasks.set("s1", { _id: "s1", taskId: "f1", type: "thread_instruction", prompt: "сохрани в файл", state: "pending", createdAt: new Date(1) });
    const worker = new Worker(store, round, { hostId: "h", maxRounds: 1, maxPerProject: 1, roundTimeoutSec: 30, heartbeatSec: 5, cancelPollSec: 1, abortGraceSec: 5, log: () => {}, info: () => {} });
    await worker.tick();
    await worker.drain();
    return { store, remote: join(remoteDir, "g/fx.git"), sb };
  }

  test("a follow-up on a question task opens the task's first MR", async () => {
    const { store, remote, sb } = await followUpSetup(
      (ws) => writeFileSync(join(ws, "g_fx/roadmap.md"), "# Roadmap\n"),
      "Status: done\nChanged: yes\nTitle: docs: add roadmap\nDescription: Роадмэп.\nBranch: docs/roadmap\nCommit: docs: роадмэп\nReply: Сохранил.",
      { state: "completed", runtimeState: "failed", replyMessage: "answer", taskRepositories: [{ projectPath: "g/fx" }] },
    );
    const task = store.task("f1");
    expect(task).toMatchObject({ state: "review", replyMessage: null, taskDescription: "Роадмэп." });
    expect(task.taskRepositories).toEqual([{ projectPath: "g/fx", mrUrl: gl.mrs.at(-1)!.web_url, mrIid: gl.mrs.at(-1)!.iid, branchName: "docs/roadmap" }]);
    expect(await git(remote, "log", "-1", "--format=%s", "docs/roadmap")).toBe("docs: роадмэп");
    const head = await git(remote, "rev-parse", "docs/roadmap");
    expect(store.subTasks.get("s1")).toMatchObject({ state: "completed", reply: `Сохранил.\n\nCommit [${head.slice(0, 8)}](${gl.url}/g/fx/-/commit/${head})` });
    for (const c of sb.calls) expect(c.argv.join(" ")).not.toContain(TOKEN);
  });

  test("a follow-up on an open MR commits onto its branch, no new MR", async () => {
    const { store: first, remote } = await followUpSetup(
      (ws) => writeFileSync(join(ws, "g_fx/a.txt"), "a\n"),
      "Status: done\nChanged: yes\nTitle: feat: a\nBranch: feat/ab\nReply: a",
      { state: "completed", runtimeState: "failed", taskRepositories: [{ projectPath: "g/fx" }] },
    );
    const repos = first.task("f1").taskRepositories as { mrIid: number; branchName: string }[];
    const before = gl.mrs.length;
    const firstHead = await git(remote, "rev-parse", "feat/ab");
    // the same task, now in review, gets another instruction; its remote is reused
    const sb = localSandbox();
    sb.onRun = async (_argv, opts) => {
      expect(await git(join(sb.path(opts.env!.MAKI_OSS_WORKDIR!), "g_fx"), "rev-parse", "HEAD")).toBe(firstHead);
      writeFileSync(join(sb.path(opts.env!.MAKI_OSS_WORKDIR!), "g_fx/b.txt"), "b\n");
      return answerWith("Status: done\nChanged: yes\nCommit: feat: b\nReply: b добавлен");
    };
    const round = sandboxRound({ ctx: sb.ctx, mirrorDir: mkdtempSync(join(tmpdir(), "oskhs-mirrors-")), providers: [], model: "m/x", agentName: "k", internalModels: true, stateDir: mkdtempSync(join(tmpdir(), "oskhs-state-")), gitlab: { baseUrl: gl.url, token: TOKEN, gitBaseUrl: remote.replace(/\/g\/fx\.git$/, "") } });
    const sub = { _id: "s2", taskId: "f1", type: "thread_instruction", prompt: "ещё b", state: "processing" };
    const reply = await round({ task: { ...first.task("f1"), state: "review" } as never, project: null, prompt: "ещё b", subTask: sub as never, timeoutSec: 30 }, new AbortController().signal);
    expect(gl.mrs.length).toBe(before);
    expect(await git(remote, "log", "--format=%s", "feat/ab")).toStartWith("feat: b\nfeat: a");
    const head = await git(remote, "rev-parse", "feat/ab");
    expect(reply).toEqual({ ok: true, text: `b добавлен\n\nCommit [${head.slice(0, 8)}](${gl.url}/g/fx/-/commit/${head})`, mrs: [], taskDescription: null });
    expect(repos[0]!.branchName).toBe("feat/ab");
  });

  test("a follow-up on a merged MR answers and pushes nothing", async () => {
    const { store: first, remote } = await followUpSetup(
      (ws) => writeFileSync(join(ws, "g_fx/m.txt"), "m\n"),
      "Status: done\nChanged: yes\nTitle: feat: m\nBranch: feat/m\nReply: m",
      { state: "completed", runtimeState: "failed", taskRepositories: [{ projectPath: "g/fx" }] },
    );
    gl.mrs.at(-1)!.state = "merged";
    const head = await git(remote, "rev-parse", "feat/m");
    const sb = localSandbox();
    sb.onRun = async (_argv, opts) => {
      writeFileSync(join(sb.path(opts.env!.MAKI_OSS_WORKDIR!), "g_fx/n.txt"), "n\n");
      return answerWith("Status: done\nChanged: yes\nReply: сделал");
    };
    const round = sandboxRound({ ctx: sb.ctx, mirrorDir: mkdtempSync(join(tmpdir(), "oskhs-mirrors-")), providers: [], model: "m/x", agentName: "k", internalModels: true, stateDir: mkdtempSync(join(tmpdir(), "oskhs-state-")), gitlab: { baseUrl: gl.url, token: TOKEN, gitBaseUrl: remote.replace(/\/g\/fx\.git$/, "") } });
    const sub = { _id: "s3", taskId: "f1", type: "thread_instruction", prompt: "ещё", state: "processing" };
    const reply = await round({ task: first.task("f1") as never, project: null, prompt: "ещё", subTask: sub as never, timeoutSec: 30 }, new AbortController().signal);
    expect(reply).toEqual({ ok: true, text: "сделал\n\n⚠️ MR уже влит — отвечаю на вопрос без внесения изменений." });
    expect(await git(remote, "rev-parse", "feat/m")).toBe(head);
  });

  test("edits behind a no-changes report are not published", async () => {
    const before = gl.mrs.length;
    const { store, remote } = await followUpSetup(
      (ws) => writeFileSync(join(ws, "g_fx/scratch.txt"), "tmp\n"),
      "Status: no_changes\nChanged: no\nReply: только ответ",
      { state: "completed", runtimeState: "failed", taskRepositories: [{ projectPath: "g/fx" }] },
    );
    expect(gl.mrs.length).toBe(before);
    expect(store.task("f1")).toMatchObject({ state: "completed" });
    expect(store.subTasks.get("s1")).toMatchObject({ reply: "только ответ" });
    expect(await git(remote, "for-each-ref", "--format=%(refname)", "refs/heads")).toBe("refs/heads/feature\nrefs/heads/main");
  });
});
