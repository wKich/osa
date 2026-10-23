#!/usr/bin/env bun
// Scripted `openshell` for the bridge's sandbox reads, injected through the
// OPENSHELL_BIN variable the bridge already takes (bridge/src/sandbox.ts).
// Accepts only the read shape the bridge may build —
//   sandbox exec -n <name> --no-login-shell --workdir <dir> -- <argv...>
// — and runs <argv> on the host in <dir>, which stands in for the sandbox the
// way fake-maki.ts runs tool calls on the host. Anything else (an --env value,
// a missing --no-login-shell, another subcommand) exits 64 so a test sees it.
//
//   FAKE_OPENSHELL_TRACE=<file>   append each argv as one JSON line
//   FAKE_SANDBOX_HOME=<dir>       HOME for the command (the sandbox user's home)
//   FAKE_SANDBOX_BIN=<dir>        stubs on the sandbox PATH (e.g. a scripted `maki`);
//                                 PATH is otherwise the system dirs only, so no
//                                 host-installed tool answers for the sandbox
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_OPENSHELL_TRACE) appendFileSync(process.env.FAKE_OPENSHELL_TRACE, JSON.stringify(args) + "\n");

const sep = args.indexOf("--");
const head = sep < 0 ? args : args.slice(0, sep);
const argv = sep < 0 ? [] : args.slice(sep + 1);
const flag = (name: string) => {
  const i = head.indexOf(name);
  return i < 0 ? undefined : head[i + 1];
};
const workdir = flag("--workdir");
const wellFormed =
  head[0] === "sandbox" &&
  head[1] === "exec" &&
  Boolean(flag("-n")) &&
  head.includes("--no-login-shell") &&
  !head.some((a) => a === "--env" || a.startsWith("--env=")) &&
  Boolean(workdir) &&
  argv.length > 0;
if (!wellFormed) {
  console.error(`fake-openshell: refused ${JSON.stringify(args)}`);
  process.exit(64);
}

// git is in the sandbox image; the harness passes the host's real git dir
// (FAKE_SANDBOX_GIT_DIR — on macOS not the /usr/bin xcrun shim, which can
// stall under concurrent calls)
const gitDir = process.env.FAKE_SANDBOX_GIT_DIR;
const proc = Bun.spawn(argv, {
  cwd: workdir,
  // the sandbox user's home stands alone: no host XDG dir leaks into a read
  env: {
    ...process.env,
    HOME: process.env.FAKE_SANDBOX_HOME ?? process.env.HOME,
    XDG_CONFIG_HOME: undefined,
    PWD: workdir,
    PATH: [process.env.FAKE_SANDBOX_BIN, gitDir, "/usr/bin", "/bin"].filter(Boolean).join(":"),
  },
  stdout: "inherit",
  stderr: "inherit",
});
// the bridge ends a read that outlives its budget with SIGTERM: end the
// command with it, as closing a real exec session would
process.on("SIGTERM", () => proc.kill("SIGTERM"));
process.exit(await proc.exited);
