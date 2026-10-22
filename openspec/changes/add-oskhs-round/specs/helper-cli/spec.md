# Spec Delta

## ADDED Requirements

### Requirement: Headless run timeout
`maki-oss run` SHALL accept `--timeout SECS` (a positive integer, also
`MAKI_OSS_TIMEOUT`). When set, the sandbox exec SHALL run Maki under
`timeout --kill-after=10 SECS`, so the time limit is enforced inside the
sandbox and ends Maki and its children there; the helper SHALL then exit with
`timeout`'s status (124 when the limit was hit). An invalid value SHALL be a
usage error before any sandbox call. Without `--timeout` the exec argv SHALL
be unchanged.

#### Scenario: Timeout wraps the in-sandbox command
- **WHEN** the user runs `maki-oss run --timeout 600 "check"`
- **THEN** the exec argv after `--` starts with `timeout --kill-after=10 600 maki --print`

#### Scenario: Invalid timeout is refused
- **WHEN** the user runs `maki-oss run --timeout soon "check"`
- **THEN** the helper exits 1 with a usage error and records no sandbox call

#### Scenario: No timeout keeps the argv
- **WHEN** the user runs `maki-oss run "check"` without `--timeout`
- **THEN** the exec argv after `--` starts with `maki --print`
