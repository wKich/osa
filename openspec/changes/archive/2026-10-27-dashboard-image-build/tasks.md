# Tasks

## 1. Helper

- [x] 1.1 Add `run_forwarding_signals` to `lib/oss-core.sh` and use it in each front-end's `cmd_image_build` (design D2). Verify with a test that runs `image build` against a stub engine that sleeps, sends SIGTERM to the front-end, and asserts the stub saw TERM, the front-end exited non-zero, and no stub process remains.
- [x] 1.2 Add `__image-json` and route it in all four front-ends (design D1). Verify with tests for present, missing ("no such image"), engine missing, other inspect failure, and a configured derived image.
- [x] 1.3 Add `osa images [--json]` and `osa image build TAG` to `bin/osa` with `usage()`, the unknown-command list, and `fish/completions/osa.fish`. Verify with tests: extra argument and unknown tag exit 1 with no engine call, a successful build streams the stub's lines and exits 0, a failing build passes its status through, and "osa never changes a sandbox" covers `osa images --json` with no engine build call. Run `make test`.

## 2. Dashboard server

- [x] 2.1 Extend `dashboard/test/stub/osa` with `images --json` fixtures (present, missing, error, configured, markup in error) and an `image build` mode that prints timed lines, fails with a chosen status, or sleeps until TERM. Verify with a stub self-test.
- [x] 2.2 Add the argv shapes and `src/builds.ts` (design D3). Verify with unit tests: busy refusal, replay then live then `done`, late subscriber gets replay and `done`, subscriber leaving does not stop the child, cancel and SIGKILL fallback, ring overflow note, and hard-cap timeout with a shortened cap.
- [x] 2.3 Add the routes and stream (design D4). Verify with server tests: read-only 403 and missing token 403 for build and cancel, 400 for an unknown agent, 409 for a second build, stream 403 without a token, and 409 for cancel with nothing running.

## 3. Frontend, journey, docs

- [x] 3.1 Add `src/app/images.js` and the Setup tab if absent, served through the module allowlist (design D6). Verify with the no-HTML-sink test passing under `bun test`.
- [x] 3.2 Add one image journey to `scripts/browser-check.ts`: build a missing image shows streamed lines and then the row as present; a second Build is disabled while running; reload mid-build replays from the first line; Cancel ends with "cancelled"; a failed build shows its exit status; markup in output renders as text; read-only mode has no Build control. Verify with `bun run scripts/browser-check.ts` passing.
- [x] 3.3 Document `osa images` and `osa image build` in `docs/helper.md`, and the Images section, routes, and stream in `dashboard/README.md`. Verify with `make lint-docs` passing.
- [x] 3.4 Run `make test`, `cd dashboard && bun test`, the browser check, and `openspec validate dashboard-image-build --strict`. Then on this host, build one real base image from the dashboard, cancel a second real build, confirm with the engine's process list that nothing remains, and record the result in `docs/verification-log.md`. Verify all checks pass and the log entry exists.
