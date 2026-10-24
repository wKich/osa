// Volatile-token normalization (design decision 6). The same rules run on
// both sides before a checkpoint is compared: ids, clock time and dates,
// durations, ports, the run's temporary paths, explicit per-side model labels,
// and token/cost counters. Everything else is left alone.

export interface NormalizeOptions {
  workdir?: string;
  home?: string;
  /** Literal provider/model labels this side prints, normalized to <MODEL>. */
  models?: string[];
}

/** every label the journey catalog's second model prints on either side,
 * longest first (record.ts referenceConfig, live-sandbox.ts providers.toml) */
export const SECOND_MODEL_LABELS = ["maki/mock-model-2", "mock/mock-model-2", "Mock Model Two", "mock-model-2"];

interface Payload {
  data?: Array<Record<string, unknown>>;
}

/**
 * The labels a side can print for its model and provider, read from the side's
 * own `/api/model` and `/api/provider` responses (design decision 3). A wrong
 * model still differs after normalization.
 */
export function modelLabels(models: Payload, providers: Payload): string[] {
  const providerNames = new Map(
    (providers.data ?? []).map((p) => [String(p.id ?? ""), String(p.name ?? "")]),
  );
  const labels = new Set<string>();
  for (const m of models.data ?? []) {
    const id = String(m.id ?? m.modelID ?? "");
    const providerID = String(m.providerID ?? "");
    for (const label of [
      m.name,
      id,
      m.modelID,
      providerID && id ? `${providerID}/${id}` : "",
      providerNames.get(providerID),
      providerID,
    ]) {
      if (typeof label === "string" && label.trim()) labels.add(label);
    }
  }
  for (const p of providers.data ?? []) {
    for (const label of [p.id, p.name]) {
      if (typeof label === "string" && label.trim()) labels.add(label);
    }
  }
  return [...labels].sort((a, b) => b.length - a.length);
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function normalize(text: string, opts: NormalizeOptions = {}): string {
  let out = text;

  // The composer rotates its example prompt.
  out = out.replace(/Ask anything…\s*"[^"]*"/g, 'Ask anything… "<HINT>"');

  // OpenCode ids.
  out = out.replace(/\b(?:ses|msg|per|evt|prt)_[A-Za-z0-9]+\b/g, "<ID>");

  // Clock times and calendar dates.
  out = out.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, "<TIME>");
  // a 12-hour clock's meridiem is part of the time of day
  out = out.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b(?: ?[AP]M\b)?/g, "<TIME>");
  out = out.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<TIME>");
  // A right-aligned clock pads by its own width (`9:59 PM` vs `10:05 PM`), so
  // the gap before it depends on the hour.
  out = out.replace(/ {2,}<TIME>/g, "  <TIME>");

  // Durations.
  out = out.replace(/\b\d+(?:\.\d+)?\s?(?:ms|s)\b/g, "<DUR>");

  // Token rate is wall-clock derived and absent when a send is too quick to
  // measure.
  out = out.replace(/\s*·\s*\d+(?:\.\d+)?\s*tok\/s\b/g, "");

  // Ports stay recognizable as a host with a volatile port.
  out = out.replace(/\b(?:127\.0\.0\.1|localhost|0\.0\.0\.0):\d{2,5}\b/g, (m) =>
    m.replace(/:\d+$/, ":<PORT>"),
  );

  // The run's temporary paths. A truncated footer still keeps the last
  // segment, so match from the start of the path token to the basename.
  for (const [value, token] of [
    [opts.workdir, "<WORKDIR>"],
    [opts.home, "<HOME>"],
  ] as const) {
    if (!value) continue;
    const base = value.split(/[\\/]/).filter(Boolean).pop();
    if (base) out = out.replace(new RegExp(`\\S*${escape(base)}\\b`, "g"), token);
  }

  // A narrow pane elides the middle of the workdir and cuts its end
  // (`/…/fold…/bb/…/T/maki-journey-ref-x`): a `/…`-led token whose kept
  // segments run along the workdir's, in order, is the workdir too.
  if (opts.workdir) {
    const segments = opts.workdir.split("/").filter(Boolean);
    out = out.replace(/\/…\/\S+/g, (token) => (elidedWorkdir(token, segments) ? "<WORKDIR>" : token));
  }

  // The footer pads the workdir to the terminal width; the raw path length is
  // a harness property (a temp dir vs the sandbox workdir), so keep one gap.
  // A branch suffix (`<WORKDIR>:main`) is padded the same way.
  out = out.replace(/(<WORKDIR>|<HOME>)(:\S+)?[ \t]{2,}/g, "$1$2 ");

  // A live sandbox's hostname is its container id.
  out = out.replace(/\bsandbox@[0-9a-f]{12}\b/g, "sandbox@<HOST>");

  // Animated work spinners are volatile too.
  out = out.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, "<SPINNER>");

  // Progress/context bars advance with wall-clock timing.
  out = out.replace(/[■⬝]+/g, "<BAR>");

  // The journey catalog's second model keeps its own placeholder, so a
  // model switch stays visible after normalization.
  for (const label of SECOND_MODEL_LABELS) out = out.replace(new RegExp(escape(label), "g"), "<MODEL-2>");

  // Explicit per-side model labels, longest first so a prefix cannot win.
  for (const label of [...(opts.models ?? [])].sort((a, b) => b.length - a.length)) {
    if (label) out = out.replace(new RegExp(escape(label), "g"), "<MODEL>");
  }

  // A dialog drawn over a turn footer can cut its duration mid-unit
  // (`312ms` shows as `312m`); whatever stands after the footer's model is the
  // duration.
  out = out.replace(/(<MODEL> · )\d+(?:\.\d+)?[a-z]*(?= |$)/gm, "$1<DUR>");

  // Token and cost counters.
  out = out.replace(/\b\d[\d,.]*\s+(?:input|output)\s+tokens?\b/g, "<N> tokens");
  out = out.replace(/\b\d[\d,.]*[kKmM]?\s*tokens?\b/g, "<N> tokens");
  out = out.replace(/\$\s?\d+(?:\.\d+)?/g, "$<N>");

  return out;
}

/** whether an elided path token is a cut of the workdir: each kept segment
 * (a `…`-ended or final one may be a prefix) matches the next workdir
 * segment at or after the previous match, and the token keeps at least two */
function elidedWorkdir(token: string, segments: string[]): boolean {
  const kept = token.split("/").filter((s) => s && s !== "…");
  if (kept.length < 2) return false;
  let at = 0;
  for (const [i, raw] of kept.entries()) {
    const prefix = raw.endsWith("…") || i === kept.length - 1;
    const seg = raw.replace(/…$/, "");
    const found = segments.findIndex((s, j) => j >= at && (prefix ? s.startsWith(seg) : s === seg));
    if (found < 0) return false;
    at = found + 1;
  }
  return true;
}
