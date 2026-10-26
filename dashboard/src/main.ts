// OpenShell dashboard entry point.
//
// Usage:
//   bun run start [--port N] [--host ADDR] [--token TOKEN] [--read-only]
//
// Priority: flags > DASHBOARD_* environment variables > defaults. Create-time
// defaults (image, policy, providers, cpu, memory) come from
// ~/.config/maki-oss/config.toml; see src/config.ts.

import { createDashboardServer, DEFAULT_HOST, DEFAULT_PORT } from "./server.ts";

interface CliOptions {
  host: string;
  port: number;
  token: string | null;
  readOnly: boolean;
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
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  return {
    host: host ?? DEFAULT_HOST,
    port: port ?? DEFAULT_PORT,
    token: token ?? null,
    readOnly: readOnly ?? false,
  };
}

export function usage(): string {
  return [
    "Usage: bun run start [--port N] [--host ADDR] [--token TOKEN] [--read-only]",
    "",
    "Flags:",
    "  --port N     Port to listen on (default: DASHBOARD_PORT or 8787)",
    "  --host ADDR  Address to bind (default: DASHBOARD_HOST or 127.0.0.1).",
    "               A non-loopback address requires --token and prints a warning.",
    "  --token T    Session token for mutating routes (default: DASHBOARD_TOKEN or a",
    "               random token embedded in the served page).",
    "  --read-only  Reject every mutating route with 403 and hide the controls.",
    "",
    "Environment: DASHBOARD_PORT, DASHBOARD_HOST, DASHBOARD_TOKEN, DASHBOARD_READ_ONLY,",
    "DASHBOARD_OPENSHELL_BIN (openshell binary, default: openshell),",
    "DASHBOARD_OSA_BIN (osa binary, default: ../bin/osa next to the dashboard, else osa),",
    "XDG_STATE_HOME (osa state root base for the Projects view, default: ~/.local/state).",
  ].join("\n");
}

function displayHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

if (import.meta.main) {
  try {
    const parsed = parseCliArgs(process.argv.slice(2));
    if ("help" in parsed) {
      console.log(usage());
      process.exit(0);
    }
    const handle = createDashboardServer({
      host: parsed.host,
      port: parsed.port,
      token: parsed.token ?? undefined,
      readOnly: parsed.readOnly,
    });
    console.log(
      `OpenShell dashboard listening on http://${displayHost(handle.hostname)}:${handle.port}` +
        (handle.readOnly ? " (read-only)" : ""),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    console.error(usage());
    process.exit(1);
  }
}
