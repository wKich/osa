# Re-record (2026-10-24)

Offline (twice, byte-identical) and live (`bun bridge/test/journeys/harness/live.ts`,
Maki 0.6.4, OpenShell 0.1.5):

| Journey | Checkpoint | Maki tab / list title now |
| --- | --- | --- |
| `send-prompt-stream-reply` | `streamed` | `Reply with the word PONG only.` (was `New session`) |
| `resume-session-history` | `session-list` | `Reply with the word ALPHA only.` (was `New session - <TIME>`) |
| `allow-permission-once` | `allowed` | `Use your shell tool to run exactly: rm -f probe.txt . Then…` |

The `send-prompt-stream-reply` acceptance is withdrawn: its reason was wrong
(Maki does title sessions) and the accepted `streamed` checkpoint also hid the
reference's unread marker `•` (`tui/src/component/session-tabs.tsx` v2.0.32
L67–L72), which the bridge does not produce because sessions carry no
`time.idle`. The journey is `diverges` until the idle-state capability lands;
the title difference is then accepted with the true reason.

Live-only finding: `resume-session-history` live shows `MCP server failed:
synthetic` and `2 MCP failed`. The bridge reads the image's baked
`/sandbox/.config/maki/mcp.toml` (context7, synthetic), which fail with no
provider; the reference config declares no MCP server. Before
`fix-minimal-policy-dev-null` the bridge's `2>/dev/null` reads failed, so this
was hidden. Hand-off: the live journey config must declare the reference's MCP
set (none) — a harness change.
