import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { agentsMd, ANSWER_ONLY_BLOCK, buildCodeTaskPrompt, buildTaskPrompt, CODE_CHANGES_BLOCK, RESULT_FORMAT_TASK, RESULT_FORMAT_TASK_NO_CHANGES, taskContextBlock, type PromptTask } from "../src/kiss/prompt.ts";
import { defaultMRDescription, KNOWN_RESULT_FIELDS, parseResultFields, replyText, sanitizeBranchName } from "../src/kiss/result.ts";

const thread = {
  previousComments: [
    { author: "ivan", fullName: "Ivan P", text: "root msg" },
    { author: "olga", text: "reply 1" },
  ],
  threadUrl: "https://chat.example/x",
};
const cases: [string, PromptTask][] = [
  ["two repos, thread, author", { prompt: "What does calc.py do?", taskRepositories: [{ projectPath: "g/a", worktreeSubdir: "g_a" }, { projectPath: "g/b" }], threadContext: thread, source: "https://chat.skbkontur.ru/_redirect/pl/abc", authorUsername: "ivan", authorFullName: "Ivan P" }],
  ["one repo with subdir, no thread", { prompt: "q", taskRepositories: [{ projectPath: "g/a", worktreeSubdir: "sub" }], source: "https://chat.skbkontur.ru/_redirect/pl/abc", authorUsername: "ivan" }],
  ["one repo, no source", { prompt: "q", taskRepositories: [{ projectPath: "g/a" }] }],
  ["standalone, api source", { prompt: "q", taskRepositories: [], source: "api:key" }],
];
const samples = [
  "Some prose\n\n[RESULT]\nStatus: no_changes\nChanged: no\nReply: Ответ\nна две строки\nRisk: low\n[/RESULT]",
  "[RESULT]\nReply: |\n  indented\n  block\nRisk: low\n[/RESULT]",
  "[RESULT]\nReply: code below\n```\nStatus: not a field\n```\nRisk: low\n[/RESULT]",
  "[RESULT]\nStatus: done\nReply: no closing tag",
  "no block at all",
];

describe("prompt", () => {
  test("ends with the task context and asks for a no-changes result", () => {
    const p = buildTaskPrompt(cases[0]![1], "svc_kiss");
    expect(p.startsWith("You are @svc_kiss AI agent")).toBe(true);
    expect(p).toContain(RESULT_FORMAT_TASK_NO_CHANGES);
    expect(p.endsWith(taskContextBlock(cases[0]![1]))).toBe(true);
  });
  test("AGENTS.md lists every repository", () => {
    const md = agentsMd([{ key: "g_a", projectPath: "g/a", description: "A", base: "main" }, { key: "g_b", projectPath: "g/b", base: "dev" }]);
    expect(md).toContain("### `g_a/`");
    expect(md).toContain("- **Upstream branch**: dev");
  });
});

describe("reply", () => {
  test("Reply field, YAML wrapper, code fences, missing close, no block", () => {
    expect(samples.map(replyText)).toEqual(["Ответ\nна две строки", "indented\nblock", "code below\n```\nStatus: not a field\n```", "no closing tag", "no block at all"]);
  });
});

const kiss = process.env.KISS_REPO ?? resolve(import.meta.dir, "../../../../yourpapai/kiss");
const available = existsSync(`${kiss}/src/services/prompts.ts`) && existsSync(`${kiss}/node_modules`);
if (!available) console.log(`kiss prompt contract: skipped (no kiss checkout at ${kiss}; set KISS_REPO)`);

describe.skipIf(!available)("kiss prompt contract", async () => {
  const k = available ? await import(`${kiss}/src/services/prompts.ts`) : ({} as never);
  test.each(cases)("task context matches generateTaskPrompt: %s", (_name, task) => {
    const theirs: string = k.generateTaskPrompt(task.prompt, task.taskRepositories, "svc_kiss", undefined, task.threadContext ?? undefined, task.source ?? undefined, task.authorUsername ?? undefined, task.authorFullName ?? undefined);
    expect(theirs.slice(theirs.indexOf("**Task context:**"))).toBe(taskContextBlock(task));
  });
  test("code prompt blocks are kiss's own text", () => {
    const theirs: string = k.generateTaskPrompt("x", [], "svc_kiss");
    expect(theirs).toContain(CODE_CHANGES_BLOCK);
    expect(theirs).toContain(ANSWER_ONLY_BLOCK);
    expect(k.RESULT_FORMAT_TASK).toBe(RESULT_FORMAT_TASK);
    expect(buildCodeTaskPrompt(cases[0]![1]).endsWith(taskContextBlock(cases[0]![1]))).toBe(true);
  });
  test("branch sanitizer and default MR description match kiss", async () => {
    const helpers = await import(`${kiss}/src/utils/helpers.ts`);
    const utils = await import(`${kiss}/src/services/utils.ts`);
    for (const name of ["feat/Add README line!", "../x//y--z_", "a".repeat(300), "фича/кириллица"]) {
      expect(sanitizeBranchName(name)).toBe(helpers.sanitizeBranchName(name));
      expect(sanitizeBranchName(name, 48)).toBe(helpers.sanitizeBranchName(name, 48));
    }
    expect(defaultMRDescription("do it")).toBe(utils.generateMRDescription("do it"));
  });
  test("result format and known fields", () => {
    expect(k.RESULT_FORMAT_TASK_NO_CHANGES).toBe(RESULT_FORMAT_TASK_NO_CHANGES);
    expect(k.KNOWN_RESULT_FIELDS).toEqual(KNOWN_RESULT_FIELDS);
  });
  test.each(samples)("parsePromptResult agrees on %#", (sample) => {
    expect(parseResultFields(sample)).toEqual(k.parsePromptResult(sample).fields);
  });
});
