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

const proc = Bun.spawnSync(argv, {
  cwd: workdir,
  // the sandbox user's home stands alone: no host XDG dir leaks into a read
  env: { ...process.env, HOME: process.env.FAKE_SANDBOX_HOME ?? process.env.HOME, XDG_CONFIG_HOME: undefined },
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(proc.exitCode ?? 1);
