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
  out = out.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "<TIME>");
  out = out.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<TIME>");

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

  // The footer pads the workdir to the terminal width; the raw path length is
  // a harness property (a temp dir vs the sandbox workdir), so keep one gap.
  out = out.replace(/(<WORKDIR>|<HOME>)[ \t]{2,}/g, "$1 ");

  // Animated work spinners are volatile too.
  out = out.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, "<SPINNER>");

  // Progress/context bars advance with wall-clock timing.
  out = out.replace(/[■⬝]+/g, "<BAR>");

  // Explicit per-side model labels, longest first so a prefix cannot win.
  for (const label of [...(opts.models ?? [])].sort((a, b) => b.length - a.length)) {
    if (label) out = out.replace(new RegExp(escape(label), "g"), "<MODEL>");
  }

  // Token and cost counters.
  out = out.replace(/\b\d[\d,.]*\s+(?:input|output)\s+tokens?\b/g, "<N> tokens");
  out = out.replace(/\b\d[\d,.]*[kKmM]?\s*tokens?\b/g, "<N> tokens");
  out = out.replace(/\$\s?\d+(?:\.\d+)?/g, "$<N>");

  return out;
}
