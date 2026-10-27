// OpenShell dashboard entry point.
//
// Usage:
//   bun run start [--port N] [--host ADDR] [--token TOKEN] [--read-only] [--open]
//   osa dashboard [same flags]   (sets DASHBOARD_OSA_BIN to that osa)
//
// Priority: flags > DASHBOARD_* environment variables > defaults. Create-time
// defaults (image, policy, providers, cpu, memory) come from
// ~/.config/maki-oss/config.toml; see src/config.ts.

import {
  createDashboardServer,
  DEFAULT_HOST,
  DEFAULT_PORT,
  isLoopbackHost,
  type DashboardHandle,
  type DashboardServerOptions,
} from "./server.ts";

interface CliOptions {
  host: string;
  port: number;
  token: string | null;
  readOnly: boolean;
  open: boolean;
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function parseCliArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): CliOptions | { help: true } {
  let host: string | undefined;
  let port: number | undefined;
  let token: string | null | undefined;
  let readOnly: boolean | undefined;
  let open = false;

  const envPort = env.DASHBOARD_PORT?.trim();
  if (envPort) {
    port = Number(envPort);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`DASHBOARD_PORT is not a valid port: ${envPort}`);
    }
  }
  host = env.DASHBOARD_HOST?.trim() || undefined;
  token = env.DASHBOARD_TOKEN?.trim() || undefined;
  if (env.DASHBOARD_READ_ONLY !== undefined) readOnly = isTruthy(env.DASHBOARD_READ_ONLY);

  const takeValue = (name: string, inline: string | null, next: () => string | undefined): string => {
    if (inline !== null) return inline;
    const value = next();
    if (value === undefined) throw new Error(`${name} requires a value`);
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? null : arg.slice(eq + 1);

    switch (name) {
      case "--help":
      case "-h":
        return { help: true };
      case "--port": {
        const value = takeValue("--port", inline, () => argv[++index]);
        port = Number(value);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
          throw new Error(`--port is not a valid port: ${value}`);
        }
        break;
      }
      case "--host":
        host = takeValue("--host", inline, () => argv[++index]);
        break;
      case "--token": {
        const value = takeValue("--token", inline, () => argv[++index]).trim();
        if (!value) throw new Error("--token must not be empty");
        token = value;
        break;
      }
      case "--read-only":
        readOnly = true;
        break;
      case "--open":
        open = true;
        break;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  return {
    host: host ?? DEFAULT_HOST,
    port: port ?? DEFAULT_PORT,
    token: token ?? null,
    readOnly: readOnly ?? false,
    open,
  };
}

export function usage(): string {
  return [
    "Usage: bun run start [--port N] [--host ADDR] [--token TOKEN] [--read-only] [--open]",
    "",
    "Flags:",
    "  --port N     Port to listen on (default: DASHBOARD_PORT or 8787)",
    "  --host ADDR  Address to bind (default: DASHBOARD_HOST or 127.0.0.1).",
    "               A non-loopback address requires --token, prints a warning, and then",
    "               requires the token for the page (/?token=T) and every API read.",
    "  --token T    Session token for mutating routes (default: DASHBOARD_TOKEN or a",
    "               random token embedded in the served page on loopback).",
    "  --read-only  Reject every mutating route with 403 and hide the controls.",
    "  --open       Open the page in the default browser once listening (open on macOS,",
    "               xdg-open elsewhere). Loopback only: the URL never carries the token.",
    "",
    "Environment: DASHBOARD_PORT, DASHBOARD_HOST, DASHBOARD_TOKEN, DASHBOARD_READ_ONLY,",
    "DASHBOARD_OPENSHELL_BIN (openshell binary, default: openshell),",
    "DASHBOARD_OSA_BIN (osa binary, default: ../bin/osa next to the dashboard, else osa;",
    "always set by `osa dashboard` to that osa),",
    "XDG_STATE_HOME (osa state root base for the Projects view, default: ~/.local/state).",
  ].join("\n");
}

function displayHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

/** The argv that opens URL in the default browser, or null when no opener exists. */
export function browserCommand(
  url: string,
  platform: string = process.platform,
  which: (command: string) => string | null = Bun.which,
): string[] | null {
  if (platform === "darwin") return ["open", url];
  return which("xdg-open") ? ["xdg-open", url] : null;
}

/**
 * Starts the platform opener for URL without waiting on it. Throws when no
 * opener exists or the spawn fails; reports a non-zero exit through onFailure.
 */
export function openBrowser(url: string, onFailure: () => void): void {
  const argv = browserCommand(url);
  if (!argv) throw new Error("no browser opener found");
  const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  proc.unref();
  void proc.exited.then((code) => {
    if (code !== 0) onFailure();
  });
}

export interface StartDeps {
  log?: (line: string) => void;
  openBrowser?: (url: string, onFailure: () => void) => void;
  /** Extra server options (tests inject stub clients and config). */
  serverOptions?: DashboardServerOptions;
}

/** Starts the server for parsed CLI options, prints its URL, and honors --open. */
export function startDashboard(options: CliOptions, deps: StartDeps = {}): DashboardHandle {
  const log = deps.log ?? console.log;
  const opener = deps.openBrowser ?? openBrowser;
  const handle = createDashboardServer({
    ...deps.serverOptions,
    host: options.host,
    port: options.port,
    token: options.token ?? undefined,
    readOnly: options.readOnly,
  });
  const url = `http://${displayHost(handle.hostname)}:${handle.port}/`;
  log(
    `OpenShell dashboard listening on ${url.slice(0, -1)}` + (handle.readOnly ? " (read-only)" : ""),
  );
  if (options.open) {
    if (!isLoopbackHost(options.host)) {
      // The opener's argv would carry ?token=, which the process list shows.
      log(`--open: not opening a browser off loopback; open ${url}?token=<token> yourself`);
    } else {
      const fail = () => log(`could not open a browser; open ${url}`);
      try {
        opener(url, fail);
      } catch {
        fail();
      }
    }
  }
  return handle;
}

if (import.meta.main) {
  try {
    const parsed = parseCliArgs(process.argv.slice(2));
    if ("help" in parsed) {
      console.log(usage());
      process.exit(0);
    }
    startDashboard(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    console.error(usage());
    process.exit(1);
  }
}
