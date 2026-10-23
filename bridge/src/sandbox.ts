// Read-only sandbox reads for routes whose real state lives in the project
// sandbox (files, git, Maki's own config), over the same transport the Maki
// child uses (design decision 3 of add-opencode-tui-bridge):
//
//   <openshell> sandbox exec -n <name> --no-login-shell --workdir <dir> -- <argv>
//
// built from the helper's environment (OPENSHELL_BIN, OPENMAKI_SANDBOX). No
// --env value is ever passed, no host path is read, and nothing is mounted:
// the sandbox is the only place these answers come from. Without a sandbox
// (a MAKI_CHILD_CMD-only run) every read is `null` and the route answers its
// empty, spec-valid shape.
import { spawn } from "node:child_process";

export interface SandboxResult {
  code: number;
  stdout: string;
}

const TIMEOUT_MS = 10_000;

/** argv for one sandbox read; exported so the shape can be asserted without spawning */
export function sandboxArgv(
  argv: string[],
  workdir: string,
  env: Record<string, string | undefined> = process.env,
): string[] | null {
  const name = env.OPENMAKI_SANDBOX;
  if (!name) return null;
  const openshell = env.OPENSHELL_BIN ?? "openshell";
  return [openshell, "sandbox", "exec", "-n", name, "--no-login-shell", "--workdir", workdir, "--", ...argv];
}

/** runs one read in the sandbox; null when there is no sandbox or the exec fails to start */
export function sandboxRun(argv: string[], workdir: string): Promise<SandboxResult | null> {
  const full = sandboxArgv(argv, workdir);
  if (!full) return Promise.resolve(null);
  return new Promise((resolve) => {
    // the host cwd is irrelevant to the exec; the sandbox workdir is --workdir
    const child = spawn(full[0]!, full.slice(1), { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout });
    });
  });
}
