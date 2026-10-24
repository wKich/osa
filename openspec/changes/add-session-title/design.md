# Design

## Pinned rule (`maki-storage/src/sessions.rs` v0.6.4 L672–L695)

`generate_title` takes the first user message's text, trims it, collapses
whitespace runs to one space, and returns it whole when it is at most 60 bytes
(`MAX_TITLE_LEN`, L46). Longer text is cut at the last char boundary at or
below 60 bytes; when that slice has a space past byte 30 it is cut there,
and `…` is appended. An empty first text keeps `New session` (L45).

## Timing

The headless driver saves through `SessionTurn::drop` (L143–L166), so the
title exists once the first run has been recorded. The bridge mirrors that:
the title is set, and `session.renamed` emitted, when the session's first
`result` arrives. Before that the TUI keeps its fallback, as it would over
Maki's own store.

## Why not read the title from the sandbox

The SDK wire carries no title (`sdk_mode.rs` v0.6.4 has no title field; the
headless snapshot leaves `title` nil, `maki-lua/src/session_snapshot.rs`
L24–L27, L133–L153). The rule is deterministic over text the bridge already
holds, so applying it reproduces the stored title without an extra exec.

## Remaining difference

OpenCode's title comes from a model call (the journey mock answers
`Journey`); Maki's comes from the prompt. The difference is correct by design
and stays an accepted difference with that reason.
