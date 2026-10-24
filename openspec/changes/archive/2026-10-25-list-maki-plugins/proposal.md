# Proposal

## Why

`manage-plugins` (`/plugins`, then `ctrl+a` for internal plugins) showed the
reference's Server section, its own builtin plugins, and nothing on the
Maki side: the bridge answered `GET /api/plugin` with an empty list. The
server's counterpart is Maki's plugins: the Lua builtins v0.6.4 loads by
default (`maki-config/src/lib.rs` L94–L122).

## What Changes

- `/api/plugin` lists those builtins as active `builtin` plugins with the
  server feature, which the TUI files as internal server plugins
  (`feature-plugins/system/plugins.tsx` v2.0.32 L67–L72).
- Feature `plugin-list`. `manage-plugins`: recorded, `parity` offline and
  live.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the plugin-list requirement.

## Impact

`bridge/src/spec-answers.ts`, `bridge/test/boot-surface.test.ts`, catalog
rows. The pinned SDK reports no plugin list, so a configuration that
disables a builtin or adds a package is not reflected.
