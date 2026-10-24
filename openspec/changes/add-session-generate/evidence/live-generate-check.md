# Live check: the side question's fork leaves no session behind (2026-10-24)

`evidence/live-generate-check.ts` (run with `bun` from the repository root
against the gateway; it uses the live harness's sandbox, provider, and config
helpers, no provider attached) prompted one turn, asked a side question, and
listed Maki's sessions before and after:

```
before: [{"id":"CgMRaSXnfR1PiJniHTjoc","title":"Reply PONG","cwd":"/sandbox/journey-work","updated_at":1792861443}]
generate: {"data":{"text":"ASIDE"}}
after: [{"id":"CgMRaSXnfR1PiJniHTjoc","title":"Reply PONG","cwd":"/sandbox/journey-work","updated_at":1792861443}]
```

The original session is unchanged (same `updated_at`) and the throwaway fork
was deleted.
