// /api/experimental/session/stats: the TUI's `/stats` page (feature-plugins/
// system/stats.tsx v2.1.4). OpenCode aggregates its stored messages (core
// session/stats.ts v2.1.4 L79–L355); the bridge is the server of record for
// its sessions, so it aggregates its own session histories the same way:
// root sessions and subagents, root prompts, one step per assistant message
// with its tokens, cost and model, activity per day, tool calls by state.
import type { AnyObj } from "./spec-answers.ts";

export interface StatsSession {
  parentID?: string;
  messages: readonly AnyObj[];
}

export interface StatsInput {
  from?: number;
  to?: number;
  timezone?: string;
  tools?: "none" | "summary" | "detail";
}

type Tokens = { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
const emptyTokens = (): Tokens => ({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } });
function addTokens(target: Tokens, source: AnyObj | undefined): void {
  target.input += Number(source?.input ?? 0);
  target.output += Number(source?.output ?? 0);
  target.reasoning += Number(source?.reasoning ?? 0);
  target.cache.read += Number(source?.cache?.read ?? 0);
  target.cache.write += Number(source?.cache?.write ?? 0);
}
const totalTokens = (t: Tokens) => t.input + t.output + t.reasoning + t.cache.read + t.cache.write;

function dateKey(timezone = "UTC"): (time: number) => string {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
  }
  return (time) => {
    const parts = Object.fromEntries(formatter.formatToParts(time).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
}

const dayOrdinal = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / 86_400_000);
};
function longestStreak(days: string[]): number {
  let current = 0;
  let longest = 0;
  days.forEach((day, i) => {
    current = i > 0 && dayOrdinal(day) - dayOrdinal(days[i - 1]!) === 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  });
  return longest;
}
function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid];
}

type ToolCount = { calls: number; succeeded: number; failed: number; unfinished: number };
function addStatus(target: ToolCount, status: unknown): void {
  target.calls++;
  if (status === "completed") target.succeeded++;
  else if (status === "error") target.failed++;
  else target.unfinished++;
}

export function sessionStats(sessions: Iterable<StatsSession>, input: StatsInput = {}): AnyObj {
  const all = [...sessions];
  const to = input.to ?? Date.now();
  const created = (m: AnyObj) => Number(m.time?.created ?? 0);
  const counted = (m: AnyObj) => m.type === "user" || m.type === "assistant";
  const earliest = Math.min(...all.flatMap((s) => s.messages.filter(counted).map(created)).filter((t) => t < to));
  const from = input.from ?? (Number.isFinite(earliest) ? earliest : to);
  const mode = input.tools ?? "summary";
  const key = dateKey(input.timezone);
  const roots = new Set<StatsSession>();
  const subagents = new Set<StatsSession>();
  const activity = new Map<string, number>();
  const models = new Map<string, { model: AnyObj; steps: number; tokens: Tokens; cost: number }>();
  const tools = new Map<string, ToolCount & { name: string; durations: number[] }>();
  const totals = { prompts: 0, steps: 0, tokens: emptyTokens(), cost: 0 };
  const toolTotals: ToolCount = { calls: 0, succeeded: 0, failed: 0, unfinished: 0 };
  for (const s of all) {
    for (const m of s.messages) {
      if (!counted(m) || created(m) < from || created(m) >= to) continue;
      (s.parentID ? subagents : roots).add(s);
      if (m.type === "user") {
        if (!s.parentID) totals.prompts++;
        continue;
      }
      totals.steps++;
      addTokens(totals.tokens, m.tokens);
      totals.cost += Number(m.cost ?? 0);
      const day = key(created(m));
      activity.set(day, (activity.get(day) ?? 0) + 1);
      if (m.model?.providerID && m.model?.id) {
        const id = `${m.model.providerID}/${m.model.id}#${m.model.variant ?? ""}`;
        const entry = models.get(id) ?? {
          model: { providerID: m.model.providerID, id: m.model.id, ...(m.model.variant ? { variant: m.model.variant } : {}) },
          steps: 0, tokens: emptyTokens(), cost: 0,
        };
        models.set(id, entry);
        entry.steps++;
        entry.cost += Number(m.cost ?? 0);
        addTokens(entry.tokens, m.tokens);
      }
      for (const part of Array.isArray(m.content) ? m.content : []) {
        if (part?.type !== "tool") continue;
        addStatus(toolTotals, part.state?.status);
        const tool = tools.get(part.name) ?? { name: String(part.name), calls: 0, succeeded: 0, failed: 0, unfinished: 0, durations: [] };
        tools.set(tool.name, tool);
        addStatus(tool, part.state?.status);
        if (typeof part.time?.completed === "number" && typeof part.time?.created === "number") tool.durations.push(part.time.completed - part.time.created);
      }
    }
  }
  const days = [...activity.entries()].sort(([a], [b]) => a.localeCompare(b));
  return {
    range: { from, to },
    sessions: roots.size,
    subagents: subagents.size,
    prompts: totals.prompts,
    steps: totals.steps,
    tokens: totals.tokens,
    cost: totals.cost,
    tools:
      mode === "none"
        ? { mode }
        : mode === "summary"
          ? { mode, totals: toolTotals }
          : {
              mode,
              totals: toolTotals,
              usage: [...tools.values()].sort((a, b) => b.calls - a.calls).map(({ durations, ...t }) => {
                const p50 = median(durations);
                return p50 === undefined ? t : { ...t, durationP50: p50 };
              }),
            },
    activeDays: days.length,
    streak: longestStreak(days.map(([d]) => d)),
    activity: days.map(([date, steps]) => ({ date, steps })),
    models: [...models.values()].sort((a, b) => totalTokens(b.tokens) - totalTokens(a.tokens)),
  };
}
