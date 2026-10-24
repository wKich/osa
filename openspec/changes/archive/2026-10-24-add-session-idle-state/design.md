# Design

1. **Where idle is set.** In the bridge's single `emit`, before the frame is
   recorded and fanned out: the TUI re-reads the session when it sees a
   terminal frame (`client/src/solid/data.ts` v2.0.32 L1068–L1106), so the
   read must already carry the new `time.idle`. The value is the frame's own
   `created`, advanced to `previous + 1` when two transitions share a
   millisecond, as the projector does (L433).
2. **View semantics** copy `Session.view` (`core/src/session/session.ts`
   L61–L70) and the monotone projection (`projector.ts` L601–L611).
3. **Settled checkpoints.** Both TUIs show `•` for the moment between the
   terminal frame and the view round trip, then fade it
   (`session-tabs.tsx` `fading()`). A script-level
   `waitFor(/^[\s\S]*$/, { idleMs: 1500 })` before a post-turn checkpoint
   captures the settled screen on both sides; it uses the existing script API,
   so the archived harness is unchanged.
4. **Accepted differences** (each the only difference left at its
   checkpoint): the tab title is Maki's own (`generate_title`) where the
   reference shows the mock model's title; mid-run Maki has no title yet; a
   silent command shows Maki's bash result `Exit code: 0` where OpenCode
   prints `(no output)`.
