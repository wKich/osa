# Live streaming observation (task 5.3)

- **Date:** 2026-10-23
- **Model spec:** `synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017`
- **Profile:** `maki-synthetic` (already registered; the sandbox receives only
  the opaque stand-in the provider profile substitutes — no credential value is
  named here or anywhere in this file)
- **Image / policy:** `maki-agent:local`, `examples/policies/maki-minimal.yaml`
- **Attempts:** 1 (one session, one turn, no retry)
- **Capture:** `evidence/stream-live.jsonl` (64 lines), copied byte-identical to
  `bridge/test/fixtures/maki-stream-live.jsonl`

## Exact command

```
bridge/test/capture-stream.sh
```

which creates the scratch sandbox and runs, inside it:

```
openshell sandbox exec -n maki-stream-live --no-login-shell --workdir /sandbox -- \
    maki -p --trust --input-format stream-json --output-format stream-json \
    --include-partial-messages -m synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017
```

The sandbox is deleted on exit. No `--env`/`--env-from` value, no new
credential, and no new egress rule were involved: the model spec changed on the
same profile that already carried its single-host egress rule.

## Verdict

The model **does stream**. The capture carries 61 `stream_event` frames: a
`message_start`, thinking and text content blocks, one `content_block_delta` per
chunk, `content_block_stop`, `message_delta`, and `message_stop` — all before
the single buffered `assistant` message, which repeats the same parts.

Each delta is nested: `event.type == "content_block_delta"` with the variant on
`event.delta.type` (`thinking_delta` / `text_delta`) and the payload on
`event.delta.thinking` / `event.delta.text`. That differs from the authored
fixture's flat spelling, and the first replay of this capture through the
shipped translator produced empty `started`/`ended` pairs with no delta frames.
`handleStreamEvent` now accepts both spellings (task 2.2), and replaying this
capture projects 7 reasoning deltas, 47 text deltas, one `started`/`ended` per
part, and `session.text.ended` carrying the full 439-character reply.
