# Proposal

## Why

`add-journey-harness` compares real OpenCode with the bridge driven by the
scripted `fake-maki.ts`. That proves the bridge's translation and rendering,
but not that the real Maki 0.6.4 binary, inside a real OpenShell sandbox,
produces the same journey: the fake child's wire frames are written from our
reading of the pin. A journey is only native if the live stack — TUI → bridge
→ `openshell sandbox exec` → real Maki — matches the reference too.

The live run must not weaken the security model to get there. A sandbox has
its own network namespace, so the host's loopback (where the harness's mock
provider runs) is unreachable from inside, and egress is deny-by-default.

## What Changes

- `make test-journeys-live`: for every journey with a script, run the same
  script against the TUI + bridge + real Maki in a throwaway OpenShell
  sandbox, render and normalize the screens with the harness, and compare them
  with the journey's committed reference snapshots. Gated: it skips cleanly
  without `openshell`, a reachable gateway, or the `maki-agent:local` image.
- The scripted model provider runs **inside the sandbox**, on the sandbox's
  own loopback, and Maki is pointed at it there. No network rule, provider
  profile, or credential is added, and the host's loopback stays unreachable.
- The run uses a dedicated, short-lived sandbox (`maki-oss-journeys-<run id>`)
  created from the project image with the minimal policy and no providers
  attached, deleted afterwards whether the run passes or fails. The user's
  project sandbox is never used.
- Each journey row gains a `live` evidence entry: the live Maki-side
  snapshots, the comparison, the Maki and image versions, and a verdict
  (`parity`, `diverges`, `broken`) computed with the same rule as the offline
  comparison. A live verdict worse than the offline status is a finding for
  the journey loop.
- The offline crosscheck re-compares committed live snapshots and asserts the
  committed live verdict, so live evidence stays reproducible without a
  gateway.
- Pilot: the three journeys recorded by `add-journey-harness` are run live and
  their live evidence committed.

If the spike (task 1.1) finds that Maki 0.6.4 cannot target an in-sandbox
OpenAI-compatible endpoint, or that the policy blocks in-namespace loopback,
the change stops and reports instead of adding an egress rule: opening egress
to the host is a security decision for the user, not an implementation
detail.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `tui-journey-parity`: adds the gated live comparison against real Maki in
  a throwaway sandbox, its isolation rules, and live evidence on journey rows.

## Impact

- Harness: a live runner under `bridge/test/journeys/harness/` reusing the
  driver, renderer, normalizer, and diff; the mock provider gains a
  standalone entry that runs under the image's Bun.
- `Makefile` (`test-journeys-live`), `bridge/test/crosscheck.test.ts`,
  `scripts/gen-compat.ts` (live verdict column), `bridge/compat/journeys.json`
  (pilot live evidence), regenerated `docs/compatibility.md`.
- A journey-only Maki config (provider pointing at the in-sandbox endpoint,
  model id, permission behavior) uploaded into the throwaway sandbox; the
  baked image config in `examples/maki-image/config/` is unchanged.
- Security surface: none widened. No new policy rule, profile, credential,
  bind mount, or `--env` secret; the sandbox runs as the non-root image user.
  The run needs a working OpenShell gateway and image on the host.
