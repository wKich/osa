# Notes

## Live caller-mode check (task 4.2)

Run on macOS against the live OpenShell gateway on 2026-10-29.

| Field | Value |
|---|---|
| Maki | `0.6.5` |
| Image | `maki-agent:personal` |
| Provider | `maki-synthetic` |
| Model | `synthetic/hf:zai-org/GLM-5.3` |
| Sandbox | `osa-live42` (caller mode, workdir `/sandbox/tasks/live42`) |
| Host tree | dirty linked worktree: `app.txt` modified, `notes.txt` untracked |
| `sync-in` | `{"baseline":"b62a16019b4f394e497bb3bb738f310fbb208731","files":3,"bytes":34}` |
| Upload time | 0.5 s wall clock for `sync-in` of the worktree |
| Run | `printf <prompt> \| maki-oss run --timeout 600 --model synthetic/hf:zai-org/GLM-5.3 -- --disallowed-tools Write,Edit` |
| Run exit | 0 |
| Session id | `CgW3Sn4XtF88jPjN5vq52` |

The prompt asked Maki to append `sandbox-live-edit` to `app.txt` through the
Bash tool, because `Write` and `Edit` were denied.

### stdout event types

Five stream-json lines, one event per line:

1. `system`
2. `assistant`
3. `user`
4. `assistant`
5. `result` (`is_error: false`, `result: "DONE"`)

The stream ends in the `result` event the oskhs parser reads.

### Patch round trip

`collect-patch --json` reported the single modified file:

```json
{"empty":false,"baseline":"b62a16019b4f394e497bb3bb738f310fbb208731","files":[{"status":"M","path":"app.txt"}]}
```

The patch added `sandbox-live-edit` to `app.txt`. `git apply --check` and
`git apply` both succeeded on the host worktree, which then contained:

```text
base
dirty local
sandbox-live-edit
```

`notes.txt` and the pre-existing dirty edit stayed on the host; only the
agent's change came back through the patch.
