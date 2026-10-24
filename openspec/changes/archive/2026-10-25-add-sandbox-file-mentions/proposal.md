# Proposal

## Why

Scripting `mention-file-in-prompt` broke on the Maki side: typing
`@note` listed `sample` instead of the project's `notes.txt` (the bridge
answered `GET /api/fs/find` from the contract), so the mention could not be
picked; and once sent, the transcript lost the ` file  notes.txt` row because
the bridge dropped every `file://` attachment. The recorded reason —
"the bridge reads no host path on a client's behalf" — is right about the
host, but the project the TUI names lives in the sandbox workdir, which the
bridge already reads over the exec transport for `/api/fs/list`.

## What Changes

- `bridge/src/fs-find.ts`: `/api/fs/find` lists the sandbox workdir's files
  (`git ls-files -co --exclude-standard`, else `find` without `.git`),
  derives directories (`dir/`), and ranks fuzzy matches best first, then the
  shorter path (core `filesystem/search.ts` v2.0.32 L32–L51, L140–L176).
- `bridge/src/mentions.ts`: a prompt's `file://` path under the client's
  directory maps onto the sandbox workdir and is read there; it is attached
  as OpenCode attaches it (core `session/prompt.ts` v2.0.32 L151–L203,
  `runner/to-llm-message.ts` L37–L83): a text file (or `start`/`end` line
  range) as `Attached file: <name>` text, a directory as its sorted listing,
  an image as an image block, reported as `Prompt.FileAttachment` with a
  `uri` source. A PDF or other binary has no block on the pinned inbound wire
  (sdk_mode.rs v0.6.4 L786–L816) and is dropped, as before.
- Image data URIs keep their path; prompts are admitted in arrival order
  while a mention is read.
- `GET /api/fs/find` becomes `served-live`/reachable; `prompt-file-mentions`
  becomes `verified`/reachable.

## Capabilities

### Modified Capabilities

- `opencode-tui-bridge`: adds the mention requirement.

## Impact

`bridge/src/{fs-find,mentions,bridge,maki}.ts`, tests, statuses, journeys.
No host path is read: a URI outside the client's directory is dropped, and
every read is a `sandbox exec` with no `--env` value.
