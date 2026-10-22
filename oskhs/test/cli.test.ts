import { expect, test } from "bun:test";
import { exitCode, parseRunRound, parseWorker } from "../src/cli.ts";

test("parses run-round arguments", () => {
  const a = parseRunRound(["/r", "hi there", "--model", "m", "--provider", "p1", "--provider", "p2", "--timeout", "30", "--base", "dev"], {});
  expect(a).toMatchObject({ repo: "/r", prompt: "hi there", model: "m", providers: ["p1", "p2"], timeoutSec: 30, base: "dev" });
});

test("environment defaults", () => {
  const a = parseRunRound(["/r", "q"], { OSKHS_PROVIDERS: "a, b", OSKHS_MODEL: "x/y", OSKHS_TIMEOUT: "9" });
  expect(a).toMatchObject({ providers: ["a", "b"], model: "x/y", timeoutSec: 9 });
  expect(parseRunRound(["/r", "q"], {}).timeoutSec).toBe(600);
});

test("a prompt after -- may start with a dash", () => {
  expect(parseRunRound(["/r", "--", "-v?"], {}).prompt).toBe("-v?");
});

test("usage errors", () => {
  expect(() => parseRunRound(["/r"], {})).toThrow();
  expect(() => parseRunRound(["/r", "q", "--timeout", "soon"], {})).toThrow("--timeout");
  expect(() => parseRunRound(["/r", "q", "--model"], {})).toThrow("requires a value");
  expect(() => parseRunRound(["/r", "q", "--nope"], {})).toThrow("unknown option");
});

test("exit status is 0 only for an answer", () => {
  expect(exitCode({ kind: "answer", text: "", sessionId: "", durationMs: 0, numTurns: 0, usage: {} })).toBe(0);
  expect(exitCode({ kind: "agent-error", message: "x" })).toBe(4);
  expect(exitCode({ kind: "timeout", seconds: 1 })).toBe(4);
  expect(exitCode({ kind: "failed", stage: "run", exitCode: 1, stderr: "" })).toBe(3);
});

test("worker options and defaults", () => {
  const w = parseWorker(["--round", "echo", "--max-rounds", "3", "--fake-delay", "0", "--once"], { OSKHS_HOST_ID: "h1", XDG_STATE_HOME: "/s" });
  expect(w).toMatchObject({ round: "echo", once: true, fakeDelaySec: 0, pollSec: 2, logDir: "/s/oskhs/tasks" });
  expect(w.options).toEqual({ hostId: "h1", maxRounds: 3, maxPerProject: 1, roundTimeoutSec: 600, heartbeatSec: 20, cancelPollSec: 3, abortGraceSec: 30 });
  expect(parseWorker(["--round", "echo"], {}).options.hostId).toStartWith("oskhs-");
  expect(() => parseWorker([], {})).toThrow("--mirror-dir");
  const s = parseWorker(["--mirror-dir", "/m", "--model", "a/b", "--provider", "p1", "--agent-name", "svc_kiss"], { OSKHS_PROVIDERS: "x" });
  expect(s).toMatchObject({ round: "sandbox", mirrorDir: "/m", model: "a/b", providers: ["p1"], agentName: "svc_kiss" });
  expect(parseWorker([], { OSKHS_MIRROR_DIR: "/m", OSKHS_PROVIDERS: "a,b" })).toMatchObject({ mirrorDir: "/m", providers: ["a", "b"], agentName: "kiss" });
  expect(() => parseWorker(["--round", "fast"], {})).toThrow("sandbox or echo");
  expect(() => parseWorker(["--round", "echo", "--max-rounds", "0"], {})).toThrow("positive");
  expect(() => parseWorker(["--round", "echo", "--heartbeat-sec", "600"], {})).toThrow("dead-runtime");
  expect(() => parseWorker(["--nope", "1"], {})).toThrow("unknown option");
});
