// CLI adapter for the OpenShell dashboard.
//
// Everything the dashboard knows about a gateway comes through here: each
// method spawns `openshell` with an argv array (no shell), reads stdout, and
// parses the documented JSON shapes. Swapping in the OpenShell TypeScript SDK
// later means reimplementing this module only.
//
// Shapes are pinned to OpenShell v0.1.2 (`sandbox list|get|create`,
// `policy get|list`, `rule get|approve|reject`, `settings get`, `status`,
// `logs`). `rule get` and `logs` have no JSON output mode, so the rule
// table's stable field-per-line layout and the logs' OCSF shorthand denial
// lines are parsed and covered by tests.

export type OpenShellErrorKind =
  | "missing_cli"
  | "timeout"
  | "exit"
  | "invalid_json"
  | "spawn"
  | "invalid_request";

export interface OpenShellError {
  kind: OpenShellErrorKind;
  /** Human-readable message, safe to render in the UI. */
  message: string;
  /** Raw CLI output excerpt for the error panel. */
  detail?: string;
  exitCode?: number;
  argv?: string[];
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: OpenShellError };

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function fail(
  kind: OpenShellErrorKind,
  message: string,
  extra: Partial<OpenShellError> = {},
): Result<never> {
  return { ok: false, error: { kind, message, ...extra } };
}

// ---------------------------------------------------------------------------
// Typed models
// ---------------------------------------------------------------------------

export interface SandboxCondition {
  type: string;
  status: string;
  reason: string;
  message: string;
  lastTransitionTime: string;
}

export interface SandboxSummary {
  id: string;
  name: string;
  workspace: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  resourceVersion: number;
  createdAt: string;
  phase: string;
  currentPolicyVersion: number;
  exitCode: number | null;
  conditions: SandboxCondition[];
  /** Invalid-configuration note from configuration admission or conditions. */
  note: string | null;
}

export interface SandboxDetail extends SandboxSummary {
  restartPolicy: string;
  mainProcessInstanceId: string;
  restartCount: number;
  policySource: string;
  revision: number | null;
  policy: unknown;
}

export interface SandboxProvider {
  name: string;
  type: string;
  credentialKeys: string[];
  configKeys: string[];
}

export type PolicyView = "base" | "full";

export interface PolicyInfo {
  scope: string;
  sandbox: string;
  version: number;
  activeVersion: number;
  hash: string;
  status: string;
  configRevision: number;
  policySource: string;
  globalPolicyVersion: number | null;
  policy: unknown;
}

export interface PolicyRevision {
  version: number;
  hash: string;
  status: string;
  createdAtMs: number | null;
  loadedAtMs: number | null;
  loadError: string | null;
  provenance: string | null;
}

export interface RuleProposal {
  chunkId: string;
  status: string;
  ruleName: string;
  binary: string | null;
  confidence: number | null;
  rationale: string | null;
  securityNotes: string | null;
  prover: string | null;
  applicationError: string | null;
  candidateHash: string | null;
  endpoints: string | null;
  binaries: string[];
}

export interface SettingsInfo {
  sandbox: string;
  workspace: string;
  configRevision: number;
  policySource: string;
  policyHash: string;
  settings: Record<string, { value: unknown; scope: string }>;
}

export interface DoctorReport {
  cli: { ok: boolean; version: string | null; error: string | null };
  gateway: {
    ok: boolean;
    status: string | null;
    gateway: string | null;
    server: string | null;
    version: string | null;
    error: string | null;
  };
}

export interface ActionResult {
  message: string;
  sandbox: unknown;
}

export interface CreateSandboxParams {
  name: string;
  image?: string;
  policy?: string;
  providers?: string[];
  cpu?: string;
  memory?: string;
}

export interface RunOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface LogsProcess {
  pid: number;
  stdout: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}

export interface OpenShellClientOptions {
  /** CLI binary name or path. Defaults to DASHBOARD_OPENSHELL_BIN or `openshell`. */
  binary?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Default timeout for JSON commands, milliseconds. 0 disables. */
  timeoutMs?: number;
}

/** Per-command timeout defaults; long-running mutations get more room. */
const READ_TIMEOUT_MS = 20_000;
const MUTATION_TIMEOUT_MS = 300_000;
const CREATE_TIMEOUT_MS = 600_000;

// ---------------------------------------------------------------------------
// JSON shaping helpers
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringRecord(value: unknown): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(asObject(value))) {
    if (typeof entry === "string") record[key] = entry;
  }
  return record;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function mapCondition(value: unknown): SandboxCondition {
  const raw = asObject(value);
  return {
    type: asString(raw.type),
    status: asString(raw.status),
    reason: asString(raw.reason),
    message: asString(raw.message),
    lastTransitionTime: asString(raw.last_transition_time),
  };
}

function sandboxNote(raw: JsonObject): string | null {
  const admission = asObject(raw.configuration_admission);
  if (asString(admission.state) === "rejected") {
    const error = asString(admission.error);
    return error ? `Invalid config: ${error}` : "Invalid config";
  }
  for (const entry of asArray(raw.conditions)) {
    const condition = asObject(entry);
    const type = asString(condition.type);
    if (
      (type === "ConfigurationReady" || type === "DesiredConfigurationReady") &&
      asString(condition.status).toLowerCase() === "false"
    ) {
      const reason = asString(condition.reason) || "rejected";
      const message = asString(condition.message);
      return message ? `Invalid config (${reason}): ${message}` : `Invalid config (${reason})`;
    }
  }
  return null;
}

function mapSandbox(value: unknown): SandboxSummary {
  const raw = asObject(value);
  return {
    id: asString(raw.id),
    name: asString(raw.name),
    workspace: asString(raw.workspace),
    labels: asStringRecord(raw.labels),
    annotations: asStringRecord(raw.annotations),
    resourceVersion: asNumber(raw.resource_version),
    createdAt: asString(raw.created_at),
    phase: asString(raw.phase) || "Unknown",
    currentPolicyVersion: asNumber(raw.current_policy_version),
    exitCode: asOptionalNumber(raw.exit_code),
    conditions: asArray(raw.conditions).map(mapCondition),
    note: sandboxNote(raw),
  };
}

function mapPolicyRevision(value: unknown): PolicyRevision {
  const raw = asObject(value);
  return {
    version: asNumber(raw.version),
    hash: asString(raw.hash),
    status: asString(raw.status),
    createdAtMs: asOptionalNumber(raw.created_at_ms),
    loadedAtMs: asOptionalNumber(raw.loaded_at_ms),
    loadError: asString(raw.load_error) || null,
    provenance: asString(raw.provenance) || null,
  };
}

// ---------------------------------------------------------------------------
// Rule table parsing (`openshell rule get` has no JSON mode)
// ---------------------------------------------------------------------------

// eslint-style note: keep this regex in sync with the CLI formatter.
const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g;
const RULE_FIELD_PATTERN =
  /^\s*(Chunk|Status|Rule|Binary|Confidence|Rationale|Security|Prover|Application|Candidate|Endpoints|Binaries|Hits):\s*(.*)$/;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

function parseConfidence(value: string): number | null {
  const match = /^([0-9]+(?:\.[0-9]+)?)%$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) / 100;
}

export function parseRuleTable(output: string): RuleProposal[] {
  const proposals: RuleProposal[] = [];
  let current: Partial<RuleProposal> | null = null;

  const finalize = (): void => {
    if (!current || !current.chunkId) return;
    proposals.push({
      chunkId: current.chunkId,
      status: current.status ?? "unknown",
      ruleName: current.ruleName ?? "",
      binary: current.binary ?? null,
      confidence: current.confidence ?? null,
      rationale: current.rationale ?? null,
      securityNotes: current.securityNotes ?? null,
      prover: current.prover ?? null,
      applicationError: current.applicationError ?? null,
      candidateHash: current.candidateHash ?? null,
      endpoints: current.endpoints ?? null,
      binaries: current.binaries ?? [],
    });
  };

  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const match = RULE_FIELD_PATTERN.exec(line);
    if (!match) continue;
    const label = match[1] ?? "";
    const value = (match[2] ?? "").trim();
    if (label === "Chunk") {
      finalize();
      current = { chunkId: value };
      continue;
    }
    if (!current) continue;
    switch (label) {
      case "Status":
        current.status = value;
        break;
      case "Rule":
        current.ruleName = value;
        break;
      case "Binary":
        current.binary = value;
        break;
      case "Confidence":
        current.confidence = parseConfidence(value);
        break;
      case "Rationale":
        current.rationale = value;
        break;
      case "Security":
        current.securityNotes = value;
        break;
      case "Prover":
        current.prover = value;
        break;
      case "Application":
        current.applicationError = value;
        break;
      case "Candidate":
        current.candidateHash = value;
        break;
      case "Endpoints":
        current.endpoints = value;
        break;
      case "Binaries":
        current.binaries = value ? value.split(/,\s*/) : [];
        break;
    }
  }
  finalize();
  return proposals;
}

// ---------------------------------------------------------------------------
// OCSF shorthand denials (`openshell logs` has no JSON mode either)
// ---------------------------------------------------------------------------

export interface DenialEvent {
  /** Log timestamp, milliseconds since the epoch. */
  timeMs: number;
  source: string;
  eventClass: string;
  severity: string;
  host: string;
  port: number | null;
  binary: string | null;
  pid: number | null;
  reason: string | null;
}

export type DenialLine =
  | { kind: "denial"; event: DenialEvent }
  | { kind: "unparsed"; raw: string }
  | { kind: "skip" };

const OCSF_DENIAL_PATTERN =
  /^\[(?<ts>[\d.]+)\] \[(?<src>[^\]]+)\] \[OCSF\s*\] \[ocsf\] (?<cls>[A-Z]+:[A-Z_]+) \[(?<sev>[A-Z]+)\] DENIED (?<rest>.*)$/;
/** A trailing bracketed tag group such as `[reason:x]` or `[policy:- engine:opa]`. */
const DENIAL_TAG_PATTERN = /^(?<body>.*?)\s*\[(?<tag>[a-z][a-z_]*:[^\[\]]*)\]$/;
const DENIAL_FLOW_PATTERN = /^(?<binary>\S+?)(?:\((?<pid>\d+)\))? -> (?<dest>.+)$/;

function splitDestination(dest: string): { host: string; port: number } | null {
  // `[v6]:port` keeps its brackets out of the host; otherwise the port follows
  // the last colon.
  const v6 = /^\[(?<host>[0-9A-Fa-f:.]+)\]:(?<port>\d+)$/.exec(dest);
  if (v6?.groups) return { host: v6.groups.host ?? "", port: Number(v6.groups.port) };
  const colon = dest.lastIndexOf(":");
  if (colon <= 0) return null;
  const port = dest.slice(colon + 1);
  if (!/^\d+$/.test(port)) return null;
  return { host: dest.slice(0, colon), port: Number(port) };
}

/**
 * Classify one `openshell logs` line (design D2): an OCSF `NET:*` denial, a
 * denial the shapes below do not fit (`unparsed`, kept so a format change
 * stays visible), or anything else (`skip`).
 *
 * Shapes: `<binary>(<pid>) -> <host>:<port> [tags]` and `<host> [tags]`.
 */
export function parseDenialLine(line: string): DenialLine {
  if (line.indexOf("DENIED") === -1) return { kind: "skip" };
  const raw = stripAnsi(line).trimEnd();
  if (raw.indexOf("[OCSF") === -1 || raw.indexOf(" DENIED ") === -1) return { kind: "skip" };
  const match = OCSF_DENIAL_PATTERN.exec(raw);
  if (!match?.groups) {
    // A line that names OCSF and DENIED but not in the shorthand layout.
    return /\[OCSF\s*\]/.test(raw) ? { kind: "unparsed", raw } : { kind: "skip" };
  }
  const { ts, src, cls, sev } = match.groups;
  if (!cls?.startsWith("NET:")) return { kind: "unparsed", raw };

  let body = (match.groups.rest ?? "").trim();
  let reason: string | null = null;
  for (let tag = DENIAL_TAG_PATTERN.exec(body); tag?.groups; tag = DENIAL_TAG_PATTERN.exec(body)) {
    body = tag.groups.body ?? "";
    for (const pair of (tag.groups.tag ?? "").split(/\s+/)) {
      const colon = pair.indexOf(":");
      if (colon > 0 && pair.slice(0, colon) === "reason") reason = pair.slice(colon + 1);
    }
  }

  const event = {
    timeMs: Math.round(Number(ts) * 1000),
    source: src ?? "",
    eventClass: cls,
    severity: sev ?? "",
    reason,
  };
  const flow = DENIAL_FLOW_PATTERN.exec(body);
  if (flow?.groups) {
    const dest = splitDestination(flow.groups.dest ?? "");
    if (!dest || !dest.host) return { kind: "unparsed", raw };
    return {
      kind: "denial",
      event: {
        ...event,
        host: dest.host,
        port: dest.port,
        binary: flow.groups.binary ?? null,
        pid: flow.groups.pid ? Number(flow.groups.pid) : null,
      },
    };
  }
  if (/^\S+$/.test(body)) {
    return { kind: "denial", event: { ...event, host: body, port: null, binary: null, pid: null } };
  }
  return { kind: "unparsed", raw };
}

/** Windows a denial read may ask for; never free text (design D1). */
export const LOG_WINDOWS = ["15m", "1h", "6h"] as const;
export type LogWindow = (typeof LOG_WINDOWS)[number];
/** Line cap for a one-shot log read. */
export const LOG_LINE_CAP = 5000;

export function isLogWindow(value: unknown): value is LogWindow {
  return typeof value === "string" && (LOG_WINDOWS as readonly string[]).includes(value);
}

export interface RecentLogs {
  lines: string[];
  /** True when the CLI returned the full line cap, so older lines were cut. */
  capped: boolean;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class OpenShellClient {
  readonly binary: string;
  private readonly cwd: string | undefined;
  private readonly env: Record<string, string | undefined>;
  private readonly timeoutMs: number;

  constructor(options: OpenShellClientOptions = {}) {
    this.binary = options.binary ?? process.env.DASHBOARD_OPENSHELL_BIN ?? "openshell";
    this.cwd = options.cwd;
    this.timeoutMs = options.timeoutMs ?? READ_TIMEOUT_MS;
    this.env = { ...process.env, NO_COLOR: "1", ...options.env };
  }

  /**
   * Spawn the CLI with an argv array and collect its output.
   *
   * Normalizes every failure mode into a structured `OpenShellError`:
   * missing binary, non-zero exit, timeout, and spawn errors.
   */
  async run(
    args: string[],
    options: { timeoutMs?: number } = {},
  ): Promise<Result<RunOutput>> {
    const argv = [this.binary, ...args];
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn({
        cmd: argv,
        cwd: this.cwd,
        env: this.env,
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const code = (cause as { code?: string } | undefined)?.code;
      if (code === "ENOENT" || /ENOENT|not found|No such file/.test(message)) {
        return fail("missing_cli", `openshell CLI not found: ${this.binary}`, {
          detail: message,
          argv,
        });
      }
      return fail("spawn", `failed to start openshell: ${message}`, { detail: message, argv });
    }

    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill();
        } catch {
          // The process may have already exited; the timeout result stands.
        }
      }, timeoutMs);
    }

    let exitCode: number;
    try {
      exitCode = await proc.exited;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    const stdout = proc.stdout ? await new Response(proc.stdout).text() : "";
    const stderr = proc.stderr ? await new Response(proc.stderr).text() : "";

    if (timedOut) {
      return fail("timeout", `openshell ${args.join(" ")} timed out after ${timeoutMs} ms`, {
        detail: stderr.trim() || stdout.trim(),
        argv,
      });
    }
    if (exitCode !== 0) {
      const detail = stderr.trim() || stdout.trim();
      return fail("exit", detail || `openshell exited with code ${exitCode}`, {
        exitCode,
        detail,
        argv,
      });
    }
    return ok({ stdout, stderr, exitCode });
  }

  private async runJson<T>(
    args: string[],
    options: { timeoutMs?: number } = {},
  ): Promise<Result<T>> {
    const result = await this.run(args, options);
    if (!result.ok) return result;
    try {
      return ok(JSON.parse(result.value.stdout) as T);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return fail("invalid_json", `could not parse openshell output as JSON: ${message}`, {
        detail: result.value.stdout.slice(0, 500),
        argv: [this.binary, ...args],
      });
    }
  }

  async listSandboxes(): Promise<Result<SandboxSummary[]>> {
    const result = await this.runJson<{ sandboxes?: unknown[] }>([
      "sandbox",
      "list",
      "-o",
      "json",
    ]);
    if (!result.ok) return result;
    return ok(asArray(result.value.sandboxes).map(mapSandbox));
  }

  async getSandbox(name: string): Promise<Result<SandboxDetail>> {
    const result = await this.runJson<unknown>(["sandbox", "get", name, "-o", "json"]);
    if (!result.ok) return result;
    const raw = asObject(result.value);
    return ok({
      ...mapSandbox(raw),
      restartPolicy: asString(raw.restart_policy) || "never",
      mainProcessInstanceId: asString(raw.main_process_instance_id),
      restartCount: asNumber(raw.restart_count),
      policySource: asString(raw.policy_source) || "sandbox",
      revision: asOptionalNumber(raw.revision),
      policy: raw.policy ?? null,
    });
  }

  async listProviders(name: string): Promise<Result<SandboxProvider[]>> {
    const result = await this.runJson<{ providers?: unknown[] }>([
      "sandbox",
      "provider",
      "list",
      name,
      "-o",
      "json",
    ]);
    if (!result.ok) return result;
    return ok(
      asArray(result.value.providers).map((value) => {
        const raw = asObject(value);
        return {
          name: asString(raw.name),
          type: asString(raw.type),
          credentialKeys: asArray(raw.credential_keys).map((key) => String(key)),
          configKeys: asArray(raw.config_keys).map((key) => String(key)),
        };
      }),
    );
  }

  async createSandbox(params: CreateSandboxParams): Promise<Result<ActionResult>> {
    const name = params.name.trim();
    if (!name) return fail("invalid_request", "a sandbox name is required");
    const args = ["sandbox", "create", "--name", name, "--detach", "-o", "json"];
    if (params.image) args.push("--from", params.image);
    if (params.policy) args.push("--policy", params.policy);
    for (const provider of params.providers ?? []) {
      if (provider) args.push("--provider", provider);
    }
    if (params.cpu) args.push("--cpu", params.cpu);
    if (params.memory) args.push("--memory", params.memory);

    const result = await this.run(args, { timeoutMs: CREATE_TIMEOUT_MS });
    if (!result.ok) return result;

    // A successful create must not be reported as a failure just because the
    // final JSON could not be parsed; surface the raw output message instead.
    try {
      return ok({ message: `created ${name}`, sandbox: JSON.parse(result.value.stdout) });
    } catch {
      return ok({ message: result.value.stdout.trim() || `created ${name}`, sandbox: null });
    }
  }

  async sandboxAction(
    action: "start" | "stop" | "delete",
    name: string,
  ): Promise<Result<ActionResult>> {
    const result = await this.run(["sandbox", action, name], {
      timeoutMs: MUTATION_TIMEOUT_MS,
    });
    if (!result.ok) return result;
    return ok({ message: result.value.stdout.trim() || `${action} accepted`, sandbox: null });
  }

  async policyGet(name: string, view: PolicyView = "full"): Promise<Result<PolicyInfo>> {
    const result = await this.runJson<unknown>([
      "policy",
      "get",
      name,
      view === "base" ? "--base" : "--full",
      "-o",
      "json",
    ]);
    if (!result.ok) return result;
    const raw = asObject(result.value);
    return ok({
      scope: asString(raw.scope),
      sandbox: asString(raw.sandbox),
      version: asNumber(raw.version),
      activeVersion: asNumber(raw.active_version),
      hash: asString(raw.hash),
      status: asString(raw.status),
      configRevision: asNumber(raw.config_revision),
      policySource: asString(raw.policy_source),
      globalPolicyVersion: asOptionalNumber(raw.global_policy_version),
      policy: raw.policy ?? null,
    });
  }

  async policyList(name: string): Promise<Result<PolicyRevision[]>> {
    const result = await this.runJson<{ revisions?: unknown[] }>([
      "policy",
      "list",
      name,
      "-o",
      "json",
    ]);
    if (!result.ok) return result;
    return ok(asArray(result.value.revisions).map(mapPolicyRevision));
  }

  async rules(name: string, status?: string): Promise<Result<RuleProposal[]>> {
    const args = ["rule", "get", name];
    if (status) args.push("--status", status);
    const result = await this.run(args);
    if (!result.ok) return result;
    return ok(parseRuleTable(result.value.stdout));
  }

  async approveRule(name: string, chunkId: string): Promise<Result<ActionResult>> {
    if (!chunkId.trim()) return fail("invalid_request", "a proposal id is required");
    const result = await this.run(["rule", "approve", name, "--chunk-id", chunkId], {
      timeoutMs: MUTATION_TIMEOUT_MS,
    });
    if (!result.ok) return result;
    return ok({ message: result.value.stdout.trim() || "proposal approved", sandbox: null });
  }

  async rejectRule(
    name: string,
    chunkId: string,
    reason: string,
  ): Promise<Result<ActionResult>> {
    if (!chunkId.trim()) return fail("invalid_request", "a proposal id is required");
    if (!reason.trim()) {
      return fail("invalid_request", "a rejection reason is required");
    }
    const result = await this.run(
      ["rule", "reject", name, "--chunk-id", chunkId, "--reason", reason],
      { timeoutMs: MUTATION_TIMEOUT_MS },
    );
    if (!result.ok) return result;
    return ok({ message: result.value.stdout.trim() || "proposal rejected", sandbox: null });
  }

  async settingsGet(name: string): Promise<Result<SettingsInfo>> {
    const result = await this.runJson<unknown>(["settings", "get", name, "--json"]);
    if (!result.ok) return result;
    const raw = asObject(result.value);
    const settings: Record<string, { value: unknown; scope: string }> = {};
    for (const [key, entry] of Object.entries(asObject(raw.settings))) {
      const item = asObject(entry);
      settings[key] = { value: item.value ?? null, scope: asString(item.scope) || "unset" };
    }
    return ok({
      sandbox: asString(raw.sandbox),
      workspace: asString(raw.workspace),
      configRevision: asNumber(raw.config_revision),
      policySource: asString(raw.policy_source),
      policyHash: asString(raw.policy_hash),
      settings,
    });
  }

  /** CLI presence plus gateway reachability for the status banner. */
  async doctor(): Promise<Result<DoctorReport>> {
    const versionResult = await this.run(["--version"]);
    const statusResult = await this.runJson<unknown>(["status", "-o", "json"]);
    const status = statusResult.ok ? asObject(statusResult.value) : {};

    return ok({
      cli: versionResult.ok
        ? { ok: true, version: versionResult.value.stdout.trim(), error: null }
        : { ok: false, version: null, error: versionResult.error.message },
      gateway: statusResult.ok
        ? {
            ok: asString(status.status) === "connected",
            status: asString(status.status) || null,
            gateway: asString(status.gateway) || null,
            server: asString(status.server) || null,
            version: asString(status.version) || null,
            error: null,
          }
        : {
            ok: false,
            status: null,
            gateway: null,
            server: null,
            version: null,
            error: statusResult.error.message,
          },
    });
  }

  /**
   * One bounded sandbox-log read for the egress view (design D1):
   * `openshell logs <name> --since <window> --source sandbox -n 5000`.
   */
  async recentLogs(name: string, window: LogWindow): Promise<Result<RecentLogs>> {
    if (!name.trim()) return fail("invalid_request", "a sandbox name is required");
    if (!isLogWindow(window)) {
      return fail("invalid_request", `window must be one of ${LOG_WINDOWS.join(", ")}`);
    }
    const result = await this.run([
      "logs",
      name,
      "--since",
      window,
      "--source",
      "sandbox",
      "-n",
      String(LOG_LINE_CAP),
    ]);
    if (!result.ok) return result;
    const lines = result.value.stdout.split(/\r?\n/).filter((line) => line !== "");
    return ok({ lines, capped: lines.length >= LOG_LINE_CAP });
  }

  /**
   * Spawn `openshell logs <name> --tail` for SSE streaming.
   *
   * The caller owns the process: it must call `kill()` on client disconnect.
   * stderr is piped but unused; the CLI writes errors there when the sandbox
   * disappears.
   */
  spawnLogs(name: string): Result<LogsProcess> {
    if (!name.trim()) return fail("invalid_request", "a sandbox name is required");
    const argv = [this.binary, "logs", name, "--tail"];
    try {
      const proc = Bun.spawn({
        cmd: argv,
        cwd: this.cwd,
        env: this.env,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (!proc.stdout) {
        return fail("spawn", "openshell logs did not provide a stdout stream", { argv });
      }
      return ok({
        pid: proc.pid,
        stdout: proc.stdout,
        exited: proc.exited,
        kill: () => proc.kill(),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const code = (cause as { code?: string } | undefined)?.code;
      if (code === "ENOENT" || /ENOENT|not found|No such file/.test(message)) {
        return fail("missing_cli", `openshell CLI not found: ${this.binary}`, {
          detail: message,
          argv,
        });
      }
      return fail("spawn", `failed to start openshell logs: ${message}`, {
        detail: message,
        argv,
      });
    }
  }
}
