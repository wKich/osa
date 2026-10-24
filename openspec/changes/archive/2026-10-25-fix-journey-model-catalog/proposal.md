# Proposal

## Why

Scripting `switch-model` showed that neither side's model dialog listed the
journey's models. The reference listed OpenCode's own free catalog (its
built-in `opencode` provider: Flint 40B Free, Big Pickle, …), which is host
configuration. The offline Maki side listed the scripted sandbox's
`synthetic/…` and `anthropic/…` models, with integrations for keys the live
sandbox never has. Only live, with the journey's `providers.toml`, did Maki
list the journey's model. A model journey needs both sides to offer the same
two scripted models.

## What Changes

- The reference config allows only the journey's `mock` provider
  (`provider.use` policies; config `normalize.ts` v2.0.32 L408–L418) and
  defines a second model, `mock-model-2`.
- The live journey `providers.toml` defines `mock-model-2` too.
- The offline scripted sandbox lists the journey catalog
  (`FAKE_SANDBOX_MODELS`) and reports no provider key (`FAKE_SANDBOX_AUTH=none`),
  as the live sandbox runs with no provider attached; the scripted child
  announces the model it was started with (`mock/mock-model`), as the pinned
  init frame does (sdk_mode.rs v0.6.4 L615–L626).
- Accepted reasons that named the old scripted model id are corrected.

## Capabilities

### Modified Capabilities

- `tui-journey-parity`: the one-script requirement names the journey catalog.

## Impact

`bridge/test/journeys/harness/{record,live-sandbox}.ts`,
`bridge/test/{fake-maki.ts,sandbox-bin/maki,model-catalog.test.ts}`; three
journeys' snapshots (the dialog-occluded label now reads `moc` offline, as it
does live). Every verdict is unchanged, offline and live.
