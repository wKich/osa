#!/usr/bin/env bun
// Maki-side drift check: the image's pinned Maki (examples/maki-image/
// Dockerfile ARG MAKI_VERSION) against Maki's latest release tag. For every
// release newer than the pin it reports the release notes and whether the
// SDK surface the bridge and its pin citations rest on changed between the
// tags: the stream-json wire (src/sdk_mode.rs), the CLI (src/cli.rs) and the
// MCP client handshake (maki-agent/src/mcp/protocol.rs). Exits 1 when that
// surface changed (re-triage every `blockedBy: "pin"` row against the new
// tag), 0 otherwise. Reads only: `git ls-remote` and public raw files.
// Skips with a message when the network is unavailable. Never part of
// `make test`.
import { readFileSync } from "node:fs";

export const REPO = "tontinton/maki";
export const SDK_SURFACE = ["src/sdk_mode.rs", "src/cli.rs", "maki-agent/src/mcp/protocol.rs"];

/** the pinned version from the Dockerfile's `ARG MAKI_VERSION=` */
export function pinnedVersion(dockerfile: string): string | undefined {
  return /^ARG MAKI_VERSION=(\d+\.\d+\.\d+)\s*$/m.exec(dockerfile)?.[1];
}

const parse = (v: string) => v.split(".").map(Number) as [number, number, number];
export const compareVersions = (a: string, b: string) => {
  const [x, y] = [parse(a), parse(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

/** release versions in `git ls-remote --tags --refs` output, oldest first */
export function releaseVersions(lsRemote: string): string[] {
  const versions = [...lsRemote.matchAll(/refs\/tags\/v(\d+\.\d+\.\d+)$/gm)].map((m) => m[1]!);
  return [...new Set(versions)].sort(compareVersions);
}

async function main(): Promise<number> {
  const pin = pinnedVersion(readFileSync("examples/maki-image/Dockerfile", "utf8"));
  if (!pin) {
    console.log("maki-drift: no `ARG MAKI_VERSION=x.y.z` in examples/maki-image/Dockerfile");
    return 1;
  }
  const remote = Bun.spawnSync(["git", "ls-remote", "--tags", "--refs", `https://github.com/${REPO}`], { stdout: "pipe", stderr: "pipe" });
  if (remote.exitCode !== 0) {
    console.log(`maki-drift: skipping — cannot list ${REPO} tags (${new TextDecoder().decode(remote.stderr).trim() || "git ls-remote failed"})`);
    return 0;
  }
  const releases = releaseVersions(new TextDecoder().decode(remote.stdout));
  const newer = releases.filter((v) => compareVersions(v, pin) > 0);
  const latest = releases.at(-1) ?? pin;
  console.log(`maki-drift: pinned v${pin}, latest release v${latest}`);
  if (newer.length === 0) {
    console.log("maki-drift: the pin is the latest release");
    return 0;
  }
  const raw = async (tag: string, file: string) => {
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/v${tag}/${file}`);
    return res.ok ? res.text() : undefined;
  };
  let changed = false;
  for (const file of SDK_SURFACE) {
    const [before, after] = await Promise.all([raw(pin, file), raw(latest, file)]);
    if (before === undefined || after === undefined) {
      console.log(`maki-drift: skipping — cannot read ${file} at v${pin} or v${latest}`);
      return 0;
    }
    const same = before === after;
    if (!same) changed = true;
    console.log(`  ${file}: ${same ? "unchanged" : "CHANGED"} v${pin} → v${latest}`);
  }
  for (const v of newer) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/v${v}`, { headers: { accept: "application/vnd.github+json" } });
    const body = res.ok ? String(((await res.json()) as { body?: string }).body ?? "").trim() : "";
    console.log(`  release v${v}:${body ? "\n" + body.split("\n").slice(0, 12).map((l) => `    ${l}`).join("\n") : " (no notes)"}`);
  }
  console.log(changed
    ? "maki-drift: the SDK surface changed — re-triage every pin-blocked row against the new tag"
    : "maki-drift: the SDK surface is unchanged — no pin-blocked row can close by bumping the pin");
  return changed ? 1 : 0;
}

if (import.meta.main) process.exit(await main());
