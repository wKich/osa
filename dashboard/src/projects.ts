// osa projects for the dashboard: the state-contract reader, the `osa`
// runner, and the host-change cache.
//
// The project list is file reads only (design D1): registry entries
// `projects/*.toml` and each session's `pending` marker, parsed with Bun's
// TOML parser, plus a `stat` of every `host_path`. Computed values come from
// `osa` alone: `osa status PATH --quick --json` for the host-change result
// (cached per host path, design D2) and `osa status PATH --json` for the full
// sync state on request (design D3).
//
// `osa health SANDBOX --json` reports a registered sandbox's idle stop, MCP
// readiness, and doctor checks on request only (dashboard-health design D4);
// the idle state on each row comes from the quick status already cached.
//
// The one write is `osa resolve SANDBOX ACTION --json` for a registered
// sandbox: nothing here creates, modifies, or deletes a file itself, and the
// runner refuses every `osa` argv except the two `status … --json` shapes,
// `health SANDBOX --json`, and that one `resolve` shape.

import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import type { OpenShellError, OpenShellErrorKind, Result } from "./openshell.ts";

export const CONTRACT_VERSION = "1";
export const HOST_CHANGE_TTL_MS = 60_000;
export const HOST_CHANGE_CONCURRENCY = 2;
export const QUICK_TIMEOUT_MS = 20_000;
export const FULL_TIMEOUT_MS = 30_000;
export const HEALTH_TIMEOUT_MS = 30_000;
export const PATCH_LIMIT_BYTES = 2 * 1024 * 1024;
export const RESOLVE_TIMEOUT_MS = 60_000;
/** Rescue downloads the sandbox workdir, so it gets longer. */
export const RESCUE_TIMEOUT_MS = 120_000;

export const RESOLVE_ACTIONS = ["apply", "branch", "drop", "rescue", "discard"] as const;
export type ResolveAction = (typeof RESOLVE_ACTIONS)[number];
/** Actions osa runs only with `--yes`; the dashboard's typed confirmation is that yes. */
const CONFIRMED_ACTIONS: readonly string[] = ["drop", "discard"];

export function isResolveAction(value: unknown): value is ResolveAction {
  return typeof value === "string" && (RESOLVE_ACTIONS as readonly string[]).includes(value);
}

/** Sandbox names the front-ends generate; anything else is never joined into a path. */
const SANDBOX_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type PendingKind = "" | "retained" | "parked";
export type FingerprintResult = "changed" | "unchanged" | "unknown";

export interface ProjectEntry {
  /** Registry file name, always set; the only field of an unsupported entry. */
  file: string;
  /** False when the file did not parse or has another contract version. */
  supported: boolean;
  version: string;
  agent: string;
  host_path: string;
  project: string;
  sandbox_name: string;
  sandbox_id: string;
  created: string;
  last_session: string;
  fingerprint: string;
  pending: PendingKind;
  orphan: boolean;
  /** Why the row is incomplete or was read with a fallback, or null. */
  note: string | null;
}

export interface ProjectRow extends ProjectEntry {
  /** Host change since the last sync; null until the first check finishes. */
  fingerprintResult: FingerprintResult | null;
  /** When the host-change result was computed, epoch milliseconds, or null. */
  checkedAt: number | null;
  /** The last host-change check's error, or null. */
  osaError: OpenShellError | null;
  /** A session or resolve held the sandbox at the last check. */
  busy: boolean;
  /** The idle-stop state from the last quick status, or null. */
  idle: IdleInfo | null;
}

/** `osa status --quick --json`'s `idle` object. */
export interface IdleInfo {
  period: number | null;
  state: string;
  /** ISO 8601 UTC while `state` is `counting`, else null. */
  deadline: string | null;
  estimated: boolean;
  last_event: string | null;
  last_time: string | null;
}

function idleInfo(value: unknown): IdleInfo | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.state !== "string") return null;
  const text = (key: string): string | null => (typeof record[key] === "string" ? (record[key] as string) : null);
  return {
    period: typeof record.period === "number" ? record.period : null,
    state: record.state,
    deadline: text("deadline"),
    estimated: record.estimated === true,
    last_event: text("last_event"),
    last_time: text("last_time"),
  };
}

export interface PatchView {
  name: string;
  size: number;
  truncated: boolean;
  text: string;
}

// ---------------------------------------------------------------------------
// Contract reader
// ---------------------------------------------------------------------------

/** The state root, resolved like `osa_state_paths`. */
export function resolveStateRoot(env: Record<string, string | undefined> = process.env): string {
  const base = env.XDG_STATE_HOME || join(env.HOME || "/tmp", ".local", "state");
  return join(base, "osa");
}

function parseFlat(path: string): Record<string, unknown> {
  const parsed = Bun.TOML.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("not a TOML table");
  }
  return parsed as Record<string, unknown>;
}

function text(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  return typeof value === "string" ? value : "";
}

function isDirectory(path: string): boolean {
  if (!path) return false;
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function unsupported(file: string, note: string): ProjectEntry {
  return {
    file,
    supported: false,
    version: "",
    agent: "",
    host_path: "",
    project: "",
    sandbox_name: "",
    sandbox_id: "",
    created: "",
    last_session: "",
    fingerprint: "",
    pending: "",
    orphan: false,
    note,
  };
}

/**
 * Reads `sessions/<sandbox>/pending` and returns its kind. A marker with no
 * `kind` (or one that cannot be read) is reported as parked with a note; the
 * dashboard does not reproduce `pending_kind`'s pre-contract patch fallback.
 */
function readPending(root: string, sandbox: string): { pending: PendingKind; note: string | null } {
  const path = join(root, "sessions", sandbox, "pending");
  if (!existsSync(path)) return { pending: "", note: null };
  let values: Record<string, unknown>;
  try {
    values = parseFlat(path);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { pending: "parked", note: `pending marker could not be parsed: ${message}` };
  }
  if (text(values, "version") !== CONTRACT_VERSION) {
    return { pending: "parked", note: "pending marker has an unsupported contract version" };
  }
  const kind = text(values, "kind");
  if (kind === "retained" || kind === "parked") return { pending: kind, note: null };
  if (!kind) return { pending: "parked", note: "pending marker has no kind; shown as parked" };
  return { pending: "parked", note: `pending marker has an unknown kind '${kind}'; shown as parked` };
}

function readEntry(root: string, file: string): ProjectEntry {
  let values: Record<string, unknown>;
  try {
    values = parseFlat(join(root, "projects", file));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return unsupported(file, `registry entry could not be parsed: ${message}`);
  }
  const version = text(values, "version");
  if (version !== CONTRACT_VERSION) {
    return unsupported(file, `unsupported contract version ${JSON.stringify(version)}`);
  }
  const entry: ProjectEntry = {
    file,
    supported: true,
    version,
    agent: text(values, "agent"),
    host_path: text(values, "host_path"),
    project: text(values, "project"),
    sandbox_name: text(values, "sandbox_name"),
    sandbox_id: text(values, "sandbox_id"),
    created: text(values, "created"),
    last_session: text(values, "last_session"),
    fingerprint: text(values, "fingerprint"),
    pending: "",
    orphan: !isDirectory(text(values, "host_path")),
    note: null,
  };
  if (!SANDBOX_NAME.test(entry.sandbox_name)) {
    entry.note = `invalid sandbox name ${JSON.stringify(entry.sandbox_name)}`;
    return entry;
  }
  const pending = readPending(root, entry.sandbox_name);
  entry.pending = pending.pending;
  entry.note = pending.note;
  return entry;
}

/** Every registry entry, sorted by file name; a missing registry is empty. */
export function listProjects(root: string): ProjectEntry[] {
  let names: string[];
  try {
    names = readdirSync(join(root, "projects"));
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".toml"))
    .filter((name) => {
      try {
        return statSync(join(root, "projects", name)).isFile();
      } catch {
        return false;
      }
    })
    .sort()
    .map((name) => readEntry(root, name));
}

/** The supported registry entry for a sandbox name, or null. */
export function findProject(root: string, sandbox: string): ProjectEntry | null {
  if (!SANDBOX_NAME.test(sandbox)) return null;
  return (
    listProjects(root).find((entry) => entry.supported && entry.sandbox_name === sandbox) ?? null
  );
}

// ---------------------------------------------------------------------------
// osa runner
// ---------------------------------------------------------------------------

/** `DASHBOARD_OSA_BIN`, else `bin/osa` next to the dashboard, else `osa` (design D4). */
export function resolveOsaBinary(
  env: Record<string, string | undefined> = process.env,
  repoRoot: string = join(import.meta.dir, "..", ".."),
): string {
  const configured = env.DASHBOARD_OSA_BIN?.trim();
  if (configured) return configured;
  const bundled = join(repoRoot, "bin", "osa");
  return existsSync(bundled) ? bundled : "osa";
}

/** `osa resolve SANDBOX ACTION --json`, with `--yes` for drop and discard (design D1). */
export function resolveArgv(sandbox: string, action: ResolveAction): string[] {
  const args = ["resolve", sandbox, action, "--json"];
  if (CONFIRMED_ACTIONS.includes(action)) args.push("--yes");
  return args;
}

/**
 * The only `osa` argv shapes the dashboard may spawn: `status PATH --json` and
 * `status PATH --quick --json`, with PATH absolute so it cannot read as an
 * option, and `resolve SANDBOX ACTION --json` plus `--yes` for drop and
 * discard only, with SANDBOX a generated sandbox name.
 */
export function isAllowedOsaArgv(args: readonly string[]): boolean {
  if (args[0] === "health") {
    return args.length === 3 && SANDBOX_NAME.test(args[1] ?? "") && args[2] === "--json";
  }
  if (args[0] === "resolve") {
    const [, sandbox = "", action] = args;
    if (!SANDBOX_NAME.test(sandbox) || !isResolveAction(action)) return false;
    const expected = resolveArgv(sandbox, action);
    return args.length === expected.length && expected.every((arg, index) => args[index] === arg);
  }
  const path = args[1] ?? "";
  if (args[0] !== "status" || !path.startsWith("/")) return false;
  if (args.length === 3) return args[2] === "--json";
  if (args.length === 4) return args[2] === "--quick" && args[3] === "--json";
  return false;
}

export interface OsaRunnerOptions {
  /** Binary name or path; defaults to `resolveOsaBinary()`. */
  binary?: string;
  env?: Record<string, string | undefined>;
}

function fail(
  kind: OpenShellErrorKind,
  message: string,
  extra: Partial<OpenShellError> = {},
): Result<never> {
  return { ok: false, error: { kind, message, ...extra } };
}

export interface OsaOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  argv: string[];
}

export class OsaRunner {
  readonly binary: string;
  private readonly env: Record<string, string | undefined>;

  constructor(options: OsaRunnerOptions = {}) {
    this.binary = options.binary ?? resolveOsaBinary();
    this.env = { ...process.env, NO_COLOR: "1", ...options.env };
  }

  /** Spawns `osa` with an argv array (no shell) and parses its JSON stdout. */
  async runJson(args: string[], timeoutMs: number): Promise<Result<unknown>> {
    const output = await this.run(args, timeoutMs);
    if (!output.ok) return output;
    const { exitCode, stdout, stderr, argv } = output.value;
    if (exitCode !== 0) {
      const detail = stderr.trim() || stdout.trim();
      return fail("exit", detail || `osa exited with code ${exitCode}`, { exitCode, detail, argv });
    }
    return parseJson(stdout, argv);
  }

  /** Spawns `osa` with an argv array (no shell); any exit code is a result. */
  async run(args: string[], timeoutMs: number): Promise<Result<OsaOutput>> {
    if (!isAllowedOsaArgv(args)) {
      return fail("invalid_request", `refusing to run osa ${args.join(" ")}`);
    }
    const argv = [this.binary, ...args];
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn({ cmd: argv, env: this.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const code = (cause as { code?: string } | undefined)?.code;
      if (code === "ENOENT" || /ENOENT|not found|No such file/.test(message)) {
        return fail("missing_cli", `osa not found: ${this.binary}`, { detail: message, argv });
      }
      return fail("spawn", `failed to start osa: ${message}`, { detail: message, argv });
    }

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {
        // The process may have already exited; the timeout result stands.
      }
    }, timeoutMs);
    // Read the pipes alongside the exit so a large output cannot block the child.
    const stdoutText = proc.stdout ? new Response(proc.stdout).text() : Promise.resolve("");
    const stderrText = proc.stderr ? new Response(proc.stderr).text() : Promise.resolve("");
    let exitCode: number;
    try {
      exitCode = await proc.exited;
    } finally {
      clearTimeout(timer);
    }
    if (timedOut) {
      return fail("timeout", `osa ${args.join(" ")} timed out after ${timeoutMs} ms`, { argv });
    }
    const [stdout, stderr] = await Promise.all([stdoutText, stderrText]);
    return { ok: true, value: { exitCode, stdout, stderr, argv } };
  }
}

function parseJson(stdout: string, argv: string[]): Result<unknown> {
  try {
    return { ok: true, value: JSON.parse(stdout) };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return fail("invalid_json", `could not parse osa output as JSON: ${message}`, {
      detail: stdout.slice(0, 500),
      argv,
    });
  }
}

// ---------------------------------------------------------------------------
// Host-change cache
// ---------------------------------------------------------------------------

interface HostCheck {
  at: number;
  /** fingerprint_result by sandbox_name, from one quick status of the path. */
  results: Map<string, FingerprintResult>;
  /** Sandboxes the quick status reported `busy`. */
  busy: Set<string>;
  /** `idle` by sandbox_name. */
  idle: Map<string, IdleInfo>;
  error: OpenShellError | null;
}

/**
 * `osa status PATH --quick --json` results keyed by host path (design D2).
 * Results stay fresh for 60 seconds; stale or missing paths are checked in
 * the background, at most two at a time. Checks are only ever scheduled by a
 * caller (the `/api/projects` route), so nothing runs while no client polls.
 */
export class HostChangeCache {
  private readonly checks = new Map<string, HostCheck>();
  private readonly queue: string[] = [];
  private readonly inflight = new Set<string>();
  private running = 0;
  private generation = 0;
  /** Per-path generation, bumped by `drop`. */
  private readonly pathGenerations = new Map<string, number>();
  private waiters: Array<() => void> = [];

  constructor(
    private readonly runner: OsaRunner,
    private readonly options: {
      ttlMs?: number;
      concurrency?: number;
      now?: () => number;
      timeoutMs?: number;
    } = {},
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  get(hostPath: string): HostCheck | null {
    return this.checks.get(hostPath) ?? null;
  }

  /** Drops every result, so the next `schedule` checks every path again. */
  clear(): void {
    this.checks.clear();
    this.queue.length = 0;
    this.generation += 1;
  }

  /** Drops one path's result, so the next `schedule` checks it again. */
  drop(hostPath: string): void {
    this.checks.delete(hostPath);
    const index = this.queue.indexOf(hostPath);
    if (index >= 0) this.queue.splice(index, 1);
    this.pathGenerations.set(hostPath, (this.pathGenerations.get(hostPath) ?? 0) + 1);
  }

  /** Queues a check for each path whose result is missing or stale. */
  schedule(hostPaths: Iterable<string>): void {
    const ttl = this.options.ttlMs ?? HOST_CHANGE_TTL_MS;
    for (const path of new Set(hostPaths)) {
      if (this.inflight.has(path) || this.queue.includes(path)) continue;
      const check = this.checks.get(path);
      if (check && this.now() - check.at < ttl) continue;
      this.queue.push(path);
    }
    this.pump();
  }

  /** Resolves once no check is queued or running (for tests). */
  idle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private pump(): void {
    const limit = this.options.concurrency ?? HOST_CHANGE_CONCURRENCY;
    while (this.running < limit && this.queue.length > 0) {
      const path = this.queue.shift()!;
      this.running += 1;
      this.inflight.add(path);
      void this.check(path).finally(() => {
        this.running -= 1;
        this.inflight.delete(path);
        this.pump();
        if (this.running === 0 && this.queue.length === 0) {
          const waiters = this.waiters;
          this.waiters = [];
          for (const resolve of waiters) resolve();
        }
      });
    }
  }

  private async check(path: string): Promise<void> {
    const generation = this.generation;
    const pathGeneration = this.pathGenerations.get(path) ?? 0;
    const result = await this.runner.runJson(
      ["status", path, "--quick", "--json"],
      this.options.timeoutMs ?? QUICK_TIMEOUT_MS,
    );
    // A `clear()` or `drop()` while this ran means the caller asked for a fresh result.
    if (generation !== this.generation) return;
    if (pathGeneration !== (this.pathGenerations.get(path) ?? 0)) return;
    const check: HostCheck = {
      at: this.now(),
      results: new Map(),
      busy: new Set(),
      idle: new Map(),
      error: null,
    };
    if (!result.ok) {
      check.error = result.error;
    } else if (!Array.isArray(result.value)) {
      check.error = { kind: "invalid_json", message: "osa status did not return an array" };
    } else {
      for (const item of result.value) {
        if (typeof item !== "object" || item === null) continue;
        const record = item as Record<string, unknown>;
        if (typeof record.sandbox_name === "string" && record.busy === true) {
          check.busy.add(record.sandbox_name);
        }
        const idle = idleInfo(record.idle);
        if (typeof record.sandbox_name === "string" && idle) check.idle.set(record.sandbox_name, idle);
        const value = record.fingerprint_result;
        if (
          typeof record.sandbox_name === "string" &&
          (value === "changed" || value === "unchanged" || value === "unknown")
        ) {
          check.results.set(record.sandbox_name, value);
        }
      }
    }
    this.checks.set(path, check);
  }
}

// ---------------------------------------------------------------------------
// Service used by the server routes
// ---------------------------------------------------------------------------

export interface ProjectServiceOptions {
  /** State root; defaults to `resolveStateRoot()`. */
  stateRoot?: string;
  runner?: OsaRunner;
  runnerOptions?: OsaRunnerOptions;
  cache?: { ttlMs?: number; concurrency?: number; now?: () => number; timeoutMs?: number };
  /** Full status timeout, milliseconds (default 30 s). */
  fullTimeoutMs?: number;
  /** Health timeout, milliseconds (default 30 s). */
  healthTimeoutMs?: number;
  /** Resolve timeouts, milliseconds (default 60 s, and 120 s for rescue). */
  resolveTimeoutMs?: number;
  rescueTimeoutMs?: number;
}

export type ServiceResult<T> =
  | { ok: true; value: T }
  /** `status` is the HTTP status; when absent the server derives it from the error kind. */
  | { ok: false; status?: number; error: OpenShellError | { kind: string; message: string } };

/** `osa resolve --json`'s result object. */
export interface ResolveResult {
  sandbox: string;
  action: string;
  ok: boolean;
  changed: string[];
  message: string;
}

/**
 * A resolve reply (design D1): HTTP 200 for exit 0 and 409 for exit 2 carry
 * osa's object plus `exitCode` (409 also an `error`); any other outcome is an
 * `error`, with osa's object when it printed one. `status` is absent when osa
 * never ran to completion; the server derives it from the error kind.
 */
export interface ResolveReply {
  status?: number;
  body: Partial<ResolveResult> & {
    exitCode?: number;
    error?: OpenShellError | { kind: string; message: string; detail?: string };
  };
}

function resolveResult(value: unknown): ResolveResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.ok !== "boolean" || !Array.isArray(record.changed)) return null;
  return {
    sandbox: typeof record.sandbox === "string" ? record.sandbox : "",
    action: typeof record.action === "string" ? record.action : "",
    ok: record.ok,
    changed: record.changed.map((entry) => String(entry)),
    message: typeof record.message === "string" ? record.message : "",
  };
}

export class ProjectService {
  readonly stateRoot: string;
  readonly runner: OsaRunner;
  readonly cache: HostChangeCache;
  private readonly fullTimeoutMs: number;
  private readonly healthTimeoutMs: number;
  private readonly resolveTimeoutMs: number;
  private readonly rescueTimeoutMs: number;
  /** Sandboxes with a resolve running (design D2). */
  private readonly resolving = new Set<string>();

  constructor(options: ProjectServiceOptions = {}) {
    this.stateRoot = options.stateRoot ?? resolveStateRoot();
    this.fullTimeoutMs = options.fullTimeoutMs ?? FULL_TIMEOUT_MS;
    this.healthTimeoutMs = options.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
    this.resolveTimeoutMs = options.resolveTimeoutMs ?? RESOLVE_TIMEOUT_MS;
    this.rescueTimeoutMs = options.rescueTimeoutMs ?? RESCUE_TIMEOUT_MS;
    this.runner = options.runner ?? new OsaRunner(options.runnerOptions);
    this.cache = new HostChangeCache(this.runner, options.cache);
  }

  /**
   * The project rows with cached host-change results; schedules stale checks.
   * With `path`, only the rows registered at that host path, and only that
   * path is checked or, with `refresh`, dropped (design D4).
   */
  list(options: { refresh?: boolean; path?: string } = {}): ProjectRow[] {
    const { path } = options;
    if (options.refresh) {
      if (path === undefined) this.cache.clear();
      else this.cache.drop(path);
    }
    let entries = listProjects(this.stateRoot);
    if (path !== undefined) entries = entries.filter((entry) => entry.supported && entry.host_path === path);
    this.cache.schedule(
      entries.filter((entry) => entry.supported && !entry.orphan).map((entry) => entry.host_path),
    );
    return entries.map((entry): ProjectRow => {
      const none = { fingerprintResult: null, checkedAt: null, osaError: null, busy: false, idle: null };
      if (!entry.supported) return { ...entry, ...none };
      if (entry.orphan) return { ...entry, ...none, fingerprintResult: "unknown" };
      const check = this.cache.get(entry.host_path);
      if (!check) return { ...entry, ...none };
      return {
        ...entry,
        fingerprintResult: check.error ? null : (check.results.get(entry.sandbox_name) ?? "unknown"),
        checkedAt: check.at,
        osaError: check.error,
        busy: check.busy.has(entry.sandbox_name),
        idle: check.idle.get(entry.sandbox_name) ?? null,
      };
    });
  }

  /** `osa status HOST_PATH --json`, narrowed to this sandbox's object (design D3). */
  async status(sandbox: string): Promise<ServiceResult<unknown>> {
    const entry = findProject(this.stateRoot, sandbox);
    if (!entry) return notRegistered(sandbox);
    const result = await this.runner.runJson(["status", entry.host_path, "--json"], this.fullTimeoutMs);
    if (!result.ok) return { ok: false, error: result.error };
    const items = Array.isArray(result.value) ? result.value : [];
    const match = items.find(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as Record<string, unknown>).sandbox_name === sandbox,
    );
    if (!match) {
      return {
        ok: false,
        status: 502,
        error: { kind: "invalid_json", message: `osa status reported nothing for ${sandbox}` },
      };
    }
    return { ok: true, value: match };
  }

  /**
   * `osa health SANDBOX --json` for a registered sandbox (dashboard-health
   * design D4): 404 for an unregistered sandbox, never cached, never run by
   * the list.
   */
  async health(sandbox: string): Promise<ServiceResult<unknown>> {
    const entry = findProject(this.stateRoot, sandbox);
    if (!entry || !entry.supported) return notRegistered(sandbox);
    const result = await this.runner.runJson(["health", entry.sandbox_name, "--json"], this.healthTimeoutMs);
    if (!result.ok) return { ok: false, error: result.error };
    if (typeof result.value !== "object" || result.value === null || Array.isArray(result.value)) {
      return {
        ok: false,
        status: 502,
        error: { kind: "invalid_json", message: "osa health did not return an object" },
      };
    }
    return { ok: true, value: result.value };
  }

  /**
   * Runs `osa resolve SANDBOX ACTION --json` for a registered sandbox (design
   * D1, D2): 400 for an unknown action, 404 for an unregistered sandbox, 409
   * while another resolve for it runs. Drops the cached quick status for the
   * entry's host path afterwards, whatever the outcome.
   */
  async resolve(sandbox: string, action: unknown): Promise<ResolveReply> {
    if (!isResolveAction(action)) {
      const message = `action must be one of ${RESOLVE_ACTIONS.join(", ")}`;
      return { status: 400, body: { error: { kind: "invalid_request", message } } };
    }
    const entry = findProject(this.stateRoot, sandbox);
    if (!entry) {
      const message = `no registered project for sandbox ${sandbox}`;
      return { status: 404, body: { error: { kind: "not_found", message } } };
    }
    if (this.resolving.has(sandbox)) {
      const message = `a resolve for ${sandbox} is already running`;
      return { status: 409, body: { error: { kind: "busy", message } } };
    }
    this.resolving.add(sandbox);
    let output: Result<OsaOutput>;
    try {
      const timeoutMs = action === "rescue" ? this.rescueTimeoutMs : this.resolveTimeoutMs;
      output = await this.runner.run(resolveArgv(sandbox, action), timeoutMs);
    } finally {
      this.resolving.delete(sandbox);
      this.cache.drop(entry.host_path);
    }
    if (!output.ok) return { body: { error: output.error } };
    const { exitCode, stdout, stderr, argv } = output.value;
    const parsed = parseJson(stdout, argv);
    const result = parsed.ok ? resolveResult(parsed.value) : null;
    const detail = stderr.trim();
    if (result && exitCode === 0) return { status: 200, body: { ...result, exitCode } };
    if (result && exitCode === 2) {
      const message = result.message || "osa refused; nothing changed";
      return { status: 409, body: { ...result, exitCode, error: { kind: "refused", message, detail } } };
    }
    if (!result) {
      const error = parsed.ok
        ? { kind: "invalid_json", message: "osa resolve did not print a result object", detail }
        : { ...parsed.error, detail: detail || parsed.error.detail };
      return { status: 502, body: { exitCode, error } };
    }
    const message = result.message || `osa resolve exited with code ${exitCode}`;
    return { status: 502, body: { ...result, exitCode, error: { kind: "exit", message, detail } } };
  }

  /** The retained patch for a sandbox, confined to its session directory (design D5). */
  patch(sandbox: string): ServiceResult<PatchView> {
    const entry = findProject(this.stateRoot, sandbox);
    if (!entry) return notRegistered(sandbox);
    const sessionDir = join(this.stateRoot, "sessions", entry.sandbox_name);
    const markerPath = join(sessionDir, "pending");
    if (!existsSync(markerPath)) return noPatch(sandbox);
    let patch = "";
    try {
      patch = text(parseFlat(markerPath), "patch");
    } catch {
      return noPatch(sandbox);
    }
    if (!patch) return noPatch(sandbox);
    const refused = (message: string): ServiceResult<never> => ({
      ok: false,
      status: 403,
      error: { kind: "refused", message },
    });
    if (!isAbsolute(patch)) return refused("the marker's patch path is not absolute");
    let realPatch: string;
    let realSession: string;
    try {
      realSession = realpathSync(sessionDir);
      realPatch = realpathSync(patch);
    } catch {
      return noPatch(sandbox);
    }
    if (dirname(realPatch) !== realSession) {
      return refused("the patch is outside this sandbox's session directory");
    }
    let size: number;
    try {
      const info = statSync(realPatch);
      if (!info.isFile()) return refused("the patch is not a regular file");
      size = info.size;
    } catch {
      return noPatch(sandbox);
    }
    return {
      ok: true,
      value: {
        name: realPatch.slice(realSession.length + 1),
        size,
        truncated: size > PATCH_LIMIT_BYTES,
        text: this.readPatchFile(realPatch, PATCH_LIMIT_BYTES),
      },
    };
  }

  /** The only place patch bytes are read; at most `limit` bytes. */
  readPatchFile(path: string, limit: number): string {
    return new TextDecoder().decode(readHead(path, limit));
  }
}

/** Reads at most `limit` bytes from the start of a file. */
function readHead(path: string, limit: number): Uint8Array {
  const fd = openSync(path, "r");
  try {
    const buffer = new Uint8Array(limit);
    let total = 0;
    while (total < limit) {
      const count = readSync(fd, buffer, total, limit - total, null);
      if (count === 0) break;
      total += count;
    }
    return buffer.subarray(0, total);
  } finally {
    closeSync(fd);
  }
}

function notRegistered(sandbox: string): ServiceResult<never> {
  return {
    ok: false,
    status: 404,
    error: { kind: "not_found", message: `no registered project for sandbox ${sandbox}` },
  };
}

function noPatch(sandbox: string): ServiceResult<never> {
  return {
    ok: false,
    status: 404,
    error: { kind: "no_patch", message: `no retained patch for sandbox ${sandbox}` },
  };
}
