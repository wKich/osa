// Adapter tests: parse the pinned OpenShell v0.1.2 JSON shapes, exercise the
// argv contract, and prove every failure mode normalizes into a structured
// error. All tests run against test/stub with a prefixed PATH; there is no
// gateway, no Docker, and no network.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OpenShellClient,
  parseRuleTable,
  stripAnsi,
  type OpenShellClientOptions,
} from "../src/openshell.ts";

const stubDir = join(import.meta.dir, "stub");

let workDir: string;
let stateDir: string;
let logPath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "dashboard-test-"));
  stateDir = join(workDir, "state");
  logPath = join(workDir, "argv.log");
  mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function makeClient(overrides: Partial<OpenShellClientOptions> = {}): OpenShellClient {
  const env: Record<string, string | undefined> = {
    PATH: `${stubDir}:${process.env.PATH ?? ""}`,
    STUB_STATE_DIR: stateDir,
    STUB_LOG: logPath,
    ...overrides.env,
  };
  return new OpenShellClient({ ...overrides, env });
}

function seedSandbox(name: string, phase = "Ready", providers = ["maki-anthropic"]): void {
  mkdirSync(join(stateDir, "sandboxes"), { recursive: true });
  mkdirSync(join(stateDir, "providers"), { recursive: true });
  writeFileSync(join(stateDir, "sandboxes", name), `${phase}\n`);
  writeFileSync(join(stateDir, "providers", name), `${providers.join("\n")}\n`);
}

function argvLog(): string {
  return existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
}

describe("sandbox inventory", () => {
  test("listSandboxes parses the pinned list shape", async () => {
    seedSandbox("demo");
    const result = await makeClient().listSandboxes();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    const sandbox = result.value[0]!;
    expect(sandbox.name).toBe("demo");
    expect(sandbox.phase).toBe("Ready");
    expect(sandbox.labels).toEqual({ stub: "true" });
    expect(sandbox.currentPolicyVersion).toBe(4);
    expect(sandbox.note).toBeNull();
  });

  test("listSandboxes surfaces invalid-configuration notes", async () => {
    seedSandbox("broken");
    const client = makeClient({ env: { STUB_SANDBOX_NOTE: "policy failed to load" } });
    const result = await client.listSandboxes();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.note).toBe("Invalid config: policy failed to load");
  });

  test("getSandbox returns detail fields including policy source and revision", async () => {
    seedSandbox("demo");
    const result = await makeClient().getSandbox("demo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.policySource).toBe("sandbox");
    expect(result.value.revision).toBe(4);
    expect(result.value.restartPolicy).toBe("never");
    expect(result.value.policy).not.toBeNull();
  });

  test("listProviders maps attached providers", async () => {
    seedSandbox("demo", "Ready", ["maki-anthropic", "maki-openrouter"]);
    const result = await makeClient().listProviders("demo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((provider) => provider.name)).toEqual([
      "maki-anthropic",
      "maki-openrouter",
    ]);
    expect(result.value[0]!.credentialKeys).toEqual(["STUB_TOKEN"]);
  });
});

describe("policy", () => {
  test("policyGet full includes provider rules, base excludes them", async () => {
    seedSandbox("demo");
    const client = makeClient();
    const full = await client.policyGet("demo", "full");
    const base = await client.policyGet("demo", "base");
    expect(full.ok).toBe(true);
    expect(base.ok).toBe(true);
    if (!full.ok || !base.ok) return;

    const fullKeys = Object.keys(
      (full.value.policy as { network_policies: Record<string, unknown> }).network_policies,
    );
    const baseKeys = Object.keys(
      (base.value.policy as { network_policies: Record<string, unknown> }).network_policies,
    );
    expect(fullKeys).toContain("provider:stub");
    expect(baseKeys).not.toContain("provider:stub");
    expect(baseKeys).toContain("stub_base_rule");
  });

  test("policyList maps revisions with load status", async () => {
    seedSandbox("demo");
    const result = await makeClient().policyList("demo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(3);
    expect(result.value[0]!.status).toBe("loaded");
    expect(result.value[0]!.loadedAtMs).not.toBeNull();
    expect(result.value[2]!.status).toBe("failed");
    expect(result.value[2]!.loadError).toBe("stub policy rejected");
  });
});

describe("rule proposals", () => {
  test("rules parses the rule get table, filtered to pending", async () => {
    seedSandbox("demo");
    const result = await makeClient().rules("demo", "pending");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    const proposal = result.value[0]!;
    expect(proposal.chunkId).toBe("chunk-pending-1");
    expect(proposal.status).toBe("pending");
    expect(proposal.ruleName).toBe("allow_stub_api");
    expect(proposal.confidence).toBeCloseTo(0.87, 5);
    expect(proposal.securityNotes).toBe("link_local_reach");
    expect(proposal.binaries).toEqual(["/usr/bin/curl"]);
  });

  test("parseRuleTable handles ANSI colors and multiple proposals", () => {
    const table = [
      "\u001b[36mNetwork Rules:\u001b[0m  (version 9, 2 chunks)",
      "",
      "  \u001b[2mChunk:\u001b[0m one",
      "  \u001b[2mStatus:\u001b[0m \u001b[33mpending\u001b[0m",
      "  \u001b[2mRule:\u001b[0m rule_one",
      "  \u001b[2mConfidence:\u001b[0m 50%",
      "",
      "  \u001b[2mChunk:\u001b[0m two",
      "  \u001b[2mStatus:\u001b[0m approved",
      "  \u001b[2mRule:\u001b[0m rule_two",
      "  \u001b[2mBinaries:\u001b[0m /usr/bin/a, /usr/bin/b",
    ].join("\n");
    const proposals = parseRuleTable(table);
    expect(proposals).toHaveLength(2);
    expect(proposals[0]!.status).toBe("pending");
    expect(proposals[0]!.confidence).toBe(0.5);
    expect(proposals[1]!.binaries).toEqual(["/usr/bin/a", "/usr/bin/b"]);
    expect(stripAnsi("\u001b[31mred\u001b[0m")).toBe("red");
  });

  test("approve and reject pass chunk id and reason", async () => {
    seedSandbox("demo");
    const client = makeClient();
    const approved = await client.approveRule("demo", "chunk-1");
    const rejected = await client.rejectRule("demo", "chunk-2", "scope it narrower");
    expect(approved.ok).toBe(true);
    expect(rejected.ok).toBe(true);
    const log = argvLog();
    expect(log).toContain("--chunk-id");
    expect(log).toContain("chunk-1");
    expect(log).toContain("chunk-2");
    expect(log).toContain("--reason");
    expect(log).toContain("scope it narrower");
  });

  test("rejectRule refuses an empty reason without invoking the CLI", async () => {
    seedSandbox("demo");
    const result = await makeClient().rejectRule("demo", "chunk-1", "   ");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("invalid_request");
    expect(argvLog()).not.toContain("rule");
  });
});

describe("settings and doctor", () => {
  test("settingsGet maps entries", async () => {
    seedSandbox("demo");
    const result = await makeClient().settingsGet("demo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sandbox).toBe("demo");
    expect(result.value.settings.proposal_approval_mode).toEqual({
      value: "manual",
      scope: "unset",
    });
  });

  test("doctor reports CLI version and connected gateway", async () => {
    const result = await makeClient().doctor();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cli.ok).toBe(true);
    expect(result.value.cli.version).toContain("openshell");
    expect(result.value.gateway.ok).toBe(true);
    expect(result.value.gateway.status).toBe("connected");
  });

  test("doctor reports a missing CLI and does not throw", async () => {
    const emptyDir = join(workDir, "empty-path");
    mkdirSync(emptyDir, { recursive: true });
    const client = makeClient({ env: { PATH: emptyDir } });
    const result = await client.doctor();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cli.ok).toBe(false);
    expect(result.value.cli.error).toContain("not found");
  });
});

describe("lifecycle actions", () => {
  test("createSandbox passes configured defaults and creates state", async () => {
    const client = makeClient();
    const result = await client.createSandbox({
      name: "scratch",
      image: "maki-agent:local",
      policy: "/repo/examples/policies/maki-minimal.yaml",
      providers: ["maki-anthropic"],
      cpu: "2",
      memory: "4Gi",
    });
    expect(result.ok).toBe(true);
    const log = argvLog();
    expect(log).toContain("--name");
    expect(log).toContain("scratch");
    expect(log).toContain("--detach");
    expect(log).toContain("--from");
    expect(log).toContain("maki-agent:local");
    expect(log).toContain("--policy");
    expect(log).toContain("--provider");
    expect(log).toContain("--cpu");
    expect(log).toContain("--memory");
    expect(existsSync(join(stateDir, "sandboxes", "scratch"))).toBe(true);
  });

  test("createSandbox requires a name", async () => {
    const result = await makeClient().createSandbox({ name: "  " });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("invalid_request");
  });

  test("start, stop, and delete mutate stub state", async () => {
    seedSandbox("demo", "Stopped");
    const client = makeClient();

    const started = await client.sandboxAction("start", "demo");
    expect(started.ok).toBe(true);
    expect(readFileSync(join(stateDir, "sandboxes", "demo"), "utf8").trim()).toBe("Ready");

    const stopped = await client.sandboxAction("stop", "demo");
    expect(stopped.ok).toBe(true);
    expect(readFileSync(join(stateDir, "sandboxes", "demo"), "utf8").trim()).toBe("Stopped");

    const deleted = await client.sandboxAction("delete", "demo");
    expect(deleted.ok).toBe(true);
    expect(existsSync(join(stateDir, "sandboxes", "demo"))).toBe(false);
  });
});

describe("error normalization", () => {
  test("missing CLI becomes missing_cli", async () => {
    const emptyDir = join(workDir, "empty-path");
    mkdirSync(emptyDir, { recursive: true });
    const client = makeClient({ env: { PATH: emptyDir } });
    const result = await client.listSandboxes();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("missing_cli");
    expect(result.error.message).toContain("not found");
  });

  test("non-zero exit carries stderr and exit code", async () => {
    seedSandbox("demo");
    const client = makeClient({ env: { STUB_FAIL: "gateway" } });
    const result = await client.listSandboxes();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("exit");
    expect(result.error.exitCode).toBe(1);
    expect(result.error.message).toContain("gateway unreachable");
  });

  test("invalid JSON becomes invalid_json with an output excerpt", async () => {
    seedSandbox("demo");
    const client = makeClient({ env: { STUB_FAIL: "invalid-json" } });
    const result = await client.listSandboxes();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("invalid_json");
    expect(result.error.detail).toContain("not valid json");
  });

  test("a non-executable binary becomes spawn error", async () => {
    const badBinary = join(workDir, "not-executable");
    writeFileSync(badBinary, "#!/bin/sh\necho nope\n");
    const client = makeClient({ binary: badBinary });
    const result = await client.listSandboxes();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("spawn");
  });

  test("slow commands become timeout and the child is killed", async () => {
    seedSandbox("demo");
    const client = makeClient({ env: { STUB_FAIL: "timeout" }, timeoutMs: 150 });
    const result = await client.listSandboxes();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("timeout");
  });
});

describe("logs streaming", () => {
  test("spawnLogs streams stub lines and stops on kill", async () => {
    seedSandbox("demo");
    const client = makeClient({
      env: { STUB_LOG_LINES: "3", STUB_LOG_INTERVAL: "0.01", STUB_LOG_KEEPALIVE: "0" },
    });
    const spawned = client.spawnLogs("demo");
    expect(spawned.ok).toBe(true);
    if (!spawned.ok) return;

    const reader = spawned.value.stdout.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toContain("gateway log line 1");
    expect(text).toContain("sandbox log line 2");
    expect(await spawned.value.exited).toBe(0);
  });

  test("spawnLogs reports a missing CLI", async () => {
    const emptyDir = join(workDir, "empty-path");
    mkdirSync(emptyDir, { recursive: true });
    const client = makeClient({ env: { PATH: emptyDir } });
    const result = client.spawnLogs("demo");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("missing_cli");
  });
});

describe("recent logs (egress read)", () => {
  test("stub prints the denial fixture for a one-shot read and records argv", async () => {
    const proc = Bun.spawn({
      cmd: [join(stubDir, "openshell"), "logs", "demo", "--since", "1h", "--source", "sandbox", "-n", "5000"],
      env: { ...process.env, STUB_LOG: logPath },
      stdout: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    const lines = text.trim().split("\n");
    expect(lines.some((line) => line.includes("DENIED /usr/bin/curl(64) -> example.com:443"))).toBe(true);
    expect(lines.some((line) => line.includes("DENIED example.com [reason:policy_dns_ineligible]"))).toBe(true);
    expect(lines.some((line) => line.includes("[policy:- engine:opa]"))).toBe(true);
    expect(lines.some((line) => line.includes("[2001:db8::1]:8443"))).toBe(true);
    expect(lines.some((line) => line.includes("CONFIG:OBSERVATION"))).toBe(true);
    expect(lines.some((line) => line.includes("HTTP:GET [MED] DENIED"))).toBe(true);
    expect(lines.some((line) => line.includes("\u001b[33m"))).toBe(true);
    expect(lines.some((line) => line.includes("<img src=x onerror=alert(1)>"))).toBe(true);
    expect(argvLog()).toContain("---\nlogs\ndemo\n--since\n1h\n--source\nsandbox\n-n\n5000\n");
  });

  test("stub fails a one-shot read with STUB_LOGS_FAIL and still answers other commands", async () => {
    const client = makeClient({ env: { STUB_LOGS_FAIL: "1" } });
    const logs = await client.recentLogs("demo", "1h");
    expect(logs.ok).toBe(false);
    if (logs.ok) return;
    expect(logs.error.kind).toBe("exit");
    expect(logs.error.message).toContain("gateway unreachable");
    expect((await client.rules("demo", "pending")).ok).toBe(true);
  });

  for (const window of ["15m", "1h", "6h"] as const) {
    test(`recentLogs passes --since ${window} with the line cap`, async () => {
      const result = await makeClient().recentLogs("demo", window);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.capped).toBe(false);
      expect(result.value.lines.length).toBeGreaterThan(5);
      expect(argvLog()).toBe(`---\nlogs\ndemo\n--since\n${window}\n--source\nsandbox\n-n\n5000\n`);
    });
  }

  test("recentLogs refuses a window outside the enum without invoking the CLI", async () => {
    const result = await makeClient().recentLogs("demo", "2d" as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("invalid_request");
    expect(argvLog()).toBe("");
  });

  test("recentLogs flags a read that hit the line cap", async () => {
    const file = join(workDir, "many.log");
    writeFileSync(file, Array.from({ length: 5000 }, (_, i) => `[1.${i}] [sandbox] [INFO ] [x] line`).join("\n") + "\n");
    const result = await makeClient({ env: { STUB_LOGS_FILE: file } }).recentLogs("demo", "6h");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines).toHaveLength(5000);
    expect(result.value.capped).toBe(true);
  });

  test("recentLogs times out", async () => {
    const client = makeClient({ env: { STUB_FAIL: "timeout" }, timeoutMs: 150 });
    const result = await client.recentLogs("demo", "1h");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("timeout");
  });

  test("recentLogs reports a missing CLI", async () => {
    const emptyDir = join(workDir, "empty-path");
    mkdirSync(emptyDir, { recursive: true });
    const result = await makeClient({ env: { PATH: emptyDir } }).recentLogs("demo", "1h");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("missing_cli");
  });
});
