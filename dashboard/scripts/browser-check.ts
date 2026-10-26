#!/usr/bin/env bun
// Headless-browser verification for the dashboard UI.
//
// Drives real Google Chrome (via the DevTools Protocol over Bun's WebSocket
// client) against the real server with the stub CLI. Covers the browser-level
// claims of the change: inventory refresh and rendering, XSS containment,
// lifecycle actions with typed delete confirmation, read-only controls, log
// streaming with filters/pause/reconnect and disconnect cleanup, policy tabs,
// rule approve/reject, and the Projects view (registry list, attention
// counter, patch viewer, full status) and its resolve actions (Apply with the
// touched-file list, refusal, typed Drop, Rescue, busy rows, read-only) over a
// state-root fixture and the stub osa.
//
// No npm dependencies. Skips (exit 0) when no Chrome/Chromium binary is found.
//
//   bun run scripts/browser-check.ts

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardConfig } from "../src/config.ts";
import { OpenShellClient } from "../src/openshell.ts";
import { ProjectService } from "../src/projects.ts";
import { createDashboardServer, type DashboardHandle } from "../src/server.ts";
import {
  buildStateFixture,
  SANDBOX,
  writeEntry,
  writeMarker,
  XSS_PATCH_LINE,
} from "../test/state-fixture.ts";

const stubPath = join(import.meta.dir, "..", "test", "stub", "openshell");
const osaStubPath = join(import.meta.dir, "..", "test", "stub", "osa");

function findChrome(): string | null {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

let passed = 0;
let failed = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    passed += 1;
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL ${label}`);
  }
}

// ---------------------------------------------------------------------------
// Minimal CDP client
// ---------------------------------------------------------------------------

interface Cdp {
  ready: Promise<void>;
  /** Uncaught page exceptions and console errors seen so far. */
  errors: string[];
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  evaluate(expression: string): Promise<unknown>;
  close(): void;
}

function createCdp(url: string): Cdp {
  const socket = new WebSocket(url);
  const errors: string[] = [];
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out connecting to CDP at ${url}`)), 10_000);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`could not connect to CDP at ${url}`));
    };
  });

  socket.onmessage = (event: MessageEvent) => {
    const text =
      typeof event.data === "string"
        ? event.data
        : new TextDecoder().decode(event.data as Uint8Array);
    const message = JSON.parse(text) as {
      id?: number;
      method?: string;
      params?: Record<string, any>;
      result?: Record<string, unknown>;
      error?: { message?: string };
    };
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails;
      errors.push(`exception: ${details?.exception?.description ?? details?.text ?? "unknown"}`);
    } else if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      errors.push(`console.error: ${JSON.stringify(message.params?.args?.map((arg: any) => arg.value))}`);
    }
    if (message.id === undefined) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message ?? "CDP error"));
    else entry.resolve(message.result ?? {});
  };

  function send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const id = nextId++;
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    socket.send(JSON.stringify({ id, method, params }));
    return Promise.race([
      result,
      Bun.sleep(15_000).then(() => {
        throw new Error(`CDP command timed out: ${method}`);
      }),
    ]);
  }

  async function evaluate(expression: string): Promise<unknown> {
    const result = (await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as {
      result?: { value?: unknown };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    if (result.exceptionDetails) {
      const detail =
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "unknown";
      throw new Error(`page evaluation failed: ${detail}`);
    }
    return result.result?.value;
  }

  return { ready, errors, send, evaluate, close: () => socket.close() };
}

async function waitFor(
  cdp: Cdp,
  expression: string,
  description: string,
  timeoutMs = 10_000,
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = undefined;
  while (Date.now() < deadline) {
    last = await cdp.evaluate(expression);
    if (last) return last;
    await Bun.sleep(100);
  }
  throw new Error(`timed out waiting for ${description} (last value: ${JSON.stringify(last)})`);
}

async function clickButton(cdp: Cdp, label: string): Promise<void> {
  await cdp.evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === ${JSON.stringify(label)});
    if (!button) throw new Error("button not found: " + ${JSON.stringify(label)});
    button.click();
    return true;
  })()`);
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const chrome = findChrome();
if (!chrome) {
  console.log("skip browser-check: no Chrome/Chromium binary found (set CHROME_BIN)");
  process.exit(0);
}

const workDir = mkdtempSync(join(tmpdir(), "dashboard-browser-check-"));
const profileDir = join(workDir, "chrome-profile");
const stateDir = join(workDir, "state");
const argvLog = join(workDir, "argv.log");
mkdirSync(join(stateDir, "sandboxes"), { recursive: true });
mkdirSync(join(stateDir, "providers"), { recursive: true });
mkdirSync(join(stateDir, "notes"), { recursive: true });
mkdirSync(profileDir, { recursive: true });

const XSS_PHASE = 'Ready<img src=x onerror="window.__pwned=1">';
const XSS_NOTE = "<script>window.__pwned=2</script>";

writeFileSync(join(stateDir, "sandboxes", "demo"), "Ready\n");
writeFileSync(join(stateDir, "providers", "demo"), "maki-anthropic\n");
writeFileSync(join(stateDir, "sandboxes", "xss"), `${XSS_PHASE}\n`);
writeFileSync(join(stateDir, "providers", "xss"), "");
writeFileSync(join(stateDir, "notes", "xss"), XSS_NOTE);
writeFileSync(join(stateDir, "sandboxes", "logs-demo"), "Ready\n");
writeFileSync(join(stateDir, "providers", "logs-demo"), "");
// The retained-patch project's sandbox is on the gateway; the others are not.
writeFileSync(join(stateDir, "sandboxes", SANDBOX.retained), "Ready\n");
writeFileSync(join(stateDir, "providers", SANDBOX.retained), "");

const stateFixture = buildStateFixture();
const osaAnswers = join(workDir, "osa-answers.json");
const osaLog = join(workDir, "osa-argv.log");
writeFileSync(
  osaAnswers,
  JSON.stringify({
    [stateFixture.appPath]: {
      quick: [
        { sandbox_name: SANDBOX.retained, fingerprint_result: "changed" },
        { sandbox_name: SANDBOX.parked, fingerprint_result: "unchanged" },
      ],
      full: [
        {
          sandbox_name: SANDBOX.retained,
          status: { phase: "Ready", sync: "behind", next: "maki-oss refresh" },
        },
      ],
    },
  }),
);

function makeProjects(): ProjectService {
  return new ProjectService({
    stateRoot: stateFixture.stateRoot,
    runnerOptions: { binary: osaStubPath, env: { STUB_OSA_FIXTURE: osaAnswers, STUB_OSA_LOG: osaLog } },
  });
}

const config: DashboardConfig = {
  image: "maki-agent:local",
  policy: "/repo/examples/policies/maki-minimal.yaml",
  providers: ["maki-anthropic"],
  cpu: "2",
  memory: "4Gi",
  configPath: null,
};

function makeClient(): OpenShellClient {
  return new OpenShellClient({
    binary: stubPath,
    env: {
      STUB_STATE_DIR: stateDir,
      STUB_LOG: argvLog,
      STUB_LOG_LINES: "60",
      STUB_LOG_INTERVAL: "0.05",
      STUB_LOG_KEEPALIVE: "1",
    },
  });
}

function argv(): string {
  return existsSync(argvLog) ? readFileSync(argvLog, "utf8") : "";
}

const mainServer: DashboardHandle = createDashboardServer({
  port: 0,
  client: makeClient(),
  config,
  projects: makeProjects(),
});
const readOnlyServer: DashboardHandle = createDashboardServer({
  port: 0,
  client: makeClient(),
  config,
  readOnly: true,
  projects: makeProjects(),
});
const mainUrl = `http://127.0.0.1:${mainServer.port}/`;
const readOnlyUrl = `http://127.0.0.1:${readOnlyServer.port}/`;

const chromeProcess = Bun.spawn({
  cmd: [
    chrome,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ],
  stdout: "ignore",
  stderr: "ignore",
});

let debugPort = 0;

async function waitForDebugPort(): Promise<number> {
  const file = join(profileDir, "DevToolsActivePort");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const line = (readFileSync(file, "utf8").split("\n")[0] ?? "").trim();
      const port = Number(line);
      if (Number.isInteger(port) && port > 0) return port;
    }
    await Bun.sleep(100);
  }
  throw new Error("Chrome did not report a DevTools port");
}

async function cdpFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${debugPort}${path}`, {
    ...init,
    signal: AbortSignal.timeout(5_000),
  });
}

async function openPage(url: string): Promise<{ id: string; cdp: Cdp }> {
  const response = await cdpFetch(`/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const target = (await response.json()) as { id: string; webSocketDebuggerUrl: string };
  const cdp = createCdp(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await waitFor(cdp, `document.readyState === "complete"`, `page load for ${url}`);
  return { id: target.id, cdp };
}

const pageErrors: string[] = [];

async function closePage(id: string, cdp?: Cdp): Promise<void> {
  if (cdp) pageErrors.push(...cdp.errors);
  try {
    await cdpFetch(`/json/close/${id}`);
  } catch {
    // The target may already be gone.
  }
}

function waitForFile(path: string, description: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (existsSync(path)) return resolve();
      if (Date.now() > deadline) {
        return reject(new Error(`timed out waiting for ${description}: ${path}`));
      }
      setTimeout(poll, 100);
    };
    poll();
  });
}

async function runChecks(): Promise<void> {
  // -------------------------------------------------------------------------
  // Inventory: render, refresh, and XSS containment
  // -------------------------------------------------------------------------
  const inventoryPage = await openPage(mainUrl);
  const inventory = inventoryPage.cdp;
  await clickButton(inventory, "Sandboxes");

  await waitFor(
    inventory,
    `document.querySelectorAll("#inventory-table tbody tr").length >= 3`,
    "inventory rows",
  );
  check(
    (await inventory.evaluate(
      `document.querySelectorAll("#inventory-table img, #inventory-table script").length`,
    )) === 0,
    "gateway data did not create elements in the inventory",
  );
  check((await inventory.evaluate("window.__pwned")) === undefined, "no script executed from gateway data");
  check(
    (await inventory.evaluate(
      `document.getElementById("inventory-table").textContent.includes("<img src=x")`,
    )) === true,
    "phase payload rendered as text",
  );
  check(
    (await inventory.evaluate(
      `document.getElementById("inventory-table").textContent.includes("<script>window.__pwned=2</script>")`,
    )) === true,
    "invalid-config note rendered as text",
  );

  writeFileSync(join(stateDir, "sandboxes", "auto-created"), "Ready\n");
  writeFileSync(join(stateDir, "providers", "auto-created"), "");
  await waitFor(
    inventory,
    `document.getElementById("inventory-table").textContent.includes("auto-created")`,
    "inventory refresh picking up a new sandbox",
    7000,
  );
  check(true, "new sandbox appears within one refresh interval without user action");

  // -------------------------------------------------------------------------
  // Detail: start/stop/delete with typed confirmation
  // -------------------------------------------------------------------------
  await inventory.evaluate(`(() => {
    const button = [...document.querySelectorAll("#inventory-table button.link")].find((candidate) => candidate.textContent === "demo");
    button.click();
    return true;
  })()`);
  await waitFor(
    inventory,
    `document.querySelector("#app h2") && document.querySelector("#app h2").textContent === "demo"`,
    "detail view",
  );
  await waitFor(inventory, `document.body.textContent.includes("maki-anthropic")`, "provider list");
  await waitFor(inventory, `document.body.textContent.includes("hash-4")`, "revision list");
  check(true, "detail shows providers, policy source, and revisions");

  await clickButton(inventory, "Stop");
  await waitFor(inventory, `document.body.textContent.includes("Stopped")`, "stopped phase");
  check(readFileSync(join(stateDir, "sandboxes", "demo"), "utf8").trim() === "Stopped", "Stop reached the gateway");

  await clickButton(inventory, "Start");
  await waitFor(inventory, `document.body.textContent.includes("Ready")`, "ready phase");
  check(readFileSync(join(stateDir, "sandboxes", "demo"), "utf8").trim() === "Ready", "Start reached the gateway");

  await clickButton(inventory, "Delete…");
  await inventory.evaluate(`(() => {
    const input = [...document.querySelectorAll("#app input")].find((candidate) => candidate.placeholder.includes("type demo"));
    input.value = "demo-x";
    input.dispatchEvent(new Event("input"));
    return true;
  })()`);
  check(
    (await inventory.evaluate(
      `[...document.querySelectorAll("#app button")].find((candidate) => candidate.textContent === "Delete").disabled`,
    )) === true,
    "delete stays disabled for a wrong typed name",
  );
  await inventory.evaluate(`(() => {
    const input = [...document.querySelectorAll("#app input")].find((candidate) => candidate.placeholder.includes("type demo"));
    input.value = "demo";
    input.dispatchEvent(new Event("input"));
    return true;
  })()`);
  check(
    (await inventory.evaluate(
      `[...document.querySelectorAll("#app button")].find((candidate) => candidate.textContent === "Delete").disabled`,
    )) === false,
    "delete enables when the exact name is typed",
  );
  await clickButton(inventory, "Delete");
  await waitFor(inventory, `document.getElementById("inventory-table") !== null`, "return to inventory");
  check(!existsSync(join(stateDir, "sandboxes", "demo")), "typed delete removed the sandbox");

  // -------------------------------------------------------------------------
  // Logs: stream, filters, pause, reconnect, disconnect cleanup
  // -------------------------------------------------------------------------
  await inventory.evaluate(`(() => {
    const button = [...document.querySelectorAll("#inventory-table button.link")].find((candidate) => candidate.textContent === "logs-demo");
    button.click();
    return true;
  })()`);
  await waitFor(
    inventory,
    `document.querySelector("#app h2") && document.querySelector("#app h2").textContent === "logs-demo"`,
    "logs sandbox detail",
  );
  await clickButton(inventory, "Logs");
  await waitFor(
    inventory,
    `document.getElementById("log-view").textContent.includes("gateway log line 1")`,
    "log lines",
  );
  check(true, "log lines appear in the browser");

  await inventory.evaluate(`(() => {
    const select = [...document.querySelectorAll("#app select")].find((candidate) => [...candidate.options].some((option) => option.textContent.includes("source:")));
    select.value = "sandbox";
    select.dispatchEvent(new Event("change"));
    return true;
  })()`);
  await Bun.sleep(150);
  check(
    (await inventory.evaluate(`(() => {
      const view = document.getElementById("log-view").textContent;
      return view.includes("sandbox log line 2") && !view.includes("gateway log line 1");
    })()`)) === true,
    "source filter hides other sources",
  );

  await clickButton(inventory, "Pause");
  const beforePause = await inventory.evaluate(`document.getElementById("log-view").childElementCount`);
  await Bun.sleep(400);
  const afterPause = await inventory.evaluate(`document.getElementById("log-view").childElementCount`);
  check(beforePause === afterPause, "pause stops rendering new lines");
  await clickButton(inventory, "Resume");
  await Bun.sleep(100);
  check(
    (await inventory.evaluate(`document.getElementById("log-view").childElementCount`)) >
      (afterPause as number),
    "resume renders the lines received while paused",
  );

  await inventory.evaluate(`(() => {
    const select = [...document.querySelectorAll("#app select")].find((candidate) => [...candidate.options].some((option) => option.textContent.includes("source:")));
    select.value = "all";
    select.dispatchEvent(new Event("change"));
    return true;
  })()`);
  await clickButton(inventory, "Reconnect");
  await waitFor(
    inventory,
    `document.getElementById("log-view").textContent.includes("gateway log line 1")`,
    "reconnect replay",
  );
  check(true, "reconnect replays the buffered lines");

  await closePage(inventoryPage.id, inventory);
  await waitForFile(join(stateDir, "logs-killed"), "log child kill on disconnect");
  check(true, "closing the tab kills the log child process");

  // -------------------------------------------------------------------------
  // Read-only mode disables controls
  // -------------------------------------------------------------------------
  const readOnlyPage = await openPage(readOnlyUrl);
  const readOnly = readOnlyPage.cdp;
  await clickButton(readOnly, "Sandboxes");
  await waitFor(readOnly, `document.body.textContent.includes("Read-only mode")`, "read-only notice");
  await waitFor(
    readOnly,
    `document.querySelectorAll("#inventory-table tbody tr").length >= 1`,
    "read-only inventory",
  );
  await readOnly.evaluate(`(() => {
    const button = [...document.querySelectorAll("#inventory-table button.link")].find((candidate) => candidate.textContent === "xss");
    button.click();
    return true;
  })()`);
  await waitFor(
    readOnly,
    `document.querySelector("#app h2") && document.querySelector("#app h2").textContent === "xss"`,
    "read-only detail",
  );
  check(
    (await readOnly.evaluate(`(() => {
      const controls = [...document.querySelectorAll("#app button")].filter((button) =>
        ["Start", "Stop", "Delete…"].includes(button.textContent));
      return controls.length === 3 && controls.every((button) => button.disabled);
    })()`)) === true,
    "read-only disables lifecycle controls",
  );
  check(
    (await readOnly.evaluate(
      `[...document.querySelectorAll("#app input")].every((input) => input.disabled)`,
    )) === true,
    "read-only disables confirmation inputs",
  );
  await closePage(readOnlyPage.id, readOnly);

  // -------------------------------------------------------------------------
  // Policy view: effective vs base tabs
  // -------------------------------------------------------------------------
  const viewPage = await openPage(mainUrl);
  const views = viewPage.cdp;
  await clickButton(views, "Sandboxes");
  await waitFor(
    views,
    `document.querySelectorAll("#inventory-table tbody tr").length >= 1`,
    "inventory rows for view checks",
  );
  await views.evaluate(`(() => {
    const button = [...document.querySelectorAll("#inventory-table button.link")].find((candidate) => candidate.textContent === "xss");
    button.click();
    return true;
  })()`);
  await waitFor(
    views,
    `document.querySelector("#app h2") && document.querySelector("#app h2").textContent === "xss"`,
    "xss detail",
  );

  await clickButton(views, "Policy");
  await waitFor(views, `document.body.textContent.includes("stub_base_rule")`, "effective policy");
  check(
    (await views.evaluate(`document.body.textContent.includes("provider:stub")`)) === true,
    "effective policy includes provider-contributed rules",
  );
  await clickButton(views, "Base");
  await waitFor(
    views,
    `!document.body.textContent.includes("provider:stub") && document.body.textContent.includes("stub_base_rule")`,
    "base policy",
  );
  check(true, "base policy tab hides provider-contributed rules");

  // -------------------------------------------------------------------------
  // Rules view: approve and reject-with-required-reason
  // -------------------------------------------------------------------------
  await clickButton(views, "Detail");
  await waitFor(
    views,
    `document.querySelector("#app h2") && document.querySelector("#app h2").textContent === "xss"`,
    "detail view for rules",
  );
  await clickButton(views, "Rules");
  await waitFor(views, `document.body.textContent.includes("chunk-pending-1")`, "pending proposals");
  check(
    (await views.evaluate(
      `[...document.querySelectorAll("#app button")].find((candidate) => candidate.textContent === "Reject").disabled`,
    )) === true,
    "reject is disabled without a reason",
  );
  await views.evaluate(`(() => {
    const input = [...document.querySelectorAll("#app input")].find((candidate) => candidate.placeholder === "reason (required)");
    input.value = "narrow the path";
    input.dispatchEvent(new Event("input"));
    return true;
  })()`);
  check(
    (await views.evaluate(
      `[...document.querySelectorAll("#app button")].find((candidate) => candidate.textContent === "Reject").disabled`,
    )) === false,
    "reject enables once a reason is typed",
  );
  await clickButton(views, "Reject");
  await waitFor(
    views,
    `document.getElementById("banner").textContent.includes("rejected")`,
    "rejection notice",
  );
  check(argv().includes("--reason") && argv().includes("narrow the path"), "reject hit the CLI with the reason");
  await clickButton(views, "Approve");
  await waitFor(
    views,
    `document.getElementById("banner").textContent.includes("approved")`,
    "approval notice",
  );
  check(
    argv()
      .split("---")
      .some((invocation) => invocation.includes("approve") && invocation.includes("chunk-pending-1")),
    "approve hit the CLI with the chunk id",
  );

  await closePage(viewPage.id, views);

  await projectsJourney();
  await resolveJourney();

  check(pageErrors.length === 0, `no page exceptions or console errors (${pageErrors.join("; ")})`);
}

// ---------------------------------------------------------------------------
// Projects: list, counter, refresh, patch viewer, full status, read-only
// ---------------------------------------------------------------------------

async function projectsJourney(): Promise<void> {
  const page = await openPage(mainUrl);
  const cdp = page.cdp;
  const rowCount = `document.querySelectorAll("#projects-table tbody tr").length`;
  const tableText = `document.getElementById("projects-table").textContent`;

  await waitFor(cdp, `${rowCount} === 7`, "every fixture row on the landing view");
  // Rows can render before the first inventory poll lands ("gateway unknown").
  await waitFor(cdp, `${tableText}.includes("not on gateway")`, "the inventory join");
  check(
    (await cdp.evaluate(`(() => {
      const text = ${tableText};
      return ${JSON.stringify([...Object.values(SANDBOX).filter((name) => name !== SANDBOX.future), "broken.toml", `${SANDBOX.future}.toml`])}
        .every((name) => text.includes(name));
    })()`)) === true,
    "the landing view lists every fixture row, unsupported ones by file name",
  );
  check(
    (await cdp.evaluate(`(() => {
      const text = ${tableText};
      return text.includes("Maki") && text.includes("OpenCode") && text.includes("Claude Code") &&
        text.includes("zz") && text.includes("unsupported contract version") &&
        text.includes("orphan: folder missing") && text.includes("not on gateway");
    })()`)) === true,
    "rows show agent labels, the raw unknown tag, notes, and badges",
  );
  check(
    (await cdp.evaluate(`[...document.querySelectorAll("#projects-table button.link")].map((b) => b.textContent).join(",")`)) ===
      SANDBOX.retained,
    "only the sandbox on the gateway links to its detail view",
  );
  await waitFor(cdp, `${tableText}.includes("changed since last sync")`, "host-change result from osa");
  check(true, "host-change result appears from the cached quick status");

  const attention = `document.getElementById("attention")`;
  await waitFor(cdp, `!${attention}.hidden && ${attention}.textContent === "4 need attention"`, "attention counter");
  check(true, "counter counts retained, parked, and orphan projects");

  await clickButton(cdp, "Sandboxes");
  await waitFor(cdp, `document.getElementById("inventory-table") !== null`, "sandboxes tab");
  check((await cdp.evaluate(`!${attention}.hidden`)) === true, "counter stays visible on the Sandboxes tab");
  await cdp.evaluate(`${attention}.click()`);
  await waitFor(cdp, `document.getElementById("projects-table") !== null`, "counter opens Projects");
  check(true, "activating the counter opens the Projects view");

  writeEntry(stateFixture, {
    agent: "cx",
    host_path: stateFixture.toolPath,
    project: "late",
    sandbox_name: "cx-late-7777",
  });
  await waitFor(cdp, `${tableText}.includes("cx-late-7777")`, "new registry entry", 7000);
  check(true, "a new registry file appears within one refresh");

  rmSync(join(stateFixture.sessionsDir, SANDBOX.parked, "pending"));
  await waitFor(cdp, `${attention}.textContent === "3 need attention"`, "counter after resolution", 7000);
  check(true, "counter drops when a pending marker is removed");

  await clickButton(cdp, "Review patch");
  await waitFor(cdp, `document.querySelectorAll("#patch-view .patch-line").length > 0`, "patch lines");
  check(
    (await cdp.evaluate(`(() => {
      const view = document.getElementById("patch-view");
      return view.querySelectorAll(".patch-add").length > 0 &&
        view.querySelectorAll(".patch-del").length > 0 &&
        view.querySelectorAll(".patch-hunk").length === 1;
    })()`)) === true,
    "patch lines are marked as added, removed, and hunk",
  );
  check(
    (await cdp.evaluate(`[...document.querySelectorAll("#app button")].map((b) => b.textContent).join(",")`)) ===
      "← Projects,Apply,Branch,Drop",
    "the patch view offers Apply, Branch, and Drop under the diff",
  );
  check(
    (await cdp.evaluate(`document.getElementById("patch-view").textContent.includes(${JSON.stringify(XSS_PATCH_LINE)})`)) ===
      true && (await cdp.evaluate(`document.querySelectorAll("#app img").length`)) === 0,
    "markup in a patch renders as text and creates no element",
  );

  await clickButton(cdp, "← Projects");
  await waitFor(cdp, `${rowCount} >= 7`, "projects after the patch");
  await cdp.evaluate(`(() => {
    const row = [...document.querySelectorAll("#projects-table tbody tr")].find((tr) => tr.textContent.includes(${JSON.stringify(SANDBOX.retained)}));
    [...row.querySelectorAll("button")].find((b) => b.textContent === "Check (contacts gateway)").click();
    return true;
  })()`);
  await waitFor(
    cdp,
    `${tableText}.includes("sync: behind") && ${tableText}.includes("next: maki-oss refresh")`,
    "full status on the row",
  );
  check(true, "a row's full check shows behind and the next command");
  await closePage(page.id, cdp);

  const readOnlyPage = await openPage(readOnlyUrl);
  const readOnly = readOnlyPage.cdp;
  await waitFor(readOnly, `document.querySelectorAll("#projects-table tbody tr").length >= 7`, "read-only projects");
  await clickButton(readOnly, "Review patch");
  await waitFor(
    readOnly,
    `document.querySelectorAll("#patch-view .patch-add").length > 0`,
    "read-only patch lines",
  );
  check(true, "read-only mode still opens the patch");
  await closePage(readOnlyPage.id, readOnly);

  const quick = existsSync(osaLog)
    ? readFileSync(osaLog, "utf8").split("\n").filter((line) => line.includes("--quick"))
    : [];
  check(quick.length > 0, "the stub osa answered the quick checks");
}

// ---------------------------------------------------------------------------
// Resolve actions: Apply with the file list, refusal, typed Drop, Rescue,
// busy rows, read-only mode, and markup in an outcome
// ---------------------------------------------------------------------------

async function resolveJourney(): Promise<void> {
  const retainedMarker = join(stateFixture.sessionsDir, SANDBOX.retained, "pending");
  const rescueDir = join(stateFixture.sessionsDir, SANDBOX.parked, "rescue-20261026120000");
  const xssMessage = "Rescued the workspace <img src=x onerror=alert(1)>";
  // The Projects journey removed the parked marker; park the workspace again.
  writeMarker(stateFixture, SANDBOX.parked, { kind: "parked", patch: "" });
  const statusAnswers = JSON.parse(readFileSync(osaAnswers, "utf8")) as Record<string, unknown>;
  const setAnswers = (resolve: Record<string, unknown>) =>
    writeFileSync(
      osaAnswers,
      JSON.stringify({
        ...statusAnswers,
        // A session holds the cc project: its row's actions are disabled.
        [stateFixture.quotedPath]: {
          quick: [{ sandbox_name: SANDBOX.noKind, fingerprint_result: "unchanged", busy: true }],
        },
        resolve,
      }),
    );
  setAnswers({
    [SANDBOX.retained]: {
      apply: { exit: 2, message: "The dry run failed; nothing was applied. Try branch." },
    },
    [SANDBOX.parked]: { rescue: { changed: [rescueDir], message: xssMessage } },
  });
  const resolveCalls = (): string[][] =>
    (existsSync(osaLog) ? readFileSync(osaLog, "utf8").split("\n") : [])
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[])
      .filter((args) => args[0] === "resolve");
  const rowOf = (sandbox: string) =>
    `[...document.querySelectorAll("#projects-table tbody tr")].find((tr) => tr.textContent.includes(${JSON.stringify(sandbox)}))`;
  const appButtons = `[...document.querySelectorAll("#app button")].map((b) => b.textContent).join(",")`;
  const resolveLabels = ["Rescue", "Discard", "Apply", "Branch", "Drop"];

  // Read-only: no resolve control in the rows or the viewer.
  const readOnlyPage = await openPage(readOnlyUrl);
  const readOnly = readOnlyPage.cdp;
  await waitFor(readOnly, `document.querySelectorAll("#projects-table tbody tr").length >= 7`, "read-only rows");
  await waitFor(readOnly, `${rowOf(SANDBOX.parked)}.textContent.includes("parked")`, "read-only parked row");
  check(
    (await readOnly.evaluate(
      `[...document.querySelectorAll("#projects-table button")].some((b) => ${JSON.stringify(resolveLabels)}.includes(b.textContent))`,
    )) === false,
    "read-only rows show no resolve action",
  );
  await clickButton(readOnly, "Review patch");
  await waitFor(readOnly, `document.querySelectorAll("#patch-view .patch-line").length > 0`, "read-only patch");
  check((await readOnly.evaluate(appButtons)) === "← Projects", "the read-only viewer has no Apply, Branch, or Drop");
  await closePage(readOnlyPage.id, readOnly);

  const page = await openPage(mainUrl);
  const cdp = page.cdp;
  await waitFor(cdp, `document.querySelectorAll("#projects-table tbody tr").length >= 7`, "rows");

  // Busy: a fresh quick status reports the cc project busy.
  await clickButton(cdp, "Check host changes");
  await waitFor(cdp, `${rowOf(SANDBOX.noKind)}.textContent.includes("a session is running")`, "busy row", 8000);
  check(
    (await cdp.evaluate(`(() => {
      const buttons = [...${rowOf(SANDBOX.noKind)}.querySelectorAll("button")].filter((b) => ["Rescue", "Discard"].includes(b.textContent));
      return buttons.length === 2 && buttons.every((b) => b.disabled);
    })()`)) === true,
    "a busy row's actions are disabled and the row says a session is running",
  );

  // Rescue: the outcome names the folder, the row stays parked, markup stays text.
  await cdp.evaluate(`[...${rowOf(SANDBOX.parked)}.querySelectorAll("button")].find((b) => b.textContent === "Rescue").click()`);
  await waitFor(cdp, `${rowOf(SANDBOX.parked)}.textContent.includes("Rescue done.")`, "rescue outcome");
  check(
    (await cdp.evaluate(`(() => {
      const row = ${rowOf(SANDBOX.parked)};
      return row.textContent.includes(${JSON.stringify(rescueDir)}) && row.querySelector(".badge-parked") !== null;
    })()`)) === true,
    "Rescue shows the rescue folder and the row stays parked",
  );
  check(
    (await cdp.evaluate(`${rowOf(SANDBOX.parked)}.textContent.includes(${JSON.stringify(xssMessage)})`)) === true &&
      (await cdp.evaluate(`document.querySelectorAll("#app img").length`)) === 0,
    "markup in an outcome message renders as text",
  );
  check(
    JSON.stringify(resolveCalls()) === JSON.stringify([["resolve", SANDBOX.parked, "rescue", "--json"]]),
    "Rescue ran exactly osa resolve <sandbox> rescue --json",
  );

  // Review patch: Drop without the typed name sends nothing.
  await cdp.evaluate(`[...${rowOf(SANDBOX.retained)}.querySelectorAll("button")].find((b) => b.textContent === "Review patch").click()`);
  await waitFor(cdp, `document.querySelectorAll("#patch-view .patch-line").length > 0`, "patch for resolve");
  await clickButton(cdp, "Drop");
  await waitFor(cdp, `document.querySelector("#patch-actions input[data-confirm-key]") !== null`, "drop confirmation");
  await cdp.evaluate(`(() => {
    const input = document.querySelector("#patch-actions input[data-confirm-key]");
    input.value = "mk-app";
    input.dispatchEvent(new Event("input"));
    const confirm = [...document.querySelectorAll("#patch-actions button")].find((b) => b.textContent === "Confirm drop");
    confirm.click();
    // Even a re-enabled button checks the typed name before sending.
    confirm.disabled = false;
    confirm.click();
    return true;
  })()`);
  await Bun.sleep(500);
  check(
    !resolveCalls().some((args) => args[2] === "drop"),
    "Drop without the exact typed sandbox name sends nothing",
  );
  await clickButton(cdp, "Cancel");

  // Apply lists the touched files; a refusing Apply shows nothing changed.
  await clickButton(cdp, "Apply");
  await waitFor(cdp, `document.getElementById("apply-files") !== null`, "apply file list");
  check(
    (await cdp.evaluate(`[...document.querySelectorAll("#apply-files li")].map((li) => li.textContent).join(",")`)) ===
      "base.txt",
    "Apply lists the files the patch touches before it runs",
  );
  check(!resolveCalls().some((args) => args[2] === "apply"), "opening Apply sends nothing");
  await clickButton(cdp, "Confirm apply");
  await waitFor(cdp, `document.getElementById("patch-actions").textContent.includes("nothing changed")`, "refusal");
  check(
    (await cdp.evaluate(`document.getElementById("patch-actions").textContent.includes("Try branch")`)) === true &&
      (await cdp.evaluate(appButtons)).toString().includes("Apply"),
    "a refused Apply says nothing changed, shows osa's message, and keeps the actions",
  );

  // A successful Apply shows the files and clears the retained badge.
  setAnswers({
    [SANDBOX.retained]: {
      apply: {
        changed: ["base.txt"],
        message: "Applied the retained patch to the working tree.",
        remove: [retainedMarker],
      },
    },
  });
  await clickButton(cdp, "Apply");
  await waitFor(cdp, `document.getElementById("apply-files") !== null`, "apply file list again");
  await clickButton(cdp, "Confirm apply");
  await waitFor(cdp, `document.getElementById("patch-actions").textContent.includes("Apply done.")`, "apply outcome");
  check(
    (await cdp.evaluate(`[...document.querySelectorAll("#patch-actions .resolve-outcome li")].map((li) => li.textContent).join(",")`)) ===
      "base.txt",
    "the Apply outcome lists the changed files",
  );
  await waitFor(cdp, `${appButtons} === "← Projects"`, "actions gone after apply", 3000);
  check(true, "the viewer drops its actions once the patch is resolved");
  await clickButton(cdp, "← Projects");
  await waitFor(cdp, `${rowOf(SANDBOX.retained)} !== undefined`, "projects after apply");
  check(
    (await cdp.evaluate(`${rowOf(SANDBOX.retained)}.querySelector(".badge-retained") === null`)) === true,
    "the retained badge clears without waiting for the poll",
  );
  check(
    JSON.stringify(resolveCalls().filter((args) => args[2] === "apply")) ===
      JSON.stringify([
        ["resolve", SANDBOX.retained, "apply", "--json"],
        ["resolve", SANDBOX.retained, "apply", "--json"],
      ]),
    "each Apply ran exactly osa resolve <sandbox> apply --json",
  );
  await closePage(page.id, cdp);
}

try {
  debugPort = await waitForDebugPort();
  await Promise.race([
    runChecks(),
    Bun.sleep(120_000).then(() => {
      throw new Error("browser-check watchdog: 120s exceeded");
    }),
  ]);
} catch (error) {
  failed += 1;
  console.log(`FAIL ${error instanceof Error ? error.message : String(error)}`);
} finally {
  readOnlyServer.stop();
  mainServer.stop();
  rmSync(stateFixture.dir, { recursive: true, force: true });
  chromeProcess.kill();
  // Kill any Chrome helper processes that share this throwaway profile.
  const pkill = Bun.spawn({ cmd: ["pkill", "-f", profileDir], stdout: "ignore", stderr: "ignore" });
  await pkill.exited;
  await Bun.sleep(300);
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // Chrome may still hold profile files briefly; the temp dir is disposable.
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
// CDP sockets can keep Bun's event loop alive; the verification is done, so
// exit explicitly instead of waiting for an empty loop.
process.exit(failed > 0 ? 1 : 0);
