// State-root fixture: an osa state root under a temp `XDG_STATE_HOME` holding
// every registry and pending-marker shape the dashboard must handle, plus the
// host folders the entries point at.
//
// Shared by projects.test.ts, server.test.ts, and scripts/browser-check.ts.
// Paths are physical (`realpath`), like the ones the front-ends record.

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A patch line that must render as text, never as an element. */
export const XSS_PATCH_LINE = "+<img src=x onerror=alert(1)>";

export const RETAINED_PATCH = [
  "diff --git a/base.txt b/base.txt",
  "--- a/base.txt",
  "+++ b/base.txt",
  "@@ -1 +1,2 @@",
  "-base",
  "+agent",
  XSS_PATCH_LINE,
  "",
].join("\n");

export interface StateFixture {
  /** Temp directory holding everything below; remove it when done. */
  dir: string;
  /** Value for `XDG_STATE_HOME`. */
  stateHome: string;
  /** `$XDG_STATE_HOME/osa`. */
  stateRoot: string;
  registryDir: string;
  sessionsDir: string;
  /** Host folder registered for `mk` and `oc`. */
  appPath: string;
  /** Host folder whose name has spaces and quotes, registered for `cc`. */
  quotedPath: string;
  /** Host folder registered for the unknown tag `zz`. */
  toolPath: string;
  /** Registered host folder that does not exist. */
  orphanPath: string;
  retainedPatchPath: string;
}

/** Sandbox names in the fixture, by role. */
export const SANDBOX = {
  retained: "mk-app-1111",
  parked: "oc-app-2222",
  noKind: "cc-web-3333",
  unknownTag: "zz-tool-4444",
  orphan: "mk-gone-5555",
  future: "mk-future-6666",
} as const;

/** Registry file that is not valid TOML. */
export const INVALID_FILE = "broken.toml";

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Writes a flat TOML file the way `flat_write` does. */
export function writeFlat(path: string, values: Record<string, string>): void {
  const lines = Object.entries(values).map(([key, value]) => `${key} = ${quote(value)}`);
  writeFileSync(path, `${lines.join("\n")}\n`);
}

export function writeEntry(
  fixture: StateFixture,
  fields: { agent: string; host_path: string; project: string; sandbox_name: string } & Record<
    string,
    string
  >,
): string {
  const path = join(fixture.registryDir, `${fields.sandbox_name}.toml`);
  writeFlat(path, {
    version: "1",
    sandbox_id: `id-${fields.sandbox_name}`,
    created: "2026-10-26T10:00:00Z",
    last_session: "2026-10-26T11:00:00Z",
    ...fields,
  });
  return path;
}

export function writeMarker(
  fixture: StateFixture,
  sandbox: string,
  fields: Record<string, string>,
): string {
  const dir = join(fixture.sessionsDir, sandbox);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "pending");
  writeFlat(path, {
    version: "1",
    sandbox,
    sandbox_id: `id-${sandbox}`,
    created: "2026-10-26T11:00:00Z",
    reason: "dirty baseline",
    result_tree: "9596ad5e",
    ...fields,
  });
  return path;
}

export function buildStateFixture(): StateFixture {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "dashboard-state-fixture-")));
  const stateHome = join(dir, "state");
  const stateRoot = join(stateHome, "osa");
  const registryDir = join(stateRoot, "projects");
  const sessionsDir = join(stateRoot, "sessions");
  const hosts = join(dir, "hosts");
  const appPath = join(hosts, "app");
  const quotedPath = join(hosts, 'my "app" dir');
  const toolPath = join(hosts, "tool");
  const orphanPath = join(hosts, "gone");
  for (const path of [registryDir, sessionsDir, appPath, quotedPath, toolPath]) {
    mkdirSync(path, { recursive: true });
  }
  writeFileSync(join(appPath, "base.txt"), "base\n");
  writeFileSync(join(quotedPath, "index.html"), "<p>web</p>\n");

  const fixture: StateFixture = {
    dir,
    stateHome,
    stateRoot,
    registryDir,
    sessionsDir,
    appPath,
    quotedPath,
    toolPath,
    orphanPath,
    retainedPatchPath: join(sessionsDir, SANDBOX.retained, "patch-20261026105609-57768.patch"),
  };

  // mk: retained patch.
  writeEntry(fixture, {
    agent: "mk",
    host_path: appPath,
    project: "app",
    sandbox_name: SANDBOX.retained,
    fingerprint: "abc123-1-2",
  });
  writeMarker(fixture, SANDBOX.retained, {
    kind: "retained",
    patch: fixture.retainedPatchPath,
  });
  writeFileSync(fixture.retainedPatchPath, RETAINED_PATCH);

  // oc at the same host path: parked workspace.
  writeEntry(fixture, {
    agent: "oc",
    host_path: appPath,
    project: "app",
    sandbox_name: SANDBOX.parked,
  });
  writeMarker(fixture, SANDBOX.parked, { kind: "parked", patch: "" });

  // cc at a path with spaces and quotes: a marker with no `kind`.
  writeEntry(fixture, {
    agent: "cc",
    host_path: quotedPath,
    project: 'my "app" dir',
    sandbox_name: SANDBOX.noKind,
  });
  const noKindPatch = join(sessionsDir, SANDBOX.noKind, "patch-1.patch");
  writeMarker(fixture, SANDBOX.noKind, { patch: noKindPatch });
  writeFileSync(noKindPatch, "+not empty\n");

  // An agent tag the dashboard does not know, nothing pending.
  writeEntry(fixture, {
    agent: "zz",
    host_path: toolPath,
    project: "tool",
    sandbox_name: SANDBOX.unknownTag,
  });

  // Orphan: the registered folder is gone.
  writeEntry(fixture, {
    agent: "mk",
    host_path: orphanPath,
    project: "gone",
    sandbox_name: SANDBOX.orphan,
  });

  // Newer contract version.
  writeFlat(join(registryDir, `${SANDBOX.future}.toml`), {
    version: "2",
    agent: "mk",
    host_path: appPath,
    project: "app",
    sandbox_name: SANDBOX.future,
  });

  // Not TOML at all.
  writeFileSync(join(registryDir, INVALID_FILE), 'version = "1"\nagent = mk\nhost_path = [\n');

  return fixture;
}

/** Fresh temp state home with no registry directory. */
export function emptyStateHome(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "dashboard-state-empty-")));
}
