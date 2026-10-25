// The TUI's shell mode (`!command`): the user's own command, run in the
// project sandbox through the transport the Maki child uses — the sandbox is
// the boundary, exactly as for the child's tools. Output is stdout and stderr
// combined, as OpenCode captures it (core session/shell.ts v2.1.4 L10–L26),
// capped at the 1 MiB page OpenCode reads back.
import { spawn } from "node:child_process";
import { sandboxArgv } from "./sandbox.ts";

const OUTPUT_LIMIT = 1024 * 1024;

export interface ShellRun {
  output: string;
  truncated: boolean;
  exit: number;
}

/** null when there is no sandbox to run in */
export function runUserShell(command: string, workdir: string): Promise<ShellRun> | null {
  const argv = sandboxArgv(["sh", "-c", `exec 2>&1\n${command}`], workdir);
  if (!argv) return null;
  return new Promise((resolve) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] });
    let bytes = Buffer.alloc(0);
    let truncated = false;
    child.stdout.on("data", (d: Buffer) => {
      if (bytes.length >= OUTPUT_LIMIT) {
        truncated = true;
        return;
      }
      bytes = Buffer.concat([bytes, d]);
      if (bytes.length > OUTPUT_LIMIT) {
        bytes = bytes.subarray(0, OUTPUT_LIMIT);
        truncated = true;
      }
    });
    child.on("error", () => resolve({ output: "", truncated: false, exit: 127 }));
    child.on("close", (code) => resolve({ output: bytes.toString("utf8"), truncated, exit: code ?? 1 }));
  });
}

/** the notice the model reads with its next turn (core shell/result.ts v2.1.4 L36–L81) */
export function shellNotice(shellID: string, command: string, run: ShellRun): string {
  const status = run.exit === 0 ? undefined : `Exited with code ${run.exit}`;
  const text = [run.output, status].filter((x) => x !== undefined && x !== "").join("\n\n");
  return `The following shell command was executed by the user:\n<shell id="${shellID}" state="completed" command="${command}">\n${text}\n</shell>`;
}
