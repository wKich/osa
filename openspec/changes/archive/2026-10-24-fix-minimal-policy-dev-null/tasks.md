# Tasks

## 1. Policy

- [x] 1.1 Add `/dev/null` to `read_write` in both example policies. Verify:
  `make test` and `make lint-profiles` pass.
- [x] 1.2 Name the null device in `AGENTS.md`, `docs/setup-guide.md`, and
  `docs/verification.md` where they state the writable set. Verify: grep.

## 2. Close and re-record

- [x] 2.1 Re-run `allow-permission-once` live and capture
  `openshell policy get <name> --full` while the sandbox is alive. Verify:
  the live `allowed` snapshot shows the command's Maki result, and the
  captured policy has no provider rule and no network egress.
- [x] 2.2 Close `minimal-policy-denies-dev-null`. Verify: crosscheck passes.
- [x] 2.3 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`,
  `openspec validate fix-minimal-policy-dev-null --strict`.
