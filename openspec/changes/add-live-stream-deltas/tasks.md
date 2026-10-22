# Tasks

## 1. Gate: confirm the flag exists at the pin

- [x] 1.1 Run the installed `maki --help` (and the pinned `sdk_mode.rs` field
      it maps to) to confirm the partial-message flag's exact spelling, and
      verify no "ignored flag" warning appears when it is passed —
      `cli.warn_ignored_flags()` warns and drops an unknown flag rather than
      failing; if it is dropped, record that and stop rather than editing
      `SDK_FLAGS`

## 2. Ask the child for partial output

- [x] 2.1 Add the partial-message flag to `SDK_FLAGS` in
      `bridge/src/maki.ts`, and verify the diff to `bridge/src` is exactly that
      one line with no other source touched
- [x] 2.2 Accept the captured envelope in `handleStreamEvent` in
      `bridge/src/translator.ts`: a `content_block_delta` frame takes its
      variant from `event.delta.type` and its payload from the nested `delta`,
      while the authored flat spelling still renders — added after the live
      observation showed the flag alone empties streamed parts — and verify
      replaying `evidence/stream-live.jsonl` emits text and reasoning delta
      frames plus `ended` frames carrying the full text

## 3. Prove the argv and the stream

- [x] 3.1 Add a `childArgv` assertion covering every flag the spec's
      "Exec carries no environment values" scenario names, now including the
      partial-message flag, plus the absence of any `--env` value, and verify
      `cd bridge && bun test` is green
- [x] 3.2 Add the `FAKE_MAKI_STREAM=1` knob to
      `bridge/test/fake-maki.ts` so the scripted child emits `stream_event`
      frames in the captured spelling before its buffered `assistant` frame
      only when asked, with a one-line comment saying why the knob exists, and
      verify the existing suite still passes with no fixture or golden change
      (the knob must not alter any current test's frames)
- [x] 3.3 Add a bridge-level test that runs a session with the knob set and
      asserts the SSE stream carries `session.text.delta` frames before the
      buffered message with no duplicate parts, and verify it goes red when
      the flag is removed from `SDK_FLAGS` and green when it is restored

## 4. Record

- [x] 4.1 Update the `stream-deltas` row's note in
      `bridge/compat/statuses.json` to say the request is now passed, the
      shipped-bridge test proves deltas reach the stream, and observation by a
      real streaming model is still missing — keeping the status `degraded` —
      and verify `bun scripts/gen-compat.ts --check` passes
- [x] 4.2 Regenerate the report with `bun scripts/gen-compat.ts` and verify
      `make compat` exits 0 with `docs/compatibility.md` showing the updated
      note and no other row changed
- [x] 4.3 Add a wrap-up note naming the dated archive path each evidence file
      must be rewritten to at archive time, and verify it covers every row
      whose evidence points into this change dir

## 5. Observe it live

- [x] 5.1 Run one gated Maki session in the sandbox with the SDK flags this
      change passes and `-m synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017`
      on the already-registered `maki-synthetic` profile, capturing stdout to
      `evidence/stream-live.jsonl`, and verify the run skips with an explicit
      message when the gateway, image, or `openshell` is absent — no new
      credential and no new egress rule may be created for this task
- [x] 5.2 Check the capture for `stream_event` frames: if deltas are present,
      flip `stream-deltas` to `verified` with the capture as evidence, commit
      the capture as `bridge/test/fixtures/maki-stream-live.jsonl` with a
      provenance entry and a golden, and regenerate its golden input where the
      shapes differ from the authored fixture; if the model does not stream,
      keep `degraded` and write the narrower claim — this model does not
      stream — into the row's note
- [x] 5.3 Record the observation in `evidence/stream-note.md` with the exact
      command, model spec, attempt count, and verdict, and verify it names no
      credential value or stand-in spelling

## 6. Verify

- [x] 6.1 Run `make test`, `make test-bridge`, `make compat`, `make lint`,
      and `openspec validate "add-live-stream-deltas"` in one pass, and verify
      all exit 0
- [x] 6.2 Verify the report's route lens is unchanged from the previous
      change, so this change touched only the `stream-deltas` row
- [x] 6.3 Add a wrap-up note naming the dated archive path each evidence file
      must be rewritten to at archive time, and verify it covers every row
      whose evidence points into this change dir
