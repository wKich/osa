# Design

## Context

See proposal.md — Why. Facts the design rests on:

- `openshell` 0.1.5 is installed; `bin/maki-oss` already checks the gateway
  (`openshell status`) and owns sandbox lifecycle; the bridge reaches Maki
  through `openshell sandbox exec` (`bridge/src/maki.ts`, `OPENSHELL_BIN`,
  `OPENMAKI_SANDBOX`) and reads sandbox state the same way
  (`bridge/src/sandbox.ts`).
- The image (`examples/maki-image/Dockerfile`) ships Maki 0.6.4 and Bun 1.4.3
  and runs as uid 1500, so a Bun mock provider can run inside the sandbox.
- A sandbox has its own network namespace; the host's loopback is unreachable
  from inside (`docs/dogfood-migration.md`, "localhost"). Provider profiles
  bind a credential to one endpoint, and the curated profiles warn against
  overriding a provider's base URL.
- The baked `init.lua` sets `always_yolo = true`, so an unmodified image never
  sends a `can_use_tool` ask. A permission journey run live with the baked
  config would skip the dialog the reference shows.
- Not yet established: whether Maki 0.6.4 can target a custom
  OpenAI-compatible base URL (and through which config file), and whether the
  minimal policy lets a sandbox process reach its own loopback.

## Goals / Non-Goals

**Goals:**
- Live verdicts for scripted journeys against the real pinned Maki, compared
  with the same references and rules as the offline run.
- No widening of the security surface, and nothing left behind.
- Live evidence that the offline suite can re-check.

**Non-Goals:**
- Real model providers or real credentials.
- Making live runs part of `make test`.
- Changing the baked image config or the curated provider profiles.

## Decisions

1. **The mock provider runs inside the sandbox.**

   ```
   host                                    sandbox (own netns, uid 1500)
   +------------------------------+        +-------------------------------+
   | PTY driver --> opencode TUI  |        |  mock-provider (bun)          |
   |                    |         |        |     127.0.0.1:<p>  <--+       |
   |                    v         |  exec  |                       |       |
   |                 bridge  -----+------->|  maki (SDK mode) -----+       |
   +------------------------------+        +-------------------------------+
   ```

   Alternatives rejected: a host-side mock reached through a new network rule
   to the host (widens egress to the host, a security decision this change
   must not make); a real provider (non-deterministic, needs a credential).
   If the spike shows either precondition fails, the change stops and reports.

2. **Throwaway sandbox per run.** Name `maki-oss-journeys-<run id>`, created
   from `maki-agent:local` with `examples/policies/maki-minimal.yaml` and no
   `--provider`. A trap deletes it on exit, failure, or interrupt. The runner
   refuses to start if a sandbox with that prefix is left over from a previous
   run, listing it for the user instead of deleting it.

3. **Journey-only Maki config.** The runner uploads, into the throwaway
   sandbox's user config, a provider entry pointing at
   `http://127.0.0.1:<p>/v1` with a placeholder key, the mock model id, and
   permission behavior that leaves YOLO off so `can_use_tool` asks reach the
   bridge as they do for a user with default settings. The exact files and
   keys come from the spike (task 1.1). The baked image config is not edited.
   Whether "YOLO off" is the right reference behavior is itself recorded: the
   reference OpenCode asks for permission by default, so the live Maki side
   must too to be comparable.

4. **Same turns, same comparison.** The mock provider entry reuses the
   harness's turn adapter; the journey script is unchanged. Normalization maps
   the live Maki model label to `<MODEL>` via the per-side map. The live
   verdict uses the offline rule (`unreached` → `broken`, unaccepted
   `differs` → `diverges`, else `parity`) and the journey's `acceptedDiffs`.

5. **Evidence shape.** `evidence.live = { snapshots: "<slug>/live/",
   diff: "<slug>/live-diff.json", maki: "0.6.4", image: "<image id>",
   verdict }`. The live Maki-side request log joins the measured route set
   like the offline one. The report shows the live verdict beside the offline
   status; a live verdict worse than the offline status is printed as a
   finding.

6. **Gate.** `make test-journeys-live` skips with a message (exit 0, no file
   change) when `openshell` is missing, `openshell status` fails, or the image
   is absent. It is never part of `make test`; crosscheck re-diffs committed
   live snapshots offline.

## Risks / Trade-offs

- [Maki 0.6.4 cannot use a custom base URL] → stop and report; options for
  the user are an upstream Maki change or an explicit, reviewed egress rule.
- [The minimal policy blocks in-namespace loopback] → same: stop and report
  with the observed denial; never relax the policy inside this change.
- [Turning YOLO off in the journey config diverges from the image's default
  experience] → recorded as the comparability choice in decision 3; the
  journey compares against OpenCode's default, which asks.
- [Sandbox creation is slow] → one sandbox per `make test-journeys-live`
  invocation, reused across its journeys, with Maki sessions reset between
  journeys.
- [A crashed run leaves a sandbox] → exit trap plus the leftover check in
  decision 2.

## Migration Plan

Additive; no existing target or file changes behavior. Rollback is a revert.
