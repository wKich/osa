// Entry-point tests: CLI parsing of --open, the browser opener choice, and
// startDashboard's --open handling with an injected opener, so no browser
// ever starts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardConfig } from "../src/config.ts";
import { browserCommand, parseCliArgs, startDashboard, usage } from "../src/main.ts";
import { OpenShellClient } from "../src/openshell.ts";
import { ProjectService } from "../src/projects.ts";
import type { DashboardHandle } from "../src/server.ts";
import { emptyStateHome } from "./state-fixture.ts";

const stubDir = join(import.meta.dir, "stub");

const testConfig: DashboardConfig = {
  image: "maki-agent:local",
  policy: "/repo/examples/policies/maki-minimal.yaml",
  providers: ["maki-anthropic"],
  cpu: "2",
  memory: "4Gi",
  configPath: "/home/test/.config/maki-oss/config.toml",
};

let workDir: string;
let handles: DashboardHandle[];
let lines: string[];
let opened: string[];

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "dashboard-main-test-"));
  mkdirSync(join(workDir, "state"), { recursive: true });
  handles = [];
  lines = [];
  opened = [];
});

afterEach(() => {
  for (const handle of handles) handle.stop();
  rmSync(workDir, { recursive: true, force: true });
});

function start(
  argv: string[],
  openBrowser: (url: string, onFailure: () => void) => void = (url) => {
    opened.push(url);
  },
): DashboardHandle {
  const parsed = parseCliArgs(["--port", "0", ...argv], {});
  if ("help" in parsed) throw new Error("unexpected help");
  const handle = startDashboard(parsed, {
    log: (line) => lines.push(line),
    openBrowser,
    serverOptions: {
      config: testConfig,
      client: new OpenShellClient({
        env: {
          PATH: `${stubDir}:${process.env.PATH ?? ""}`,
          STUB_STATE_DIR: join(workDir, "state"),
          STUB_LOG: join(workDir, "argv.log"),
        },
      }),
      projects: new ProjectService({ stateRoot: join(emptyStateHome(), "osa") }),
    },
  });
  handles.push(handle);
  return handle;
}

describe("--open parsing", () => {
  test("the flag parses and defaults to off", () => {
    expect(parseCliArgs(["--open"], {})).toMatchObject({ open: true });
    expect(parseCliArgs([], {})).toMatchObject({ open: false });
    expect(usage()).toContain("--open");
  });
});

describe("browserCommand", () => {
  test("macOS uses open", () => {
    expect(browserCommand("http://127.0.0.1:1/", "darwin", () => null)).toEqual(["open", "http://127.0.0.1:1/"]);
  });

  test("elsewhere uses xdg-open when it is on PATH, else nothing", () => {
    expect(browserCommand("http://127.0.0.1:1/", "linux", () => "/usr/bin/xdg-open")).toEqual([
      "xdg-open",
      "http://127.0.0.1:1/",
    ]);
    expect(browserCommand("http://127.0.0.1:1/", "linux", () => null)).toBeNull();
  });
});

describe("startDashboard --open", () => {
  test("on loopback the opener receives the bare URL, with no token", () => {
    const handle = start(["--open"]);
    expect(opened).toEqual([`http://127.0.0.1:${handle.port}/`]);
    expect(handle.token).toBeTruthy();
    expect(opened[0]).not.toContain(handle.token ?? "");
    expect(lines[0]).toBe(`OpenShell dashboard listening on http://127.0.0.1:${handle.port}`);
  });

  test("off loopback no opener runs and the output says to use ?token=", () => {
    const handle = start(["--host", "0.0.0.0", "--token", "T", "--open"]);
    expect(handle.port).toBeGreaterThan(0);
    expect(opened).toEqual([]);
    const output = lines.join("\n");
    expect(output).toContain("?token=");
    expect(output).not.toContain("?token=T");
  });

  test("a throwing opener prints the URL and the server keeps serving", async () => {
    const handle = start(["--open"], () => {
      throw new Error("no browser opener found");
    });
    const url = `http://127.0.0.1:${handle.port}/`;
    expect(lines).toContain(`could not open a browser; open ${url}`);
    const response = await fetch(url);
    expect(response.status).toBe(200);
    await response.text();
  });

  test("an opener that fails later prints the URL too", () => {
    const handle = start(["--open"], (_url, onFailure) => onFailure());
    expect(lines).toContain(`could not open a browser; open http://127.0.0.1:${handle.port}/`);
  });

  test("without --open no opener is called", () => {
    start([]);
    expect(opened).toEqual([]);
    expect(lines).toHaveLength(1);
  });
});
