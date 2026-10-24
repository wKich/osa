# Proposal

## Why

`mention-skill-in-prompt` broke on the Maki side: after a turn wrote a
project skill, `/skills` still said "No skills available" — the TUI caches
the skill list until `skill.updated` (client `solid/data.ts` v2.0.32
L1269–L1272), which the bridge never sent — and a selected skill was
dropped from the prompt, so neither the transcript's ` skill  journey-greet`
row nor the skill's instructions reached Maki. The list also left out the
skill Maki itself always offers, `maki-plugin-dev`.

## What Changes

- After each turn the bridge re-reads the sandbox's skills and emits
  `skill.updated` when the set changed since the TUI last read it. Maki's
  skill tool rediscovers skills on every call (`plugins/skill/init.lua`
  v0.6.4 L163), so a new skill is usable at once.
- `/api/skill` lists the plugin's builtin `maki-plugin-dev` first
  (init.lua L98–L108; name and description per maki-lua `docs_render.rs`
  L17–L18) at `/builtin/maki-plugin-dev`, as OpenCode lists its builtins
  (core `plugin/skill.ts` v2.0.32 L33, L42).
- A prompt's `skills[]` are delivered: a sandbox skill as OpenCode's
  `<skill_content>` text with up to ten sibling files (core `skill.ts`
  v2.0.32 L36–L68), as a text block on the child's `user` frame; the builtin
  without text (its body lives in the Maki binary; the `@maki-plugin-dev`
  mention names it to Maki's skill tool); an unknown id is dropped.
- Session export redacts file, agent and skill mentions and skill text as
  the pinned transfer does (core `session/transfer.ts` v2.0.32 L215–L240).

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the skill-mention requirement.

## Impact

`bridge/src/{bridge,mentions,sandbox,history,translator}.ts`, tests,
statuses, journeys. Every read is a `sandbox exec` with no `--env` value.
