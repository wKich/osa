// HTTP server: Bun.serve routes for the page, the frontend modules, the JSON
// API, and the log SSE stream.
//
// Safety model (see the change design):
//   - loopback bind by default; any other host requires an explicit token;
//   - the `Host` header is checked on every request (DNS rebinding): a
//     loopback bind accepts only loopback names, a concrete bind also its own
//     address, a wildcard bind any name;
//   - on a non-loopback bind the page (`?token=`), the streams (`?token=`),
//     and every API route (`X-Dashboard-Token`) require the token, so an
//     unauthenticated response never carries the token or any data; the
//     loopback bind keeps the open page and reads;
//   - mutating routes require the session token in `X-Dashboard-Token`, which
//     also blocks cross-site form posts;
//   - the log stream requires the same token as a `token` query parameter
//     (EventSource cannot send headers), in read-only mode too; the denials
//     route, which also carries log content, requires it in
//     `X-Dashboard-Token`, in read-only mode too;
//   - `--read-only` rejects every mutating route with 403;
//   - project routes are GET only and never write: the list reads the osa
//     state contract, status runs `osa status … --json`, health runs
//     `osa health SANDBOX --json` on request only, and the patch route
//     (host source code) requires the session token in both modes;
//   - the one project write is POST /api/projects/:sandbox/resolve, behind the
//     same mutation guard, which runs exactly one `osa resolve` for a
//     registered sandbox with a fixed argv.

import { loadConfig, type DashboardConfig } from "./config.ts";
import { DenialCache, matchDenials, scanDenials } from "./egress.ts";
import { LogHub } from "./logs.ts";
import {
  isLogWindow,
  OpenShellClient,
  type OpenShellClientOptions,
  type OpenShellError,
  type Result,
} from "./openshell.ts";
import { renderPage } from "./page.ts";
import { ProjectService, type ProjectServiceOptions, type ServiceResult } from "./projects.ts";
import { readdirSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;
export const REFRESH_MS = 3000;

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const JS_HEADERS = {
  "content-type": "application/javascript; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

/** Directory holding the frontend ES modules. */
const APP_DIR = join(import.meta.dir, "app");
const MODULE_NAME = /^[a-z-]+\.js$/;

/**
 * Module names served under `/app/`, read once at startup. A request path is
 * only ever compared against this set, so no URL text reaches the file system.
 */
export function moduleAllowlist(dir: string = APP_DIR): Set<string> {
  return new Set(readdirSync(dir).filter((name) => MODULE_NAME.test(name)));
}

export interface DashboardServerOptions {
  host?: string;
  port?: number;
  token?: string;
  readOnly?: boolean;
  config?: DashboardConfig;
  client?: OpenShellClient;
  clientOptions?: OpenShellClientOptions;
  projects?: ProjectService;
  projectOptions?: ProjectServiceOptions;
}

export interface DashboardHandle {
  port: number;
  hostname: string;
  token: string | null;
  readOnly: boolean;
  /** Live log hubs, retained only while a stream is active. */
  hubCount(): number;
  stop(): void;
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function isWildcardHost(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "[::]" || host === "";
}

/** Host name of a `Host` header value, lowercased, with brackets kept for IPv6. */
function splitHostHeader(value: string): { name: string; port: string } | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  if (text.startsWith("[")) {
    const end = text.indexOf("]");
    if (end === -1) return null;
    const rest = text.slice(end + 1);
    if (rest && !/^:\d*$/.test(rest)) return null;
    return { name: text.slice(0, end + 1), port: rest.slice(1) };
  }
  const colon = text.indexOf(":");
  if (colon === -1) return { name: text, port: "" };
  if (text.indexOf(":", colon + 1) !== -1) return null;
  return { name: text.slice(0, colon), port: text.slice(colon + 1) };
}

function mintToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function tokensEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/** HTTP status for a normalized CLI error. */
export function errorStatus(error: OpenShellError): number {
  switch (error.kind) {
    case "invalid_request":
      return 400;
    case "missing_cli":
      return 503;
    case "timeout":
      return 504;
    case "exit":
    case "invalid_json":
      return 502;
    default:
      return 500;
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function errorResponse(error: OpenShellError, status = errorStatus(error)): Response {
  return json({ error }, status);
}

function forbidden(kind: string, message: string): Response {
  return json({ error: { kind, message } }, 403);
}

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache",
  connection: "keep-alive",
};

interface CreateBody {
  name?: unknown;
  image?: unknown;
  policy?: unknown;
  providers?: unknown;
  cpu?: unknown;
  memory?: unknown;
}

export function createDashboardServer(options: DashboardServerOptions = {}): DashboardHandle {
  const hostname = options.host ?? DEFAULT_HOST;
  const requestedPort = options.port ?? DEFAULT_PORT;
  const readOnly = options.readOnly ?? false;
  const explicitToken = options.token?.trim() || null;

  if (!isLoopbackHost(hostname) && !explicitToken) {
    throw new Error(
      `binding to non-loopback host '${hostname}' requires an explicit --token`,
    );
  }
  if (!isLoopbackHost(hostname)) {
    console.warn(
      `warning: dashboard bound to ${hostname}; it is reachable beyond this machine`,
    );
  }

  const remote = !isLoopbackHost(hostname);
  const wildcard = isWildcardHost(hostname);
  const token = explicitToken ?? mintToken();
  let listenPort = requestedPort;
  const config = options.config ?? loadConfig();
  const client = options.client ?? new OpenShellClient(options.clientOptions);
  const hubs = new Map<string, LogHub>();
  const modules = moduleAllowlist();
  const projects = options.projects ?? new ProjectService(options.projectOptions);
  const denials = new DenialCache();

  // Host names this server answers to. Port 0 binds resolve to `listenPort`
  // once Bun.serve has returned.
  const ownHost = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (remote && !wildcard) allowedHosts.add(ownHost.toLowerCase());

  const hostAllowed = (request: Request): boolean => {
    const parsed = splitHostHeader(request.headers.get("host") ?? "");
    if (!parsed) return false;
    if (parsed.port && parsed.port !== String(listenPort)) return false;
    return wildcard || allowedHosts.has(parsed.name);
  };

  const guardMutation = (request: Request): Response | null => {
    if (readOnly) {
      return forbidden("read_only", "dashboard is running in read-only mode");
    }
    const provided = request.headers.get("x-dashboard-token") ?? "";
    if (!token || !provided || !tokensEqual(provided, token)) {
      return forbidden("forbidden", "missing or invalid session token");
    }
    return null;
  };

  // Streams are gated by the page token in read-write and read-only alike:
  // the browser's EventSource cannot send headers, so it rides the URL.
  // `guardMutation` still rejects every write in read-only mode.
  const serveLogs = (url: URL, request: Request): Response => {
    const provided = url.searchParams.get("token") ?? "";
    if (!provided || !tokensEqual(provided, token)) {
      return forbidden("forbidden", "missing or invalid session token");
    }
    const name = (url.searchParams.get("name") ?? "").trim();
    if (!name) {
      return json(
        { error: { kind: "invalid_request", message: "name query parameter is required" } },
        400,
      );
    }
    let hub = hubs.get(name);
    if (!hub) {
      hub = new LogHub(client, name, { onIdle: () => hubs.delete(name) });
      hubs.set(name, hub);
    }
    const subscription = hub.subscribe();
    if (request.signal.aborted) {
      subscription.unsubscribe();
    } else {
      request.signal.addEventListener("abort", () => subscription.unsubscribe());
    }
    return new Response(subscription.stream, { headers: SSE_HEADERS });
  };

  const hasToken = (request: Request): boolean => {
    const provided = request.headers.get("x-dashboard-token") ?? "";
    return Boolean(provided) && tokensEqual(provided, token);
  };

  const serviceResponse = <T>(result: ServiceResult<T>, wrap: (value: T) => unknown): Response => {
    if (result.ok) return json(wrap(result.value));
    const status = result.status ?? errorStatus(result.error as OpenShellError);
    return json({ error: result.error }, status);
  };

  const methodNotAllowed = (allow: string, message: string): Response =>
    new Response(JSON.stringify({ error: { kind: "method_not_allowed", message } }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8", allow },
    });

  // POST /api/projects/:sandbox/resolve: the only project write (design D1).
  const handleResolve = async (request: Request, sandbox: string): Promise<Response> => {
    if (request.method.toUpperCase() !== "POST") {
      return methodNotAllowed("POST", "the resolve route accepts POST only");
    }
    const denied = guardMutation(request);
    if (denied) return denied;
    let body: { action?: unknown };
    try {
      body = (await request.json()) as { action?: unknown };
    } catch {
      return errorResponse({ kind: "invalid_request", message: "request body must be JSON" }, 400);
    }
    const action = typeof body === "object" && body !== null ? body.action : undefined;
    const reply = await projects.resolve(sandbox, action);
    const status = reply.status ?? errorStatus(reply.body.error as OpenShellError);
    return json(reply.body, status);
  };

  // GET /api/projects, /api/projects/:sandbox/status|health|patch
  const handleProjects = async (request: Request, segments: string[]): Promise<Response> => {
    if (segments.length === 4 && segments[3] === "resolve") {
      return handleResolve(request, segments[2] ?? "");
    }
    if (request.method.toUpperCase() !== "GET") {
      return methodNotAllowed("GET", "project routes are read-only");
    }
    if (segments.length === 2) {
      const params = new URL(request.url).searchParams;
      const refresh = params.get("refresh") === "1";
      const path = params.get("path") ?? undefined;
      return json({ projects: projects.list({ refresh, path }) });
    }
    const sandbox = segments[2] ?? "";
    if (segments.length === 4 && segments[3] === "status") {
      return serviceResponse(await projects.status(sandbox), (status) => ({ status }));
    }
    if (segments.length === 4 && segments[3] === "health") {
      return serviceResponse(await projects.health(sandbox), (health) => ({ health }));
    }
    if (segments.length === 4 && segments[3] === "patch") {
      // A patch carries host source code: token required, read-only mode too.
      if (!hasToken(request)) return forbidden("forbidden", "missing or invalid session token");
      return serviceResponse(projects.patch(sandbox), (patch) => ({ patch }));
    }
    return json({ error: { kind: "not_found", message: "unknown route" } }, 404);
  };

  const handleApi = async (request: Request, segments: string[]): Promise<Response> => {
    const method = request.method.toUpperCase();

    // Off loopback every API route, reads included, needs the token before any
    // gateway or `osa` command can run.
    if (remote && !hasToken(request)) {
      return forbidden("forbidden", "missing or invalid session token");
    }

    if (segments[1] === "projects") return handleProjects(request, segments);

    if (method === "GET" && segments.length === 2 && segments[1] === "doctor") {
      const result = await client.doctor();
      if (!result.ok) return errorResponse(result.error);
      return json({ ...result.value, readOnly, tokenRequired: !readOnly });
    }

    if (segments[1] !== "sandboxes") {
      return json({ error: { kind: "not_found", message: "unknown route" } }, 404);
    }

    // Collection: GET /api/sandboxes, POST /api/sandboxes
    if (segments.length === 2) {
      if (method === "GET") {
        const result = await client.listSandboxes();
        if (!result.ok) return errorResponse(result.error);
        // The denied badge comes from the last denials read only; listing
        // never reads logs.
        return json({
          sandboxes: result.value.map((sandbox) => ({ ...sandbox, denials: denials.badge(sandbox.name) })),
        });
      }
      if (method === "POST") {
        const denied = guardMutation(request);
        if (denied) return denied;
        let body: CreateBody;
        try {
          body = (await request.json()) as CreateBody;
        } catch {
          return errorResponse({ kind: "invalid_request", message: "request body must be JSON" }, 400);
        }
        const asText = (value: unknown): string =>
          typeof value === "string" ? value.trim() : "";
        const providers = Array.isArray(body.providers)
          ? body.providers.map((entry) => String(entry)).filter(Boolean)
          : config.providers;
        const result = await client.createSandbox({
          name: asText(body.name),
          image: asText(body.image) || config.image,
          policy: asText(body.policy) || config.policy || undefined,
          providers,
          cpu: asText(body.cpu) || config.cpu || undefined,
          memory: asText(body.memory) || config.memory || undefined,
        });
        if (!result.ok) return errorResponse(result.error);
        return json(result.value, 201);
      }
      return json({ error: { kind: "not_found", message: "unknown route" } }, 404);
    }

    const name = segments[2] ?? "";
    if (!name) {
      return json({ error: { kind: "invalid_request", message: "sandbox name is required" } }, 400);
    }

    // GET /api/sandboxes/:name
    if (segments.length === 3 && method === "GET") {
      const [sandbox, providers, revisions] = await Promise.all([
        client.getSandbox(name),
        client.listProviders(name),
        client.policyList(name),
      ]);
      if (!sandbox.ok) return errorResponse(sandbox.error);
      const errors: Record<string, string> = {};
      if (!providers.ok) errors.providers = providers.error.message;
      if (!revisions.ok) errors.revisions = revisions.error.message;
      return json({
        sandbox: sandbox.value,
        providers: providers.ok ? providers.value : [],
        revisions: revisions.ok ? revisions.value : [],
        errors,
      });
    }

    // GET /api/sandboxes/:name/policy
    if (segments.length === 4 && segments[3] === "policy" && method === "GET") {
      const view = new URL(request.url).searchParams.get("view") === "base" ? "base" : "full";
      const result = await client.policyGet(name, view);
      if (!result.ok) return errorResponse(result.error);
      return json({ policy: result.value });
    }

    // GET /api/sandboxes/:name/rules
    if (segments.length === 4 && segments[3] === "rules" && method === "GET") {
      const status = new URL(request.url).searchParams.get("status") ?? "pending";
      const result = await client.rules(name, status);
      if (!result.ok) return errorResponse(result.error);
      return json({ rules: result.value });
    }

    // GET /api/sandboxes/:name/denials?window=15m|1h|6h&refresh=1
    if (segments.length === 4 && segments[3] === "denials" && method === "GET") {
      // Log content: token required, read-only mode too, before any CLI call.
      if (!hasToken(request)) return forbidden("forbidden", "missing or invalid session token");
      const params = new URL(request.url).searchParams;
      const window = params.get("window") ?? "1h";
      if (!isLogWindow(window)) {
        return errorResponse(
          { kind: "invalid_request", message: "window must be one of 15m, 1h, 6h" },
          400,
        );
      }
      let scan = params.get("refresh") === "1" ? null : denials.get(name, window, Date.now());
      if (!scan) {
        const logs = await client.recentLogs(name, window);
        if (!logs.ok) return errorResponse(logs.error);
        scan = scanDenials(window, logs.value, Date.now());
        denials.put(name, scan);
      }
      // Proposals are matched fresh every time, so a decision shows at once.
      const proposals = await client.rules(name, "pending");
      if (!proposals.ok) return errorResponse(proposals.error);
      const matched = matchDenials(scan, proposals.value);
      denials.recordBadge(name, matched);
      return json({ denials: matched });
    }

    // POST /api/sandboxes/:name/start|stop|delete
    if (
      segments.length === 4 &&
      method === "POST" &&
      (segments[3] === "start" || segments[3] === "stop" || segments[3] === "delete")
    ) {
      const denied = guardMutation(request);
      if (denied) return denied;
      const result = await client.sandboxAction(segments[3], name);
      if (!result.ok) return errorResponse(result.error);
      return json(result.value);
    }

    // POST /api/sandboxes/:name/rules/:chunkId/approve|reject
    if (
      segments.length === 6 &&
      segments[3] === "rules" &&
      method === "POST" &&
      (segments[5] === "approve" || segments[5] === "reject")
    ) {
      const denied = guardMutation(request);
      if (denied) return denied;
      const chunkId = segments[4] ?? "";
      if (segments[5] === "approve") {
        const result = await client.approveRule(name, chunkId);
        if (!result.ok) return errorResponse(result.error);
        return json(result.value);
      }
      let reason = "";
      try {
        const body = (await request.json()) as { reason?: unknown };
        reason = typeof body.reason === "string" ? body.reason : "";
      } catch {
        return errorResponse({ kind: "invalid_request", message: "request body must be JSON" }, 400);
      }
      const result = await client.rejectRule(name, chunkId, reason);
      if (!result.ok) return errorResponse(result.error);
      return json(result.value);
    }

    return json({ error: { kind: "not_found", message: "unknown route" } }, 404);
  };

  const server = Bun.serve({
    hostname,
    port: requestedPort,
    async fetch(request: Request): Promise<Response> {
      try {
        const url = new URL(request.url);
        const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
        const method = request.method.toUpperCase();

        if (!hostAllowed(request)) {
          return forbidden("forbidden_host", "host header is not allowed for this dashboard");
        }
        if (method === "GET" && (segments.length === 0 || segments[0] === "index.html")) {
          // Off loopback the page embeds the token only for a request that
          // already knows it.
          if (remote) {
            const provided = url.searchParams.get("token") ?? "";
            if (!provided || !tokensEqual(provided, token)) {
              return forbidden("forbidden", "missing or invalid session token");
            }
          }
          return new Response(renderPage({ token, readOnly, refreshMs: REFRESH_MS, config }), {
            headers: HTML_HEADERS,
          });
        }
        if (method === "GET" && segments[0] === "app" && segments.length === 2) {
          const name = segments[1] ?? "";
          if (modules.has(name)) {
            const source = await Bun.file(join(APP_DIR, name)).text();
            return new Response(source, { headers: JS_HEADERS });
          }
        }
        if (method === "GET" && segments[0] === "favicon.ico") {
          return new Response(null, { status: 204 });
        }
        if (segments[0] === "api") {
          return await handleApi(request, segments);
        }
        if (method === "GET" && segments[0] === "events" && segments[1] === "logs") {
          return serveLogs(url, request);
        }
        return json({ error: { kind: "not_found", message: "unknown route" } }, 404);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        return json(
          { error: { kind: "internal", message: "unexpected dashboard error", detail } },
          500,
        );
      }
    },
  });

  listenPort = server.port;

  return {
    port: server.port,
    hostname: server.hostname,
    token,
    readOnly,
    hubCount: () => hubs.size,
    stop: () => {
      for (const hub of hubs.values()) hub.stop();
      hubs.clear();
      server.stop(true);
    },
  };
}

export type { Result };
