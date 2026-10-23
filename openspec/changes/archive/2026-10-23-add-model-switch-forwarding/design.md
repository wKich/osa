# Design

## Context

Pinned wire, cited before code:

- Maki v0.6.4 `src/sdk_mode.rs` `handle_control_request` (L818–L880): subtype
  `set_model` passes `request.model` to `resolve_set_model` (L883–L906). `null`
  restores the startup model; a string goes through `resolve_model_spec`
  (L908–L916: kept as-is when it contains `/`, `claude-*` gains `anthropic/`),
  then the model policy and `Model::from_spec`. Success sends the model to the
  running session (`model_tx`) and acks `success`; otherwise the ack is `error`
  with `"invalid or disallowed model"`. Later `assistant` frames carry the new
  model (`AssistantMessage.model`).
- OpenCode v2.0.32 vendored OpenAPI: `POST /api/session/{sessionID}/model`
  takes `{model: Model.Ref}` and answers `204`, `400`, or `404`. The measured
  TUI posts its synthesized default (`sample/sample`) and later the announced
  model.

## Goals / Non-Goals

**Goals**
- Switch the child's model when the TUI selects a different one.
- Report a model only after the child accepted it.

**Non-Goals**
- Changing the boot-time model list (`GET /api/model`).
- Agent selection: the pin has no `set_agent` (`agent-switch-state` stays
  pin-blocked).

## Decisions

1. **The ack decides.** The route answers `204` at once (the switch applies to
   later turns), and the reported model moves only on a `success` ack.
   Answering before the ack keeps the route fast; claiming before the ack would
   report a model Maki may refuse.
2. **Skip no-op selections.** The TUI re-posts what it shows (boot default,
   then the announced model). Equal to the reported model means no switch, so
   nothing is sent, and the boot default never races the child's startup.
3. **`maki` provider ↔ bare id.** `parseModel` labels a slash-less announced id
   with provider `maki`; the reverse mapping sends the bare id back, so
   `resolve_model_spec` sees what Maki announced.
4. **One control-request registry per session.** `controls` maps the bridge's
   `request_id` to an ack handler; interrupt acks go through it as no-ops.
   Maki's own asks use `req_<n>` ids and never collide with `bridge_<subtype>_<n>`.
5. **`400` for a selection without a provider and model.** The pinned route
   defines `400`; silently storing half a model would make the next comparison
   meaningless.

## Risks / Trade-offs

- [A refused selection leaves the TUI showing its own pick until it re-reads]
  → The session object keeps the true model, and the next `model.updated`
  or session read corrects the display. Refusals are logged.
- [The scripted child's provider allowlist is a stand-in for Maki's policy] →
  The tests assert the bridge's side (frames sent, ack handling), not Maki's
  resolution.
