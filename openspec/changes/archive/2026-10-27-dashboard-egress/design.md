# Design

## Context

See proposal.md - Why. In place today:

- `OpenShellClient.spawnLogs(name)` runs `openshell logs <name> --tail` for the live SSE stream (`src/logs.ts`). The helper's `logs` command shows the CLI also takes `--since`, `--source`, `--level`, and `-n` for a one-shot read.
- Real denial lines, recorded in `docs/verification-log.md` and the upstream logs page, come in two shapes:
  - `[ts] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(0) -> example.com:443 [reason:transparent_tcp_policy_denied]`
  - `[ts] [sandbox] [OCSF ] [ocsf] NET:REFUSE [MED] DENIED example.com [reason:policy_dns_ineligible]`
  The upstream example also ends with `[policy:- engine:opa]` instead of a `reason:`.
- `RuleProposal` (from `openshell rule get`) has `endpoints` as text such as `api.example.com:443 (rest, enforce)`, possibly several comma-separated, and `binaries: string[]`.
- The OCSF JSON export would be easier to parse, but upstream says its files live in the supervisor's filesystem and `sandbox exec` cannot read them. The shorthand in `openshell logs` is the only source the dashboard can reach through the CLI.

## Goals / Non-Goals

**Goals:**

- One bounded CLI call per sandbox per refresh, never per poll tick.
- Matching rules simple enough to state in the spec and test exhaustively.

**Non-Goals:**

- A durable denial history across restarts.
- Parsing non-`NET:` OCSF classes (`CONFIG:*`, `PROC:*`, HTTP L7 events). Unknown classes with `DENIED` count as unparsed, so they stay visible.

## Decisions

### D1: One-shot bounded read

`openshell logs <name> --since <15m|1h|6h> --source sandbox -n 5000`, with a 20-second timeout, through the existing `run()` (argv array, no shell, normalized errors). `--since` takes the window directly; `-n` caps memory on a noisy sandbox, and the response says when the cap was hit ("showing the last 5000 lines"). The window is an enum, never free text, so the client cannot inject flags.

Alternatives: tap the live `LogHub` buffer. It holds only what arrived since a stream started, so the view would be empty until the user opened Logs. Rejected.

### D2: Parser

Strip ANSI (existing `stripAnsi`), then match `^\[(?<ts>[\d.]+)\] \[(?<src>[^\]]+)\] \[OCSF\s*\] \[ocsf\] (?<class>[A-Z]+:[A-Z_]+) \[(?<sev>[A-Z]+)\] DENIED (?<rest>.*)$`. Lines without `[OCSF` or without ` DENIED ` are skipped cheaply. `rest` is parsed as:

- `<binary>(<pid>) -> <host>:<port>` followed by bracketed tags, or
- `<host>` followed by bracketed tags.

Bracketed tags are `key:value` pairs; `reason` is collected, others are ignored. IPv6 destinations (`[::1]:443`) are handled by taking the last `:` after a closing `]`. A `DENIED` line that fits neither shape increments `unparsed` and keeps its raw text (first 5 kept) for the UI. The parser is a pure function with table-driven tests over the recorded real lines.

### D3: Grouping and matching on the server

`src/egress.ts` groups by `(host lowercased, port|null, binary|null)` and matches against the pending proposals fetched in the same request (`rule get --status pending`, already a client method). Endpoint text is split on `,`, each item's leading `host:port` taken before any space. The match rule is the spec's, as one function. The response is `{ window, capped, unparsed, unparsedSamples, groups: [{ host, port, binary, count, firstSeen, lastSeen, reasons, matches: [chunkId] }] }`, and the client renders matched groups under their proposals and the rest under "denied, no proposal".

Doing it server-side keeps one implementation for the Rules view and the badges.

### D4: Token and cache

`GET /api/sandboxes/:name/denials?window=1h` requires `X-Dashboard-Token` (read-only mode included), like the patch route, since log content can carry hostnames and command paths. A per-`(name, window)` cache holds the result for 30 seconds; `?refresh=1` bypasses it. Badges show the unmatched count from the last cached result for that sandbox and nothing when there is none: a badge never triggers a read.

## Risks / Trade-offs

- [OpenShell changes the shorthand format] → Unparsed `DENIED` lines are counted and sampled, not dropped, so a format change shows up as "N unparsed" instead of a quiet empty view. The parser tests use real recorded lines.
- [Large windows on chatty sandboxes] → `-n 5000` cap with a visible notice; the window choices stop at 6 hours.
- [Endpoint text in `rule get` changes] → Matching uses only the leading `host:port` of each item; a failure to parse an endpoint means the denial lands under "no proposal", which is visible and safe.
- [Badges look stale] → They show the age of the read they come from.

## Migration Plan

None. Read-only; rollback is a revert.
