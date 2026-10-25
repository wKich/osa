// One Maki SDK process behind one OpenCode session (design decision 2):
// `maki -p --input-format stream-json --output-format stream-json` over stdio,
// a bidirectional line-JSON stream. Measured: the process survives across
// turns (one session_id for its lifetime) and blocks a tool call until a
// control_response line answers its control_request.
//
// The child executable is injectable (design decision 2):
//   MAKI_CHILD_CMD=<path>   run this executable instead, with the same SDK
//                           flags appended — the test seam for a scripted
//                           process (spike harness/stub.ts shape)
// Without the override the default transport is the project sandbox
// (design decision 3), built from the helper's environment:
//   OPENSHELL_BIN=<path>    resolved openshell CLI (default: openshell)
//   OPENMAKI_SANDBOX=<name> the project sandbox (required on this path)
// producing `<openshell> sandbox exec -n <name> --no-login-shell --workdir
// <workdir> -- maki -p --trust --input-format stream-json --output-format
// stream-json [-m <model>]`. No --env value is ever passed (security
// invariant: the sandbox only sees provider-profile placeholders).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export interface MakiOptions {
  cwd: string; // sandbox workdir: the child's workdir on the default path
  model?: string; // provider/model spec; omit for maki's default
  // continue a stored Maki session under a new id (`-r <id> --fork-session`,
  // src/cli.rs v0.6.5 L53–L63, L114–L117)
  fork?: string;
  // continue a stored Maki session as itself (`-r <id>`, src/cli.rs v0.6.5
  // L53–L63): a moved session's child, restarted in its new workdir
  resume?: string;
  onFrame: (frame: any) => void;
  onExit: (code: number | null) => void;
}

const SDK_FLAGS = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--include-partial-messages"];

/** argv for the child; exported so the shape can be asserted without spawning */
export function childArgv(opts: MakiOptions, env: Record<string, string | undefined> = process.env): string[] {
  const model = [
    ...(opts.model ? ["-m", opts.model] : []),
    ...(opts.fork ? ["-r", opts.fork, "--fork-session"] : opts.resume ? ["-r", opts.resume] : []),
  ];
  const override = env.MAKI_CHILD_CMD;
  if (override) return [override, ...SDK_FLAGS, ...model];
  const name = env.OPENMAKI_SANDBOX;
  // maki on the host would break this repository's premise; refuse instead
  if (!name) throw new Error("OPENMAKI_SANDBOX is not set (or set MAKI_CHILD_CMD): the bridge runs maki inside the project sandbox");
  const openshell = env.OPENSHELL_BIN ?? "openshell";
  return [openshell, "sandbox", "exec", "-n", name, "--no-login-shell", "--workdir", opts.cwd, "--", "maki", "-p", "--trust", ...SDK_FLAGS.slice(1), ...model];
}

export interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

export type ContentBlock = ImageBlock | { type: "text"; text: string };

export class MakiSession {
  private child: ChildProcessWithoutNullStreams;
  private buf = "";
  private dead = false;
  private controlSeq = 0;

  constructor(opts: MakiOptions) {
    const argv = childArgv(opts);
    // cwd is the host's; the child's working directory is the sandbox
    // workdir (--workdir), and a host-side workdir path may not exist here
    // a scripted child (MAKI_CHILD_CMD) reads its workdir from OPENMAKI_CWD
    const env = process.env.MAKI_CHILD_CMD ? { ...process.env, OPENMAKI_CWD: opts.cwd } : process.env;
    this.child = spawn(argv[0]!, argv.slice(1), { cwd: process.cwd(), env, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (chunk) => this.read(chunk.toString(), opts.onFrame));
    this.child.stderr.on("data", (d) => process.stderr.write(`[maki] ${d}`));
    this.child.on("exit", (code) => opts.onExit(code));
    // a failed spawn never emits `exit`; surface it so the session reads as
    // dead instead of running forever
    this.child.on("error", (err) => {
      this.dead = true;
      console.error(`[maki] child spawn failed: ${err}`);
      opts.onExit(127);
    });
  }

  get running(): boolean {
    return !this.dead && this.child.exitCode === null && !this.child.killed;
  }

  // image blocks ride after the text block in the same content array, the
  // stream-json shape the pinned child decodes (sdk_mode.rs v0.6.5 L807–L816)
  prompt(text: string, blocks: ContentBlock[] = []): void {
    this.write({ type: "user", message: { role: "user", content: [{ type: "text", text }, ...blocks] } });
  }

  // the pinned decoder (sdk_mode.rs v0.6.5 L918–L927) reads `allow` plus an
  // `updatedPermissions` key as AllowSession and `deny` plus a non-empty
  // `message` as DenyWithGuidance; a bare behavior is AllowOnce / Deny
  answer(requestID: string, behavior: "allow" | "deny", extra: { updatedPermissions?: unknown[]; message?: string } = {}): void {
    this.write({ type: "control_response", response: { request_id: requestID, behavior, ...extra } });
  }

  // the pinned wire cancels a run with inbound control_request/interrupt
  // (sdk_mode.rs v0.6.5 L840–L843), not control_cancel_request, which only
  // denies one pending ask; maki acks with a control_response, then ends the
  // run with an error result
  interrupt(): string {
    return this.control("interrupt", {});
  }

  // inbound control_request/set_model (sdk_mode.rs v0.6.5 L861–L874): maki
  // resolves the spec through its model policy and acks success or error
  setModel(spec: string): string {
    return this.control("set_model", { model: spec });
  }

  // the pinned mode control (sdk_mode.rs v0.6.5 L846–L860); the next user
  // message runs in the mode it names (L688–L696)
  setPermissionMode(mode: string): string {
    return this.control("set_permission_mode", { mode });
  }

  /** writes one bridge-originated control request; returns its request_id */
  private control(subtype: string, fields: Record<string, unknown>): string {
    const requestID = `bridge_${subtype}_${++this.controlSeq}`;
    this.write({ type: "control_request", request_id: requestID, request: { subtype, ...fields } });
    return requestID;
  }

  kill(): void {
    if (this.running) this.child.kill("SIGTERM");
  }

  // stdin stays open for the session's lifetime (task 2.3): closing it early
  // ends the SDK stream and maki exits mid-session
  private write(obj: unknown): void {
    try {
      this.child.stdin.write(JSON.stringify(obj) + "\n");
    } catch (err) {
      // stdin closed under us (maki exited): surface, don't crash the bridge
      console.error(`[maki] write failed: ${err}`);
    }
  }

  // stdout is line-JSON; tolerate stray non-JSON lines (progress noise) by
  // dropping them rather than failing the session
  private read(chunk: string, onFrame: (frame: any) => void): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      try {
        onFrame(JSON.parse(line));
      } catch {
        console.error(`[maki] dropped non-JSON line: ${line.slice(0, 120)}`);
      }
    }
  }
}
