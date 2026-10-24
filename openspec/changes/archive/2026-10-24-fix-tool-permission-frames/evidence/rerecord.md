# Re-record after the fix (2026-10-24)

`allow-permission-once`, offline (`make test-journeys` path, run twice,
byte-identical) and live (`bun bridge/test/journeys/harness/live.ts
allow-permission-once`, OpenShell 0.1.5, Maki 0.6.4, image `maki-agent:local`).

| Checkpoint | Before | After (offline) | After (live) |
| --- | --- | --- | --- |
| `permission-prompt` | dialog body `⚙ Call tool allow` / `Tool: allow` | body `$ rm -f probe.txt`, the reference's; only the tab title differs | same as offline |
| `allowed` | offline: title + `(no output)` vs blank; live: **unreached** (spinner never settled) | title, unread marker, `(no output)` vs `Exit code: 0` | reached; title, unread marker, `error: Permission denied (os error 13)`, token counter `4` vs `2` |

Hand-offs still open (not this change): session title and unread marker
(session state capabilities), the `/dev/null` policy denial
(`minimal-policy-denies-dev-null`), and the live token counter.
