#!/usr/bin/env bun
// Scripted `openshell` for the harness. The bridge's sandbox reads use
//   sandbox exec -n <name> --no-login-shell --workdir <dir> -- <argv...>
// (bridge/src/sandbox.ts), which this runs on the host in <dir>, the way
// fake-maki.ts runs tool calls on the host. The live journey runner additionally
// uses the sandbox lifecycle and upload; those are recorded and, when
// FAKE_SANDBOX_ROOT is set, mirrored into a fake sandbox filesystem. Anything
// else exits 64 so a test sees an unexpected command.
//
//   FAKE_OPENSHELL_TRACE=<file>   append each argv as one JSON line
//   FAKE_SANDBOX_HOME=<dir>       HOME for the command (the sandbox user's home)
//   FAKE_SANDBOX_BIN=<dir>        stubs on the sandbox PATH (e.g. a scripted `maki`);
//                                 PATH is otherwise the system dirs only, so no
//                                 host-installed tool answers for the sandbox
//   FAKE_SANDBOX_LIST=<names>     newline-separated names for `sandbox list --names`
//   FAKE_SANDBOX_PHASE=<phase>    phase for `sandbox get` (default Ready)
//   FAKE_SANDBOX_ROOT=<dir>       upload destination root for `/sandbox` and `/tmp`
//   FAKE_OPENSHELL_STATUS=<code>  exit code for `status`
import { appendFileSync, cpSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const args = process.argv.slice(2);
if (process.env.FAKE_OPENSHELL_TRACE) appendFileSync(process.env.FAKE_OPENSHELL_TRACE, JSON.stringify(args) + "\n");

const refuse = (): never => {
  console.error(`fake-openshell: refused ${JSON.stringify(args)}`);
  process.exit(64);
};

if (args[0] === "status") {
  process.exit(Number(process.env.FAKE_OPENSHELL_STATUS ?? "0"));
}

if (args[0] !== "sandbox") refuse();

if (args[1] === "list" && args.includes("--names")) {
  console.log(process.env.FAKE_SANDBOX_LIST ?? "");
  process.exit(0);
}

if (args[1] === "get") {
  console.log(JSON.stringify({ phase: process.env.FAKE_SANDBOX_PHASE ?? "Ready" }));
  process.exit(0);
}

if (args[1] === "create" || args[1] === "delete") {
  process.exit(0);
}

if (args[1] === "upload") {
  const [name, local, dest] = args.slice(2).filter((a) => !a.startsWith("--"));
  if (!name || !local) refuse();
  const root = process.env.FAKE_SANDBOX_ROOT;
  if (root && dest) {
    const mapped = dest.startsWith("/") ? join(root, dest) : join(root, dest);
    const target = dest.endsWith("/") ? join(mapped, basename(local)) : mapped;
    mkdirSync(dirname(target), { recursive: true });
    cpSync(local, target, { recursive: true });
  }
  process.exit(0);
}

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
