# Proposal

## Why

Discovery pass 6 linked `GET /api/skill` to `skill-list-live`. The route
listed a phantom `sample` skill under `@skill` and `/skills`. Maki's skill
plugin discovers real skills in the sandbox and offers them to the model
through its `skill` tool, including in SDK mode, but no wire frame carries
them.

## What Changes

- `readSkills` (`bridge/src/sandbox.ts`) runs the plugin's scan in one
  sandbox exec and parses the frontmatter the plugin reads.
- `GET /api/skill` answers that list.
- The scripted openshell runs with a logical `PWD`, so paths match the
  configured workdir.
- `bridge/test/skill-list.test.ts` covers it. `skill-list-live` becomes
  `verified` and the route `served-live`.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the requirement "List the skills the Maki child
  discovers".

## Impact

`bridge/src/sandbox.ts`, `bridge/src/bridge.ts`, the scripted openshell, a new
test, statuses and the report.
