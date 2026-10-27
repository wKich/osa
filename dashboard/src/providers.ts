// Provider setup for the dashboard (dashboard-provider-wizard).
//
// Listing is `osa providers --json`. Setup is exactly one
// `osa provider setup TAG --profile ID [--name N] [--attach S] [--yes] --json`
// built from validated fields, with the credential written to the child's
// stdin and the pipe closed (design D1, D3). The credential lives in one
// request-scoped value: it is never placed in argv, the environment, a file,
// a log line, or a response, and every copy of it in osa's output is replaced
// with `[redacted]` before that output is parsed or returned. One setup runs
// at a time (design D2, step 6).

import type { OpenShellError, Result } from "./openshell.ts";
import {
  findProject,
  isAgentTag,
  KEBAB,
  OsaRunner,
  parseOsaJson,
  providerSetupArgv,
  SANDBOX_NAME,
  type ProviderSetupFields,
} from "./projects.ts";

export const PROVIDERS_TIMEOUT_MS = 20_000;
/** Attach `--wait` can be slow. */
export const SETUP_TIMEOUT_MS = 120_000;
/** The largest credential osa accepts on stdin, in bytes. */
export const CREDENTIAL_MAX_BYTES = 65_536;
export const REDACTED = "[redacted]";

export interface SetupRequest {
  fields: ProviderSetupFields;
  credential: string;
}

export type SetupValidation =
  | { ok: true; request: SetupRequest }
  | { ok: false; field: string; message: string };

/**
 * Validates a setup body field by field (design D1). An error names the field,
 * never its value. `attach` must be a registry entry of the same agent.
 */
export function validateSetup(body: unknown, stateRoot: string): SetupValidation {
  const bad = (field: string, message: string): SetupValidation => ({ ok: false, field, message });
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return bad("body", "request body must be a JSON object");
  }
  const record = body as Record<string, unknown>;
  const allowed = new Set(["agent", "profile", "name", "attach", "replace", "credential"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return bad(key, `unknown field '${key}'`);
  }
  const { agent, profile, name, attach, replace, credential } = record;
  if (!isAgentTag(agent)) return bad("agent", "agent must be one of mk, oc, cc, cx");
  if (typeof profile !== "string" || !KEBAB.test(profile)) {
    return bad("profile", "profile must be a kebab-case profile id");
  }
  if (name !== undefined && name !== null && name !== "" && (typeof name !== "string" || !KEBAB.test(name))) {
    return bad("name", "name must be a kebab-case provider name");
  }
  let attachName: string | undefined;
  if (attach !== undefined && attach !== null && attach !== "") {
    if (typeof attach !== "string" || !SANDBOX_NAME.test(attach)) return bad("attach", "attach must be a sandbox name");
    const entry = findProject(stateRoot, attach);
    if (!entry || entry.agent !== agent) {
      return bad("attach", `attach must name a registered sandbox of agent ${agent}`);
    }
    attachName = attach;
  }
  if (replace !== undefined && typeof replace !== "boolean") return bad("replace", "replace must be a boolean");
  if (typeof credential !== "string" || credential.length === 0) {
    return bad("credential", "credential must be a non-empty string");
  }
  if (/[\r\n]/.test(credential)) return bad("credential", "credential must be one line");
  if (new TextEncoder().encode(credential).length > CREDENTIAL_MAX_BYTES) {
    return bad("credential", `credential must be at most ${CREDENTIAL_MAX_BYTES} bytes`);
  }
  return {
    ok: true,
    request: {
      fields: {
        agent,
        profile,
        name: typeof name === "string" && name ? name : undefined,
        attach: attachName,
        replace: replace === true,
      },
      credential,
    },
  };
}

/**
 * Replaces every occurrence of the credential in osa's output, raw and as it
 * would appear inside a JSON string, with `[redacted]` (design D3).
 */
export function redact(text: string, credential: string): string {
  if (!credential) return text;
  let result = text.split(credential).join(REDACTED);
  const escaped = JSON.stringify(credential).slice(1, -1);
  if (escaped !== credential) result = result.split(escaped).join(REDACTED);
  return result;
}

/** `osa provider setup --json`'s result object. */
export interface SetupResult {
  ok: boolean;
  agent: string;
  provider: string;
  profile: string;
  outcome: string;
  attached: string | null;
  remembered: boolean;
  steps: string[];
  message: string;
}

export interface SetupReply {
  status: number;
  body: Partial<SetupResult> & {
    exitCode?: number;
    error?: OpenShellError | { kind: string; message: string; detail?: string };
  };
}

function setupResult(value: unknown): SetupResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.ok !== "boolean" || typeof record.outcome !== "string") return null;
  const text = (key: string): string => (typeof record[key] === "string" ? (record[key] as string) : "");
  return {
    ok: record.ok,
    agent: text("agent"),
    provider: text("provider"),
    profile: text("profile"),
    outcome: record.outcome,
    attached: typeof record.attached === "string" ? record.attached : null,
    remembered: record.remembered === true,
    steps: Array.isArray(record.steps) ? record.steps.map((step) => String(step)) : [],
    message: text("message"),
  };
}

function errorStatus(kind: string): number {
  if (kind === "timeout") return 504;
  if (kind === "missing_cli") return 503;
  if (kind === "invalid_request") return 400;
  return 500;
}

export interface ProviderServiceOptions {
  stateRoot: string;
  runner: OsaRunner;
  listTimeoutMs?: number;
  setupTimeoutMs?: number;
}

export class ProviderService {
  private readonly stateRoot: string;
  private readonly runner: OsaRunner;
  private readonly listTimeoutMs: number;
  private readonly setupTimeoutMs: number;
  private running = false;

  constructor(options: ProviderServiceOptions) {
    this.stateRoot = options.stateRoot;
    this.runner = options.runner;
    this.listTimeoutMs = options.listTimeoutMs ?? PROVIDERS_TIMEOUT_MS;
    this.setupTimeoutMs = options.setupTimeoutMs ?? SETUP_TIMEOUT_MS;
  }

  /** True while a setup runs. */
  busy(): boolean {
    return this.running;
  }

  /** `osa providers --json`: one object per agent. Never cached. */
  async list(): Promise<Result<unknown[]>> {
    const result = await this.runner.runJson(["providers", "--json"], this.listTimeoutMs);
    if (!result.ok) return result;
    if (!Array.isArray(result.value)) {
      return { ok: false, error: { kind: "invalid_json", message: "osa providers did not return an array" } };
    }
    return { ok: true, value: result.value };
  }

  validate(body: unknown): SetupValidation {
    return validateSetup(body, this.stateRoot);
  }

  /**
   * Runs one setup (design D3, D4): exit 0 is 200, 2 is 409, 1 is 400, 3 is
   * 502 with the completed steps, a timeout 504. A second call while one runs
   * is 409 and runs nothing.
   */
  async setup(request: SetupRequest): Promise<SetupReply> {
    if (this.running) {
      return { status: 409, body: { error: { kind: "busy", message: "a provider setup is already running" } } };
    }
    this.running = true;
    let output: Awaited<ReturnType<OsaRunner["runWithStdin"]>>;
    try {
      output = await this.runner.runWithStdin(providerSetupArgv(request.fields), request.credential, this.setupTimeoutMs);
    } finally {
      this.running = false;
    }
    if (!output.ok) {
      const error = { ...output.error };
      if (error.detail) error.detail = redact(error.detail, request.credential);
      return { status: errorStatus(error.kind), body: { error } };
    }
    const { exitCode, argv } = output.value;
    const stdout = redact(output.value.stdout, request.credential);
    const detail = redact(output.value.stderr, request.credential).trim();
    const parsed = parseOsaJson(stdout, argv);
    const result = parsed.ok ? setupResult(parsed.value) : null;
    if (result && exitCode === 0) return { status: 200, body: { ...result, exitCode } };
    if (result && exitCode === 2) {
      const message = result.message || "osa refused; nothing changed";
      return { status: 409, body: { ...result, exitCode, error: { kind: "refused", message, detail } } };
    }
    if (exitCode === 1) {
      const message = result?.message || detail || "osa provider setup rejected the request";
      return { status: 400, body: { exitCode, error: { kind: "invalid_request", message, detail } } };
    }
    if (!result) {
      const error = parsed.ok
        ? { kind: "invalid_json", message: "osa provider setup did not print a result object", detail }
        : { ...parsed.error, detail: detail || parsed.error.detail };
      return { status: 502, body: { exitCode, error } };
    }
    const message = result.message || `osa provider setup exited with code ${exitCode}`;
    return { status: 502, body: { ...result, exitCode, error: { kind: "exit", message, detail } } };
  }
}
