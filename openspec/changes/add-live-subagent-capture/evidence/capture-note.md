# Capture note (tasks 4.1, 4.3)

One live Maki subagent turn, captured 2026-10-23 from this host. The committed
fixture is `bridge/test/fixtures/maki-subagent-live.jsonl`, produced by
`bridge/test/capture-subagent.sh`.

## Run

- Sandbox: `maki-sub-live`, created from `maki-agent:local` with
  `examples/policies/maki-minimal.yaml` and the `maki-synthetic` provider
  profile attached; deleted by the script's exit trap (verified: `openshell
  sandbox list` reports no sandboxes).
- Maki: 0.6.4, pinned in the image (`maki --version`).
- Model: `synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017`.
- Command (the `--env` flag is absent, so the sandbox receives no value):

  ```sh
  openshell sandbox exec -n maki-sub-live --no-login-shell --workdir /sandbox -- \
    maki -p --trust --input-format stream-json --output-format stream-json \
    --append-system-prompt "You must use the task tool to delegate this request to a subagent before answering." \
    -m synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017
  ```

- Input: one `user` line on stdin, asking the model to delegate to a subagent
  that runs `echo subagent-live-marker` with its bash tool and reports the
  output. stdin stayed open until the terminal `result` frame.
- Turn: 13.4 s, 2 turns; `system` init, `Task` call, flagged subagent `Bash`
  call and `tool_result`, flagged subagent text, parent `tool_result`, parent
  text, `result`. The init frame records `apiKeySource: "none"`.

## Flag decision (task 1.2)

`--append-system-prompt` is accepted by the pinned binary in SDK mode:
`maki --help` lists it, and three live runs used it with **empty stderr** — no
`warn_ignored_flags()` warning appeared. The instruction therefore stayed in
the appended system prompt; the prompt-text fallback was not needed.

## Attempts (task 1.3)

Three live turns, all with `parent_tool_use_id` present:

1. Gate attempt 1: asked the subagent to answer `PANGOLIN`; one flagged
   `assistant` text frame, no subagent tool call.
2. Gate attempt 2: asked the subagent to run a bash command; flagged
   `assistant` tool_use, flagged `user` tool_result, flagged `assistant` text.
   This is the shape the authored fixture pins, so the gate passed here.
3. The script's run (above) reproduced attempt 2's shape and is the committed
   fixture.

## Security invariants held (task 2.3)

- No `maki auth login`; no base-URL override was set inside the sandbox.
- No `--env` / `--env-from` in the create or exec invocation; the profile
  binding is the only credential path, and the sandbox saw the opaque
  stand-in (`apiKeySource: "none"`).
- Non-root sandbox user from the image; no bind mount; egress unchanged
  (`maki-synthetic`'s existing rule only).
- Sandbox deleted; no host path in the capture (`cwd` is `/sandbox`).

## Deferred findings (task 4.3)

### 1. The shipped child invocation can never emit `stream_event`

`bridge/src/maki.ts` passes `maki -p --input-format stream-json
--output-format stream-json`, and pinned `sdk_mode.rs` gates every
`stream_event` frame behind `--include-partial-messages`. The `stream-deltas`
path therefore cannot occur through the bridge as shipped.

**Cost:** the bridge's delta path is exercised only by the authored
`maki-stream.jsonl` fixture, and the `stream-deltas` row stays `degraded`
until either the flag is added (a production behavior change with its own spec
delta and risk review) or a capture names another provider. Recorded as
out of scope in `proposal.md`; `add-live-stream-deltas` owns it.

### 2. The synthetic model used here does not stream

The archived `e2e-note.md` already recorded this, and this change saw the same
behavior: the run emits whole frames, no `stream_event`. That is a property of
the model, not of the provider or the network.

**Cost:** the one remaining path to a streaming capture is a different `-m`
spec on the already-registered `maki-synthetic` profile — no new credential,
no new egress rule, but a provider choice this change deliberately leaves to
the user. Until then the streaming observation has no live evidence.
