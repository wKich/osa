# Spec Delta

## MODIFIED Requirements

### Requirement: Headless run timeout
`maki-oss run` SHALL accept `--timeout SECS` (a positive integer, also
`MAKI_OSS_TIMEOUT`). When set, the sandbox exec SHALL run Maki under
`timeout --kill-after=10 SECS` inside an in-sandbox wrapper that exports a
per-run tag and, when `timeout` returns, kills every process that inherited
the tag, so the time limit is enforced inside the sandbox and ends Maki and
its tool processes there, including ones in their own session; the helper
SHALL then exit with `timeout`'s status (124 when the limit was hit). The tag
SHALL be exported inside the sandbox, never passed with `--env`; a caller MAY
choose it with `MAKI_OSS_RUN_TAG` (letters, digits, `.`, `_`, `-`), and the
wrapper SHALL stop the run early — Maki stopped, tagged processes swept, exit
status of the stopped `timeout` — within a few seconds of a file
`/tmp/maki-oss-stop/<tag>` appearing in the sandbox. An invalid value of either
SHALL be a usage error before any sandbox call. Without `--timeout` the exec
argv SHALL be unchanged.

#### Scenario: Timeout wraps the in-sandbox command
- **WHEN** the user runs `maki-oss run --timeout 600 "check"`
- **THEN** the exec argv after `--` is the tag wrapper (`sh -c`) running `timeout --kill-after=10 600 maki --print …`, with no `--env` flag

#### Scenario: Tool processes do not outlive the limit
- **WHEN** a run with `--timeout 8` makes Maki start a shell command that sleeps for two minutes
- **THEN** the helper exits 124 within a few seconds of the limit and no `maki` or `sleep` process from that run remains in the sandbox

#### Scenario: Invalid timeout is refused
- **WHEN** the user runs `maki-oss run --timeout soon "check"`
- **THEN** the helper exits 1 with a usage error and records no sandbox call

#### Scenario: No timeout keeps the argv
- **WHEN** the user runs `maki-oss run "check"` without `--timeout`
- **THEN** the exec argv after `--` starts with `maki --print`

#### Scenario: Stop file ends the run
- **WHEN** a run with `MAKI_OSS_RUN_TAG=t1` has made Maki start a two-minute shell command and another `sandbox exec` creates `/tmp/maki-oss-stop/t1`
- **THEN** the helper returns within a few seconds and no `maki` or tool process from that run remains

#### Scenario: Caller-chosen run tag
- **WHEN** `MAKI_OSS_RUN_TAG=oskhs-t1 maki-oss run --timeout 30 "check"` runs
- **THEN** the wrapper exports `oskhs-t1`, and a tag with a space is refused as a usage error before any sandbox call
