// Read-only sandbox reads for routes whose real state lives in the project
// sandbox (files, git, Maki's own config), over the same transport the Maki
// child uses (design decision 3 of add-opencode-tui-bridge):
//
//   <openshell> sandbox exec -n <name> --no-login-shell --workdir <dir> -- <argv>
//
// built from the helper's environment (OPENSHELL_BIN, OPENMAKI_SANDBOX). No
// --env value is ever passed, no host path is read, and nothing is mounted:
// the sandbox is the only place these answers come from. Without a sandbox
// (a MAKI_CHILD_CMD-only run) every read is `null` and the route answers its
// empty, spec-valid shape.
import { spawn } from "node:child_process";

export interface SandboxResult {
  code: number;
  stdout: string;
}

const TIMEOUT_MS = 10_000;

/** argv for one sandbox read; exported so the shape can be asserted without spawning */
export function sandboxArgv(
  argv: string[],
  workdir: string,
  env: Record<string, string | undefined> = process.env,
): string[] | null {
  const name = env.OPENMAKI_SANDBOX;
  if (!name) return null;
  const openshell = env.OPENSHELL_BIN ?? "openshell";
  return [openshell, "sandbox", "exec", "-n", name, "--no-login-shell", "--workdir", workdir, "--", ...argv];
}

/** runs one read in the sandbox; null when there is no sandbox or the exec fails to start */
export function sandboxRun(argv: string[], workdir: string): Promise<SandboxResult | null> {
  const full = sandboxArgv(argv, workdir);
  if (!full) return Promise.resolve(null);
  return new Promise((resolve) => {
    // the host cwd is irrelevant to the exec; the sandbox workdir is --workdir
    const child = spawn(full[0]!, full.slice(1), { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout });
    });
  });
}

// ---------- git state of the sandbox checkout ----------
export interface GitState {
  branch?: string; // checked-out branch; absent when detached or not a repo
  defaultBranch?: string; // origin's HEAD branch, when the clone recorded one
  root?: string; // the repository's first root commit (OpenCode's project id)
}

// one exec for the three reads; fixed script, no client input reaches it
const GIT_SCRIPT = [
  "git rev-parse --abbrev-ref HEAD 2>/dev/null",
  "printf '\\036'",
  "git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null",
  "printf '\\036'",
  "git rev-list --max-parents=0 --all 2>/dev/null | sort | head -n 1",
].join("; ");

/** the checkout's git state, read in the sandbox; {} without a sandbox or a repository */
export async function readGitState(workdir: string): Promise<GitState> {
  const res = await sandboxRun(["sh", "-c", GIT_SCRIPT], workdir);
  if (!res) return {};
  const [branch, origin, root] = res.stdout.split("\x1e").map((s) => s.trim());
  const state: GitState = {};
  if (branch && branch !== "HEAD") state.branch = branch;
  if (origin?.startsWith("origin/")) state.defaultBranch = origin.slice("origin/".length);
  if (root && /^[0-9a-f]{40,64}$/.test(root)) state.root = root;
  return state;
}

// ---------- Maki's MCP config in the sandbox ----------
export interface McpServerConfig {
  name: string;
  enabled: boolean;
}

// global then project: the order Maki merges them, a project server
// replacing a same-named global one (maki-agent/src/mcp/config.rs v0.6.4
// merge_config, load_config_inner)
const MCP_SCRIPT = [
  'cat "${XDG_CONFIG_HOME:-$HOME/.config}/maki/mcp.toml" 2>/dev/null',
  "printf '\\036'",
  "cat .maki/mcp.toml 2>/dev/null",
].join("; ");

/** the MCP servers Maki would load in the workdir; [] without a sandbox or config */
export async function readMcpConfig(workdir: string): Promise<McpServerConfig[]> {
  const res = await sandboxRun(["sh", "-c", MCP_SCRIPT], workdir);
  if (!res) return [];
  const merged = new Map<string, McpServerConfig>();
  for (const text of res.stdout.split("\x1e")) {
    let doc: any;
    try {
      doc = Bun.TOML.parse(text);
    } catch {
      continue; // Maki refuses an unparsable file too; nothing from it loads
    }
    for (const [name, raw] of Object.entries<any>(doc?.mcp ?? {})) {
      if (!raw || typeof raw !== "object") continue;
      merged.set(name, { name, enabled: raw.enabled !== false });
    }
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- the skills Maki's skill plugin discovers ----------
export interface SkillFile {
  id: string;
  name: string;
  description?: string;
  path: string;
  content: string;
}

// the plugin's scan order (plugins/skill/init.lua v0.6.4 L11–L30, L98–L130):
// config dir, home dirs, then the workdir and each ancestor up to the first
// one holding `.git`; a later skill with the same name replaces an earlier one
const SKILL_SCRIPT = `
emit() { for f in "$1"/*/SKILL.md; do [ -f "$f" ] || continue; printf '\\036%s\\037' "$f"; cat "$f"; done; }
emit "\${XDG_CONFIG_HOME:-$HOME/.config}/maki/skills"
for g in .claude/skills .config/opencode/skills .agents/skills; do emit "$HOME/$g"; done
dir=$(pwd)
while :; do
  for p in .maki/skills .claude/skills .opencode/skills .agents/skills; do emit "$dir/$p"; done
  if [ -e "$dir/.git" ] || [ "$dir" = / ]; then break; fi
  dir=$(dirname "$dir")
done`;

// `---` frontmatter of `key: value` lines, as the plugin's parse_frontmatter
// reads it (plugins/skill/skill_helpers.lua v0.6.4 L3–L19)
function frontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]!] = kv[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return { meta, body: text.slice(m[0].length) };
}

/** the skills a Maki child in the workdir would offer; [] without a sandbox */
export async function readSkills(workdir: string): Promise<SkillFile[]> {
  const res = await sandboxRun(["sh", "-c", SKILL_SCRIPT], workdir);
  if (!res) return [];
  const byName = new Map<string, SkillFile>();
  for (const record of res.stdout.split("\x1e").slice(1)) {
    const cut = record.indexOf("\x1f");
    if (cut < 0) continue;
    const path = record.slice(0, cut);
    const { meta, body } = frontmatter(record.slice(cut + 1));
    if (!body.trim()) continue; // the plugin skips a skill with an empty body
    const name = meta.name || path.split("/").at(-2)!;
    const skill: SkillFile = { id: name, name, path, content: body };
    if (meta.description) skill.description = meta.description;
    byName.set(name, skill);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
