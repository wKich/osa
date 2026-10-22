# Redaction scan (task 4.2, 2026-10-23)

The archived change's two greps (`2026-10-21-add-opencode-tui-bridge/evidence/redaction-scan-2026-10-21.md`)
run over the new capture and this change's `evidence/`. Same rule: no
credential-shaped value and no authorization/key-shaped name lands in a
committed file.

## Scan 1 — value-shaped credentials

    grep -rlE 'sk-[A-Za-z0-9_-]{16,}|Bearer [A-Za-z0-9._-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|
               ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|
               eyJ[A-Za-z0-9_-]{30,}|hf_[A-Za-z0-9]{20,}'
      bridge/test/fixtures/maki-subagent-live.jsonl \
      openspec/changes/add-live-subagent-capture/evidence

Result: **no matches** (grep exit 1 = nothing found).

## Scan 2 — authorization/api-key keys

    grep -rlE '"?(authorization|api[-_]?key|x-api-key)"?[":= ]'
      bridge/test/fixtures/maki-subagent-live.jsonl \
      openspec/changes/add-live-subagent-capture/evidence

Result: **no matches** (grep exit 1 = nothing found). The scan ran before
this file existed; this file's own pattern line is the only match if it is
re-run, and it is pattern text, not a value — same caveat as the archived scan.

## Notes

- The live capture's init frame records `apiKeySource: "none"`: the child
  authenticated through the provider-profile binding, not a value.
- No credential value appears in the capture script, the capture, the shape
  comparison, or the capture note.
