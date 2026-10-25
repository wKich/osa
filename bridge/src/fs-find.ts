// /api/fs/find: the prompt's @-autocomplete (tui component/prompt/
// autocomplete.tsx v2.1.4) searches the project's files. OpenCode indexes its
// own directory and ranks fuzzy matches (core filesystem/search.ts v2.1.4
// L31–L50, L139–L175); the project here lives in the sandbox workdir, so the
// index is the sandbox's file list, read over the exec transport, and ranked
// the same way: best match first, then the shorter path.

/** the workdir's files: git's view (tracked and unignored) in a repository,
 * else every file below the workdir but `.git` */
export const LIST_FILES = [
  "sh",
  "-c",
  "git ls-files -co --exclude-standard 2>/dev/null || find . -name .git -prune -o -type f -print | sed 's|^\\./||'",
];

export interface FindInput {
  query: string;
  type?: "file" | "directory";
  limit?: number;
}

export interface FindEntry {
  path: string;
  type: "file" | "directory";
}

/** a fuzzy subsequence score (higher is better), or null when the query's
 * characters do not all appear in order */
export function score(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  let at = 0;
  let total = 0;
  let run = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, at);
    if (i < 0) return null;
    run = i === at && at > 0 ? run + 1 : 0;
    const boundary = i === 0 || "/._- ".includes(t[i - 1]!);
    total += 1 + run * 2 + (boundary ? 3 : 0) - Math.min(i - at, 10) * 0.1;
    at = i + 1;
  }
  const base = t.lastIndexOf("/", t.length - 2) + 1;
  if (t.startsWith(q, base)) total += 5;
  return total;
}

export function find(files: string[], input: FindInput): FindEntry[] {
  const directories = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join("/") + "/");
  }
  const candidates: FindEntry[] = [
    ...(input.type === "directory" ? [] : files.map((path) => ({ path, type: "file" as const }))),
    ...(input.type === "file" ? [] : [...directories].map((path) => ({ path, type: "directory" as const }))),
  ];
  const query = input.query.trim();
  return candidates
    .map((entry) => ({ entry, score: score(query, entry.path) }))
    .filter((m): m is { entry: FindEntry; score: number } => m.score !== null)
    .sort((a, b) => b.score - a.score || a.entry.path.length - b.entry.path.length || a.entry.path.localeCompare(b.entry.path))
    .slice(0, input.limit ?? 50)
    .map((m) => m.entry);
}
