# Live evidence — follow-ups land as merge requests (2026-10-23)

Dev stand: kiss local stack (marker branch), channel `kiss-local-test` marked
`executor: oskhs`, oskhs worker on the local gateway, real Mattermost
messages sent by a human in the channel (no simulated task documents).

## Before the change

- Task `b268bef9` (question, oskhs): answered, `completed`.
- Follow-up `10ca60e0` "сохрани роадмэп в файл": Maki wrote the file and
  replied "saved", but the round was read-only — the file was discarded
  (the bug this change fixes).

## Follow-up code round, first try

- Sub-task `3db52a62`: Maki wrote the file, oskhs collected it and pushed
  `docs/browser-multiplayer-roadmap` (`cfa5babc`, visible on GitLab
  seconds later), then MR creation got `400 {"source_branch":["does not
  exist"]}` — GitLab's late branch visibility. Sub-task `error`, kiss posted
  the error. Fixed by kiss's MR-create retry (5/10/20/40/45 s).

## Follow-up code round, after the retry fix

- Sub-task `d29bb7f6`: `completed`; reply ends with
  `Commit [08d34c04](…/ascii-minecraft-mimo-2.6-pro/-/commit/08d34c04…)`.
- oskhs log: `MR !2 for dmitry.lazarev/ascii-minecraft-mimo-2.6-pro
  (docs/roadmap-browser-multiplayer-estimates → master)`.
- Task `b268bef9`: `state: review`, `replyMessage: null`, repository entry
  `mrIid: 2`, `mrUrl: …/merge_requests/2`, `branchName:
  docs/roadmap-browser-multiplayer-estimates`.
- kiss orchestrator: `Subtask d29bb7f6: reply posted and marked as
  replied`, then `Task b268bef9: review MR link(s) posted`.

## Also observed

- A message sent within ~60 s of marking the channel went to KHS
  (`aac9e519`, `executor: null`): kiss's ProjectService refreshes its
  channel cache every 60 s (last refresh 04:05:19, mark ~04:05:47, message
  04:06:13, next refresh 04:06:19). Not a routing bug; B1.5's runbook must
  wait a refresh after marking or unmarking.
