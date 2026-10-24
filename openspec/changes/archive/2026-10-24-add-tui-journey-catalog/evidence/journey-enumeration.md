# Journey enumeration: OpenCode TUI at v2.0.32

Read-only pass on 2026-10-24 against `anomalyco/opencode` at tag `v2.0.32`
(commit `843a6c514e606b436a7fe713422ace0a93ad3d61`), checked out shallow and
sparse into a scratch directory. The pass followed
`.claude/skills/discovering-tui-journeys/SKILL.md`: enumerate from the pinned
source, seed every row `unrecorded`, and use captures only to check the linked
route set.

## Source files read

| File | Used for |
| --- | --- |
| `packages/tui/src/config/keybind.ts` | every `Definitions` keybind, its default, and its description |
| `packages/tui/src/app.tsx` | `appCommands` and every slash command/alias |
| `packages/tui/src/routes/session/index.tsx` | `baseCommands`: rename, timeline, fork, compact, undo, redo, copy, export, background, queued, parent |
| `packages/tui/src/routes/session/permission.tsx` | permission prompt stages and answers |
| `packages/tui/src/routes/session/form.tsx` | MCP form answers |
| `packages/tui/src/routes/session/composer/index.tsx` | composer tabs (subagents, shell, terminals) |
| `packages/tui/src/routes/session/composer/shell-tab.tsx` | shell list and output action |
| `packages/tui/src/component/prompt/index.tsx` | `/cd`, `/editor`, `/skills`, `/worktrees`, image paste, queue |
| `packages/tui/src/component/prompt/autocomplete.tsx` | `@` file mentions |
| `packages/tui/src/component/command-palette.tsx` | palette command list |
| `packages/tui/src/component/session-frame.tsx` | `/terminal` and pane commands |
| `packages/tui/src/component/session-tabs.tsx` | tab actions (select, close, reopen, rename) |
| `packages/tui/src/component/dialog-*.tsx` | every dialog header and action: agent, config, debug, error details, experiments, highlights, image preview, integration, MCP, model, open, pair, session list, session rename, shell output, skill, stash, status, theme list, update, variant, workspace file changes, workspaces, worktree name |
| `packages/tui/src/feature-plugins/system/diff-viewer.tsx` | `/diff` and its keybinds |
| `packages/tui/src/feature-plugins/system/stats.tsx` | `/stats` |
| `packages/tui/src/feature-plugins/system/plugins.tsx` | `/plugins` |
| `packages/tui/src/feature-plugins/prompt/btw.tsx` | `/btw` side question |
| `packages/tui/src/context/keymap.tsx` | how `slash` entries become commands |

## Grouping decisions

One row per user intent, not per keybind. The pass collapsed mechanics into
the journey that contains them:

- `session.tab.select.*`, `session.tab.next/previous`, and
  `session.quick_switch.*` are one row, `switch-session-tab`.
- `messages.copy`, `session.copy.id`, and `session.copy` are one row,
  `copy-session-content`.
- `session.verbosity.cycle`, `session.toggle.thinking`, and
  `session.toggle.exploration_grouping` are one row,
  `adjust-transcript-display`.
- The model dialog, recent-model cycling, and favorite toggles are one row,
  `switch-model`; the variant cycle is its own row.
- Pure input editing (`input.*`), dialog navigation (`dialog.select.*`),
  transcript scrolling (`session.page.*`, `session.line.*`), which-key
  (`which-key.*`), and deprecated diff tree navigation are mechanics of a
  journey, not journeys, so they have no row.
- Slash aliases (`/resume` = `/sessions`, `/projects` = `/open`) are not
  separate rows.

## Result

59 journeys: 53 reachable, 6 out-of-scope, all `unrecorded`. By area:
navigation 13, session 24, prompt 6, permission 4, model 3, tools 2, files 2,
config 5.

Out-of-scope rows and their reasons:

| Slug | Reason |
| --- | --- |
| `open-documentation` | the OpenCode docs site needs a host browser and egress |
| `pair-device` | pairing goes through the OpenCode web/cloud service |
| `connect-integration` | credentials are bound outside the sandbox through OpenShell provider profiles |
| `update-opencode` | self-update comes from the OpenCode release service; the image is pinned |
| `restart-service` | the OpenShell sandbox owns the service lifecycle |
| `view-release-highlights` | OpenCode release content has no Maki counterpart feed |

**Design correction.** The design's third pressure scenario assumes session
sharing is a journey that should be `out-of-scope`. At v2.0.32 the surface is
removed: `packages/tui/src/config/keybind.ts:126-127` marks
`session.share`/`session.unshare` as `"Deprecated: session sharing was
removed"`. The spec forbids naming a journey the pin does not offer, so no
sharing row exists. A later artifact update should replace that example with a
surface that still exists at the pin (pairing, integration connect, update,
restart).

## Seed cross-check

Run after the rows were written:

```
$ bun -e '…'   # tally: measured routes vs journey-linked routes, out-of-scope reasons
{
  "journeys": 59,
  "reachable": 53,
  "outOfScope": 6,
  "measuredRoutes": 28,
  "linkedRoutes": 70,
  "measuredUnlinked": [],
  "outOfScopeWithoutReason": [],
  "unknownLinkedRoutes": []
}
```

Every route measured in `bridge/test/captures/tui-last-requests.jsonl` and
`bridge/test/fixtures/bridge-requests.jsonl` is linked from at least one
journey (28 of 28); every out-of-scope row has a reason; every linked route
name exists in `statuses.json`.

## Gates

```
$ bun scripts/gen-compat.ts && bun scripts/gen-compat.ts --check
gen-compat: docs/compatibility.md matches the regenerated report
$ cd bridge && bun test
112 pass, 0 fail
```
