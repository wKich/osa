# Tasks

## 1. Preconditions and the provocation gate

- [ ] 1.1 Verify the capture preconditions in one read-only pass — `openshell
      gateway list` shows the connected gateway, `openshell provider list`
      shows `maki-synthetic` with its credential key, `docker images` shows
      `maki-agent:local` — and verify no sandbox is left running afterward;
      if any is missing, stop and report rather than creating it
- [ ] 1.2 Confirm at the pinned binary that `--append-system-prompt` is
      accepted in SDK mode by running it and capturing stderr, and verify no
      "ignored flag" warning appears (`cli.warn_ignored_flags()` in pinned
      `sdk_mode.rs`); if it is ignored, plan the instruction into the prompt
      text instead and record that in the capture note
- [ ] 1.3 **Gate:** attempt the subagent turn with
      `-m synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017` on
      `maki-synthetic` using a bounded number of tries, and verify at least
      one captured run contains `parent_tool_use_id`; if none does, stop here
      and ask which model to use — another model on the same registered
      profile needs only a different `-m` spec, no new credential and no new
      egress rule, and this change does not pick one

## 2. Capture

- [ ] 2.1 Write `bridge/test/capture-subagent.sh` — creates a scratch sandbox,
      runs the pinned Maki inside it over stdio with the subagent instruction
      and `-m synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017`, tees stdout
      to the output path, deletes the sandbox — and verify it skips
      with an explicit message when `openshell`, `bun`, or the image is absent,
      and that it passes no `--env` value
- [ ] 2.2 Run the script to produce
      `bridge/test/fixtures/maki-subagent-live.jsonl`, and verify the file
      holds a complete turn: `system init`, flagged `assistant`/`user` frames,
      and a terminal `result`
- [ ] 2.3 Verify the security invariants held for the run: the sandbox is
      deleted, no `maki auth login` was run, no credential env var was set
      inside the sandbox, and the invocation carried no `--env` value

## 3. Records

- [ ] 3.1 Add `maki-subagent-live.jsonl` to `provenance.json` with
      `kind: captured` naming the script and the pinned Maki version, and
      verify `cd bridge && bun test crosscheck.test.ts` is green
- [ ] 3.2 Add the live fixture to `FIXTURES` in `bridge/test/golden.test.ts`
      with `UPDATE_GOLDENS=1 bun test` to mint its golden, review the produced
      golden by eye, and verify `cd bridge && bun test` is green
- [ ] 3.3 Compare the live capture against the authored fixture's shape and
      record the verdict in `evidence/shape-comparison.md`; on agreement,
      remove `caveat` from the `subagent-nesting` row and verify
      `bun scripts/gen-compat.ts --check` passes with `make compat` green; on
      disagreement, keep `caveat`, regenerate the authored golden from the
      observed shape, and verify the difference is written up as a finding

## 4. Evidence

- [ ] 4.1 Write `evidence/capture-note.md` recording how the run was taken
      (command, model, sandbox name, flag decision from task 1.2, attempt
      count), and verify it names no credential value or stand-in spelling
- [ ] 4.2 Run the archived redaction scan's two greps — value-shaped
      credential patterns and authorization/api-key key names — over the new
      fixture and this change's `evidence/`, commit the result as
      `evidence/redaction-scan.md`, and verify both scans report no matches
- [ ] 4.3 Record the two deferred findings in `evidence/capture-note.md` —
      the shipped child invocation never passes `--include-partial-messages`
      so `stream_event` cannot occur through the bridge, and the synthetic
      model never streams so a streaming capture needs another provider — and
      verify each states its cost rather than leaving it implied

## 5. Verify

- [ ] 5.1 Run `make test`, `make test-bridge`, `make compat`, `make lint`,
      and `openspec validate "add-live-subagent-capture"` in one pass, and
      verify all exit 0
- [ ] 5.2 Verify `git diff --stat bridge/src` is empty, and verify the only
      `statuses.json` change is the `subagent-nesting` caveat field
- [ ] 5.3 Add a wrap-up note naming the dated archive path each evidence file
      must be rewritten to at archive time, and verify it covers every row
      whose evidence points into this change dir, so `crosscheck.test.ts`
      stays green after the archive commit
