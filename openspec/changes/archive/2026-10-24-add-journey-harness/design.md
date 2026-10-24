# Design

## Context

See proposal.md — Why. Facts the design rests on:

- Bun 1.4.2 is installed and `Bun.spawn(..., { terminal: { cols, rows,
  data } })` allocates a real PTY (checked: `tty` reports `/dev/ttys…`,
  `stty size` reports the requested size). No native `node-pty` build and no
  `tmux` are needed.
- `opencode` v2.0.32 is installed at `~/.bun/bin/opencode`.
- The pinned OpenAPI `Config.ProviderEncoded` takes `package`, `settings`
  (open-ended), `headers`, and `models`, so a custom provider is configured
  through an AI SDK package plus settings. The exact key for the base URL and
  whether OpenCode installs the package over the network at first use are not
  established yet (task 1.1).
- `bridge/test/fake-maki.ts` picks its behavior from the prompt text (`rm` →
  permission ask) and env flags; it has no notion of a scripted sequence of
  turns.
- `bridge/test/tui-discovery.sh` shows the TUI's input quirks: a prompt must
  be written as one fused write (text + CR), and stale XDG state blocks the
  composer.

## Goals / Non-Goals

**Goals:**
- One script per journey drives both sides identically.
- Deterministic, credential-free reference runs of real OpenCode.
- Text snapshots a reviewer can read in a diff, and a comparison whose verdict
  the offline suite can reproduce from committed files.
- Three pilots recorded end to end, one of them expected to diverge.

**Non-Goals:**
- The live run against real Maki in the sandbox and its policy rule
  (`add-journey-live-run`).
- Fixing whatever the pilots reveal; `resume-session-history`'s gap goes to
  the journey loop.
- Scripts for the other 50 reachable journeys.

## Decisions

1. **Layout.**

   ```
   bridge/test/journeys/
     harness/            driver.ts  render.ts  normalize.ts  diff.ts
                         mock-provider.ts  record.ts (entry for make test-journeys)
     <slug>/
       script.ts         steps, waits, checkpoints, turns
       reference/<checkpoint>.txt
       maki/<checkpoint>.txt
       maki-requests.jsonl
       diff.json         per checkpoint: equal | differs (+ unified hunk) | unreached
   ```

   Catalog evidence points at `<slug>/reference/`, `<slug>/maki/`, and
   `<slug>/diff.json`, which satisfies the existing crosscheck evidence rules.

2. **Script shape.** A typed default export:

   ```ts
   export default journey("send-prompt-stream-reply", {
     turns: [{ text: "PONG", stream: ["PO", "NG"] }],
     steps: [
       waitFor(/Ask anything|>/),           // composer ready
       type("Reply with the word PONG only.\r"),
       checkpoint("user-message", waitFor(/Reply with the word PONG/)),
       checkpoint("streamed", waitFor(/PONG/, { idleMs: 500 })),
     ],
   });
   ```

   `type` sends one fused write (the measured TUI quirk). `waitFor` polls the
   rendered screen, optionally until it has been idle for `idleMs`, and fails
   after a bounded timeout (default 20 s). `turns` is side-neutral: a text
   reply (optionally streamed in deltas) or a tool call (`bash` with a command
   and whether it needs permission). `restart()` swaps the TUI in place: the
   reference restarts its private server with the persisted session store, and
   the Maki side restarts the TUI against the same bridge. A cold client is
   what makes a reopened session fetch its history; the pin marks a locally
   created session's message sync complete and would otherwise render from the
   live cache.

3. **Turn adapters.** The mock provider serves the turns as OpenAI-compatible
   chat-completion streams (text deltas, `tool_calls`, a final chunk with
   `finish_reason`), one turn per request in order. `fake-maki.ts` gains a
   `FAKE_MAKI_SCRIPT=<json>` mode that emits the same turns as Maki wire
   frames (`stream_event` deltas, `tool_use` with `can_use_tool` when the turn
   needs permission, `result`), reusing its existing frame builders. Keeping
   the turn list side-neutral is what makes the two runs comparable.

4. **Reference isolation.** Each reference run gets fresh
   `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`,
   `HOME`, and workdir under the scratch area; an `opencode.json` there names
   only the mock provider on `127.0.0.1:<port>` with a placeholder key, and the
   environment is cleared of provider variables (`*_API_KEY`, `OPENCODE_*`).
   If the provider package must be fetched (task 1.1), it is pre-installed
   into the run's cache from the bridge's own `node_modules` rather than
   downloaded per run.

5. **Rendering.** `@xterm/headless` consumes the PTY byte stream at the
   requested size (120×40, both sides). A snapshot is the visible buffer as
   plain text, trailing spaces trimmed. Colors and styles are dropped in this
   change; a later change may add an attribute layer if color-only
   differences matter.

6. **Normalization**, applied identically to both sides, in order: OpenCode id
   patterns (`ses_`, `msg_`, `per_`, `evt_`, `prt_` + suffix) → `<ID>`; clock
   times and dates → `<TIME>`; durations (`1.2s`, `350ms`) → `<DUR>`; ports
   → `<PORT>`; the run's temporary paths → `<WORKDIR>`/`<HOME>`; provider and
   model labels from a per-side map (mock provider/model names on the
   reference side, Maki's announced model on the Maki side) → `<MODEL>`; token
   and cost counters → `<N>`. Rules live in one module with unit tests per
   class, including a test that a non-volatile difference survives.

7. **Verdict.** Per checkpoint: `equal`, `differs`, or `unreached` (the Maki
   side failed its wait). Any `unreached` → `broken`; else any `differs` not
   covered by `acceptedDiffs` → `diverges`; else `parity`. A reference-side
   failure aborts the journey without writing anything: the reference must be
   reliable before the Maki side is judged.

8. **Gate split.** Recording needs `opencode` and a PTY, so `make
   test-journeys` is gated like `make test-ui` and not part of `make test`.
   The offline guarantee comes from crosscheck: it re-runs `diff.ts` on the
   committed snapshots (pure, no PTY) and asserts the committed status, and it
   reads every `maki-requests.jsonl` into the measured route set.

9. **Pilots and what each proves.**

   | Journey | Proves | Expected |
   | --- | --- | --- |
   | `send-prompt-stream-reply` | text turns, streaming, waits, normalization of model labels | `parity` or a small accepted diff |
   | `allow-permission-once` | tool-call turns on both adapters, dialog snapshots | `parity` or `diverges` with a triaged finding |
   | `resume-session-history` | the `diverges`/`broken` path, hand-off, measured-set widening via `GET /api/session/{sessionID}/message` | `diverges` or `broken`; the route becomes reachable and untriaged |

   Whatever the pilots show is recorded truthfully; an unexpected verdict is a
   finding, not a harness change, unless it traces to the harness itself.

## Risks / Trade-offs

- [OpenCode fetches the provider package or other assets on first run] →
  task 1.1 spikes it; pre-seed the cache (decision 4); if a network fetch is
  unavoidable, stop and record it rather than allow egress silently.
- [Screen timing flakes] → content waits with idle settling instead of
  sleeps; a run is repeated twice in task 4.1 and both must give identical
  snapshots.
- [Normalization hides a real difference] → per-class unit tests including a
  survival test; the model-label map is per side and explicit, not a broad
  regex.
- [Dropping colors misses highlight or error styling differences] → accepted
  for the pilots; noted for a follow-up attribute layer.
- [The reference run executes tool calls on the host] → only commands from
  the script's turns run, inside the temporary workdir.

## Open Questions

- The base-URL settings key and package name for an OpenAI-compatible provider
  in OpenCode 2.0.32 (resolved by task 1.1 without changing the design).
