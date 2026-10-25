#!/usr/bin/env bun
// Contract drift gate (spec scenario "Drift is reported with the delta"):
// re-capture the installed OpenCode's /api/info and /openapi.json the way the
// spike's capture flow did (opencode serve on a loopback port), A/B against
// the vendored 2.1.4 copy, and print route/schema deltas plus the installed
// OpenCode and Maki versions. Exits non-zero on drift; skips with a named
// message when a required binary is absent. Never part of `make test`.
import { readFileSync } from "node:fs";

const VENDORED = "bridge/src/openapi-2.1.4.json";

const missing = ["opencode", "maki"].filter((bin) => !Bun.which(bin));
if (missing.length) {
  console.log(`compat-drift: skipping — not on PATH: ${missing.join(", ")}`);
  process.exit(0);
}

const versionOf = (bin: string): string => {
  const res = Bun.spawnSync([bin, "--version"], { stdout: "pipe", stderr: "ignore" });
  return new TextDecoder().decode(res.stdout).trim().split("\n")[0] || `${bin}: version unknown`;
};

// key order must not fake a diff: compare with sorted keys everywhere
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const setDelta = (before: string[], after: string[]) => ({
  added: after.filter((k) => !before.includes(k)),
  removed: before.filter((k) => !after.includes(k)),
});

interface Doc {
  info?: { version?: string };
  paths?: Record<string, unknown>;
  components?: { schemas?: Record<string, unknown> };
}

// --- capture: opencode serve on a free loopback port ---
const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
const port = probe.port;
probe.stop(true);

const server = Bun.spawn([Bun.which("opencode")!, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
  stdout: "pipe",
  stderr: "pipe",
});
let serverOut = "";
let serverErr = "";
const drain = async (stream: ReadableStream<Uint8Array>, sink: "out" | "err") => {
  const dec = new TextDecoder();
  for await (const chunk of stream) {
    const text = dec.decode(chunk, { stream: true });
    if (sink === "out") serverOut += text;
    else serverErr += text;
  }
};
drain(server.stdout, "out");
drain(server.stderr, "err");
const stopServer = async () => {
  server.kill("SIGTERM");
  await Promise.race([server.exited, Bun.sleep(3000).then(() => server.kill("SIGKILL"))]);
};
process.on("exit", () => {
  try {
    server.kill("SIGKILL");
  } catch {
    /* already gone */
  }
});

// serve protects its endpoints with HTTP basic auth: username defaults to
// `opencode`, the password is printed on stdout unless OPENCODE_SERVER_PASSWORD
// is already set
const username = process.env.OPENCODE_SERVER_USERNAME ?? "opencode";
const authHeader = (): Record<string, string> => {
  const printed = /server password (\S+)/.exec(serverOut)?.[1];
  const password = process.env.OPENCODE_SERVER_PASSWORD ?? printed;
  return password ? { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` } : {};
};

const base = `http://127.0.0.1:${port}`;
let info: Record<string, any> | null = null;
let captured: Doc | null = null;
for (let attempt = 0; attempt < 60 && !captured; attempt++) {
  try {
    const headers = authHeader();
    const [infoRes, specRes] = await Promise.all([
      fetch(`${base}/api/info`, { headers }),
      fetch(`${base}/openapi.json`, { headers }),
    ]);
    if (infoRes.ok && specRes.ok) {
      info = await infoRes.json();
      captured = (await specRes.json()) as Doc;
      break;
    }
  } catch {
    /* not listening yet */
  }
  await Bun.sleep(500);
}
await stopServer();

if (!captured) {
  console.error(
    `compat-drift: opencode serve did not answer on ${base} within 30s\n` +
      `stdout:\n${serverOut.slice(0, 1000)}\nstderr:\n${serverErr.slice(0, 1000)}`,
  );
  process.exit(1);
}

const vendored = JSON.parse(readFileSync(new URL(`../${VENDORED}`, import.meta.url))) as Doc;
const drift = canonical(captured) !== canonical(vendored);

console.log(`compat-drift: ${versionOf("opencode")} (opencode), ${versionOf("maki")} (maki)`);
console.log(`compat-drift: /api/info reports version ${info?.version ?? "unknown"}`);

const before = Object.keys(vendored.paths ?? {});
const after = Object.keys(captured.paths ?? {});
const routes = setDelta(before, after);
const changedRoutes = after.filter(
  (p) => before.includes(p) && canonical((captured!.paths ?? {})[p]) !== canonical((vendored.paths ?? {})[p]),
);
const beforeSchemas = Object.keys(vendored.components?.schemas ?? {});
const afterSchemas = Object.keys(captured.components?.schemas ?? {});
const schemas = setDelta(beforeSchemas, afterSchemas);
const changedSchemas = afterSchemas.filter(
  (s) =>
    beforeSchemas.includes(s) &&
    canonical((captured!.components?.schemas ?? {})[s]) !== canonical((vendored.components?.schemas ?? {})[s]),
);

console.log(
  `compat-drift: captured ${after.length} routes / ${afterSchemas.length} schemas; ` +
    `vendored ${before.length} routes / ${beforeSchemas.length} schemas (${VENDORED})`,
);

if (!drift) {
  console.log("compat-drift: no drift against the vendored contract");
  process.exit(0);
}

if (routes.added.length) console.log(`compat-drift: routes added:   ${routes.added.join(", ")}`);
if (routes.removed.length) console.log(`compat-drift: routes removed: ${routes.removed.join(", ")}`);
if (changedRoutes.length) console.log(`compat-drift: routes changed: ${changedRoutes.join(", ")}`);
if (schemas.added.length) console.log(`compat-drift: schemas added:   ${schemas.added.join(", ")}`);
if (schemas.removed.length) console.log(`compat-drift: schemas removed: ${schemas.removed.join(", ")}`);
if (changedSchemas.length) console.log(`compat-drift: schemas changed: ${changedSchemas.join(", ")}`);
if (
  !routes.added.length &&
  !routes.removed.length &&
  !changedRoutes.length &&
  !schemas.added.length &&
  !schemas.removed.length &&
  !changedSchemas.length
) {
  console.log("compat-drift: delta outside paths/components.schemas (e.g. info or security)");
}
console.log(`compat-drift: DRIFT — the installed contract differs from ${VENDORED}`);
process.exit(1);
