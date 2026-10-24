# Re-record (2026-10-24)

Offline twice and live twice (Maki 0.6.4, OpenShell 0.1.5), byte-identical:
`send-prompt-stream-reply` and `allow-permission-once` are `parity` offline and
live; each remaining checkpoint difference is accepted with its reason in
`bridge/compat/journeys.json`. Before the settle step the unread marker
compared timing (reference captured before its view round trip, Maki after).
`resume-session-history` stays `broken` (`history-visible` unreached).
