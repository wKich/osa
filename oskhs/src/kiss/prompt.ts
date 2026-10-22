// The prompt of a first round (B1.3c, design in add-oskhs-sandbox-round).
// The task-context block is a verbatim port of the second half of kiss's
// `generateTaskPrompt` (kiss src/services/prompts.ts): the same repository
// context, source URL, thread history, delivery instruction, and author
// line. A contract test renders kiss's own function and compares. The
// instructions before it are oskhs's: B1.3c rounds answer only.

export interface PromptRepo {
  projectPath: string;
  worktreeSubdir?: string | null;
}

export interface PromptComment {
  author: string;
  fullName?: string;
  text: string;
}

export interface PromptThread {
  previousComments: PromptComment[];
  threadUrl?: string;
}

export interface PromptTask {
  prompt: string;
  taskRepositories: PromptRepo[];
  threadContext?: PromptThread | null;
  source?: string | null;
  authorUsername?: string | null;
  authorFullName?: string | null;
}

// kiss prompts.ts MATTERMOST_THREAD_URL_INSTRUCTION, verbatim.
export const MATTERMOST_THREAD_URL_INSTRUCTION =
  "Source URL and Thread URL, when provided, identify the originating discussion. All content needed to complete the task is already included in the task text and the provided context. Do not open the Source URL or Thread URL unless the user explicitly asks you to examine the discussion or the provided context is insufficient. You may use available Mattermost MCP tools to read the discussion in either case. Put the complete final user-facing response only in the **Reply** field of `[RESULT]`; the external orchestrator delivers it automatically. Do not write any part of the final user-facing answer outside that field. Do not duplicate the final response, final task status, or `[RESULT]` block through any MCP or messaging tool. MCP communication tools may be unavailable and do not affect final delivery through `[RESULT]`. An active skill or workflow may explicitly require or permit an available MCP tool as a one-way channel for intermediate progress notifications, phase summaries, clarification requests, approval gates, and artifact delivery. Use an MCP channel only when its tool is available in the current session and the active workflow explicitly requires or permits it. Follow the active workflow and selected MCP tool rules for the destination, threading, and artifact delivery. If a workflow requires MCP communication but the channel is unavailable or a required call fails, follow its explicit fallback rule; do not replace the required external update with local transcript messages.";

// kiss prompts.ts RESULT_FORMAT_TASK_NO_CHANGES, verbatim.
export const RESULT_FORMAT_TASK_NO_CHANGES = [
  "Status: no_changes",
  "Changed: no",
  "Reply: <your entire user-facing answer here, in Russian. This field supports rich Markdown: headings, tables, lists, inline code, and fenced code blocks. Do not put any part of the answer outside this Reply field>",
  "Risk: low",
].join("\n");

const resultBlock = (format: string) => `[RESULT]\n${format}\n[/RESULT]`;

const formatAuthor = (c: PromptComment) => (c.fullName ? `${c.fullName} (@${c.author})` : `@${c.author}`);

/** The `**Task context:**` block, as kiss renders it. */
export function taskContextBlock(task: PromptTask): string {
  const repos = task.taskRepositories;
  const sourceUrl = task.source ?? undefined;
  const threadContext = task.threadContext ?? undefined;
  const sourceSection = sourceUrl && URL.canParse(sourceUrl) && /^https?:\/\//i.test(sourceUrl) ? `**Source URL:** ${sourceUrl}` : "";

  let repoContext = "";
  if (repos.length === 0) {
    repoContext = [
      ``,
      `**Standalone workspace:**`,
      `- There are no Git repositories in this workspace. Do not create files or perform Git operations; use available external tools, including MCP, when needed.`,
      ``,
    ].join("\n");
  } else if (repos.length > 1) {
    repoContext = [
      ``,
      `**Working with multiple repositories:**`,
      `- The repository list, descriptions, subdirectories, and upstream branches are in AGENTS.md at the workspace root.`,
      `- Use the repository descriptions to determine which repositories are relevant to the task.`,
      `- All repositories share the same branch name.`,
      `- Changes across repos will be committed with the same message and published as separate MRs.`,
      ``,
    ].join("\n");
  } else if (repos[0]?.worktreeSubdir) {
    repoContext = [``, `**Repository context:**`, `- Work in \`${repos[0].worktreeSubdir}/\` for \`${repos[0].projectPath}\`.`, ``].join("\n");
  }

  let threadSection = "";
  if (threadContext) {
    const comments = threadContext.previousComments;
    const parts: string[] = [];
    if (comments.length > 0) {
      const rootComment = comments[0]!;
      parts.push(`**Root message** (by ${formatAuthor(rootComment)}): ${rootComment.text}`);
    }
    const discussionComments = comments.slice(1);
    if (discussionComments.length > 0) {
      const commentLines = discussionComments.map((c) => `- **${formatAuthor(c)}**: ${c.text}`).join("\n");
      parts.push(`**Discussion history:**\n${commentLines}`);
    }
    if (threadContext.threadUrl) parts.push(`**Thread URL:** ${threadContext.threadUrl}`);
    if (parts.length > 0) threadSection = [``, `**Thread context:**`, parts.join("\n\n"), ``].join("\n");
  }

  const taskAuthor = task.authorUsername
    ? task.authorFullName
      ? `${task.authorFullName} (@${task.authorUsername})`
      : `@${task.authorUsername}`
    : undefined;
  const taskLine = taskAuthor ? `**Task from ${taskAuthor}:** ${task.prompt}` : `**Task:** ${task.prompt}`;

  return [
    `**Task context:**`,
    ...[repoContext, sourceSection, threadSection, sourceSection || threadContext?.threadUrl ? MATTERMOST_THREAD_URL_INSTRUCTION : ""]
      .map((section) => section.trim())
      .filter(Boolean),
    taskLine,
  ].join("\n\n");
}

/** A first round's prompt: answer-only instructions, then kiss's task context. */
export function buildTaskPrompt(task: PromptTask, agentName = "kiss"): string {
  return [
    `You are @${agentName} AI agent working in a repository workspace.`,
    ``,
    `**This task is answer-only:** answer the question from the workspace; do not modify files, commit, or create branches.`,
    `Each repository is a git worktree with its full local history (log, blame, diff, show); network git (fetch, pull, push) is unavailable.`,
    ``,
    `**Response format:**`,
    `1. A [RESULT] block is mandatory at the end of this answer. Put your entire user-facing answer directly in the Reply field — this is what the user sees; do not write any user-facing text outside the block.`,
    `2. The Reply field supports full GitHub-flavored Markdown: headings, tables, lists, inline code, and fenced code blocks.`,
    `3. Append a no-change [RESULT] block with your full answer in the Reply field:`,
    ``,
    `   ` + resultBlock(RESULT_FORMAT_TASK_NO_CHANGES),
    ``,
    taskContextBlock(task),
  ].join("\n");
}

/** oskhs's AGENTS.md index for the workspace root (design decision 5). */
export function agentsMd(repos: { key: string; projectPath: string; description?: string | null; base: string }[]): string {
  const lines = [
    "# Project Repositories",
    "",
    "## Workspace rules",
    "- Each repository is a git worktree in its own subdirectory; inspect the relevant one before answering.",
    "- This workspace is read-only for answer-only tasks: do not modify files, commit, or create branches.",
    "- Network git (fetch, pull, push) is unavailable; the full local history is.",
    "",
    "## Repositories",
    "",
  ];
  for (const r of repos) {
    lines.push(`### \`${r.key}/\``);
    if (r.description) lines.push(`- **Description**: ${r.description}`);
    lines.push(`- **GitLab project path**: \`${r.projectPath}\``);
    lines.push(`- **Upstream branch**: ${r.base}`, "");
  }
  return lines.join("\n");
}
