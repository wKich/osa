# Tasks

- [x] 1.1 Record `step-tokens-cumulative` with the live checkpoint. Verify:
  crosscheck passes.
- [x] 1.2 Scripted child: per-call usage on `assistant`, run total on
  `result`. Verify: fake-maki script test.
- [x] 1.3 Translator: step tokens from the last assistant usage. Verify: a
  translator test with two calls asserts `{input: 1, output: 1}`.
- [x] 1.4 Close the defect; re-record `allow-permission-once` offline (twice)
  and live. Verify: the live counter equals the reference.
- [x] 1.5 Gate: `make test`, `make test-bridge`, `make compat`, `make lint`,
  `openspec validate fix-step-usage --strict`.
