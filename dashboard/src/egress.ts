// Egress denials: group the OCSF denial lines of one `openshell logs` read and
// match them against the pending rule proposals (design D3).
//
// The server does the grouping and matching once, so the Rules view and the
// inventory and project badges cannot disagree. Log reads are cached per
// `(sandbox, window)` for 30 seconds (design D4); proposals are matched fresh
// on every request, so an approval shows up without waiting for the cache.

import {
  parseDenialLine,
  type DenialEvent,
  type LogWindow,
  type RecentLogs,
  type RuleProposal,
} from "./openshell.ts";

export const DENIAL_CACHE_MS = 30_000;
/** Raw unparsed denial lines kept for the UI. */
export const UNPARSED_SAMPLES = 5;

export interface DenialGroup {
  host: string;
  port: number | null;
  binary: string | null;
  count: number;
  /** Milliseconds since the epoch. */
  firstSeen: number;
  lastSeen: number;
  reasons: string[];
  /** Chunk ids of the pending proposals this group matches. */
  matches: string[];
}

/** The log side of a denial read: what the cache holds. */
export interface DenialScan {
  window: LogWindow;
  capped: boolean;
  unparsed: number;
  unparsedSamples: string[];
  groups: DenialGroup[];
  /** When the log read finished, milliseconds since the epoch. */
  readAt: number;
}

export interface Endpoint {
  host: string;
  port: number | null;
}

/** Parse and group the lines of one log read. Groups come back unmatched. */
export function scanDenials(window: LogWindow, logs: RecentLogs, readAt: number): DenialScan {
  const events: DenialEvent[] = [];
  const unparsedSamples: string[] = [];
  let unparsed = 0;
  for (const line of logs.lines) {
    const parsed = parseDenialLine(line);
    if (parsed.kind === "denial") events.push(parsed.event);
    else if (parsed.kind === "unparsed") {
      unparsed += 1;
      if (unparsedSamples.length < UNPARSED_SAMPLES) unparsedSamples.push(parsed.raw);
    }
  }
  return { window, capped: logs.capped, unparsed, unparsedSamples, groups: groupDenials(events), readAt };
}

/** Group by `(host lowercased, port, binary)`, most recent group first. */
export function groupDenials(events: DenialEvent[]): DenialGroup[] {
  const groups = new Map<string, DenialGroup>();
  for (const event of events) {
    const host = event.host.toLowerCase();
    const key = JSON.stringify([host, event.port, event.binary]);
    let group = groups.get(key);
    if (!group) {
      group = {
        host,
        port: event.port,
        binary: event.binary,
        count: 0,
        firstSeen: event.timeMs,
        lastSeen: event.timeMs,
        reasons: [],
        matches: [],
      };
      groups.set(key, group);
    }
    group.count += 1;
    group.firstSeen = Math.min(group.firstSeen, event.timeMs);
    group.lastSeen = Math.max(group.lastSeen, event.timeMs);
    if (event.reason && !group.reasons.includes(event.reason)) group.reasons.push(event.reason);
  }
  return [...groups.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

/**
 * Endpoints of a proposal's `Endpoints:` text, such as
 * `api.example.com:443 (rest, enforce), other.example.com:80 (l4)`: each
 * comma-separated item's leading `host[:port]`. An item that does not fit is
 * skipped, so its denials land under "denied, no proposal".
 */
export function proposalEndpoints(text: string | null): Endpoint[] {
  if (!text) return [];
  const endpoints: Endpoint[] = [];
  // Commas inside a parenthesized annotation do not start a new item.
  for (const item of text.split(/,(?![^(]*\))/)) {
    const lead = item.trim().split(/\s+/)[0] ?? "";
    const match = /^(?<host>[A-Za-z0-9*][A-Za-z0-9.*-]*)(?::(?<port>\d+))?$/.exec(lead);
    if (!match?.groups) continue;
    endpoints.push({
      host: (match.groups.host ?? "").toLowerCase(),
      port: match.groups.port ? Number(match.groups.port) : null,
    });
  }
  return endpoints;
}

/** The spec's match rule ("Denials beside rule proposals"). */
export function groupMatchesProposal(group: DenialGroup, proposal: RuleProposal): boolean {
  const hostMatch = proposalEndpoints(proposal.endpoints).some(
    (endpoint) =>
      endpoint.host === group.host.toLowerCase() &&
      (group.port === null || group.port === endpoint.port),
  );
  if (!hostMatch) return false;
  const binaries = [...proposal.binaries, ...(proposal.binary ? [proposal.binary] : [])];
  if (group.binary === null || binaries.length === 0) return true;
  return binaries.includes(group.binary);
}

/** A copy of the scan with each group's matching pending proposals. */
export function matchDenials(scan: DenialScan, proposals: RuleProposal[]): DenialScan {
  return {
    ...scan,
    groups: scan.groups.map((group) => ({
      ...group,
      matches: proposals
        .filter((proposal) => groupMatchesProposal(group, proposal))
        .map((proposal) => proposal.chunkId),
    })),
  };
}

export function unmatchedCount(scan: DenialScan): number {
  return scan.groups.filter((group) => group.matches.length === 0).length;
}

/** What the badges show: the last read's unmatched count and its age. */
export interface DenialBadge {
  unmatched: number;
  window: LogWindow;
  readAt: number;
}

/**
 * Per-`(sandbox, window)` scan cache plus the last matched result per
 * sandbox for the badges. Badges read `badge()` only; it never triggers a read.
 */
export class DenialCache {
  private readonly scans = new Map<string, DenialScan>();
  private readonly badges = new Map<string, DenialBadge>();

  constructor(private readonly ttlMs: number = DENIAL_CACHE_MS) {}

  get(name: string, window: LogWindow, now: number): DenialScan | null {
    const scan = this.scans.get(JSON.stringify([name, window]));
    return scan && now - scan.readAt < this.ttlMs ? scan : null;
  }

  put(name: string, scan: DenialScan): void {
    this.scans.set(JSON.stringify([name, scan.window]), scan);
  }

  recordBadge(name: string, matched: DenialScan): void {
    this.badges.set(name, {
      unmatched: unmatchedCount(matched),
      window: matched.window,
      readAt: matched.readAt,
    });
  }

  badge(name: string): DenialBadge | null {
    return this.badges.get(name) ?? null;
  }
}
