import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPinnedOpencode,
  HarnessError,
  normalizeFrames,
  normalizeRequests,
  opencodeVersion,
  referenceConfig,
  referenceEnv,
  referenceLabels,
  writeFailureEvidence,
} from "./record.ts";

const paths = {
  home: "/tmp/journey-home",
  config: "/tmp/journey-home/.config/opencode",
  data: "/tmp/journey-home/.local/share",
  state: "/tmp/journey-home/.local/state",
  cache: "/tmp/journey-home/.cache",
  work: "/tmp/journey-work",
};

describe("reference isolation", () => {
  test("the spawned env carries no provider credential or OPENCODE_* variable", () => {
    const env = referenceEnv(paths, {
      ...process.env,
      ANTHROPIC_API_KEY: "secret",
      OPENAI_API_KEY: "secret",
      OPENCODE_CONFIG_DIR: "/host/config",
      OPENCODE_AUTO_SHARE: "1",
    });
    const leaked = Object.keys(env).filter((key) => key.endsWith("_API_KEY") || key.startsWith("OPENCODE_"));
    expect(leaked).toEqual([]);
    expect(env.HOME).toBe(paths.home);
    expect(env.XDG_CONFIG_HOME).toBe(paths.home + "/.config");
  });

  test("the config names only the loopback provider", () => {
    const config = referenceConfig("http://127.0.0.1:47832/v1");
    expect(Object.keys(config.providers)).toEqual(["mock"]);
    const settings = config.providers.mock.settings;
    expect(new URL(settings.baseURL).hostname).toBe("127.0.0.1");
    expect(config.providers.mock.models["mock-model"].capabilities.tools).toBe(true);
    expect(config.providers.mock.models["mock-model"].limit.context).toBe(0);
  });

  test("the reference model labels derive from its config", () => {
    expect(referenceLabels("http://127.0.0.1:47832/v1")).toContain("Mock Model");
  });
});

describe("harness failures", () => {
  const fakeOpencode = (version: string) => {
    const dir = mkdtempSync(join(tmpdir(), "maki-fake-opencode-"));
    const bin = join(dir, "opencode");
    writeFileSync(bin, `#!/bin/sh\necho 'opencode v${version}'\n`);
    chmodSync(bin, 0o755);
    return { bin, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  };

  test("a version mismatch names both versions and aborts", () => {
    const fake = fakeOpencode("9.9.9");
    try {
      expect(opencodeVersion(fake.bin)).toBe("9.9.9");
      expect(() => assertPinnedOpencode("2.0.32", fake.bin)).toThrow(/9\.9\.9.*2\.0\.32/);
    } finally {
      fake.cleanup();
    }
  });

  test("a missing opencode binary is a harness failure", () => {
    expect(() => opencodeVersion(join(tmpdir(), "maki-no-such-opencode"))).toThrow(HarnessError);
  });

  test("an unreached checkpoint leaves the final screen and error", () => {
    const dir = mkdtempSync(join(tmpdir(), "maki-failure-evidence-"));
    try {
      writeFailureEvidence(dir, "screen PONG", "step streamed timed out");
      expect(readFileSync(join(dir, "final-screen.txt"), "utf8")).toBe("screen PONG\n");
      expect(readFileSync(join(dir, "error.txt"), "utf8")).toBe("step streamed timed out\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("committed evidence drops volatile ids, clock, and run paths", () => {
    const frame = JSON.stringify({
      ts: "2026-10-24T12:00:00.000Z",
      id: "evt_abc123",
      event: "model.updated",
      data: { id: "evt_abc123", created: 1792846053398, location: { directory: paths.work } },
    });
    const normalized = JSON.parse(normalizeFrames(frame, paths)) as any;
    expect(normalized.ts).toBe("<TIME>");
    expect(normalized.id).toBe("<ID>");
    expect(normalized.data.created).toBe(0);
    expect(normalized.data.location.directory).toBe("<WORKDIR>");

    expect(normalizeRequests(JSON.stringify({ ts: "x", method: "GET", path: "/api/session/ses_abc123" }))).toBe(
      '{"method":"GET","path":"/api/session/{sessionID}"}\n',
    );
  });
});
