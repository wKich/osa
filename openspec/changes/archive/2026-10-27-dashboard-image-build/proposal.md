# Proposal

## Why

A first session fails if the agent's base image (`maki-agent:local`, `opencode-agent:local`, `claude-agent:local`, `codex-agent:local`) was never built. Building it is a separate terminal step, `<front-end> image build`, and it takes minutes. The dashboard's create form and M3's doctor checks can tell the user that an image is missing, but they cannot fix it. M4 closes that gap: the Setup tab shows each agent's base image and builds it with a live log. The build logic stays in the front-ends; `osa` gains a thin entry so the dashboard keeps spawning only `osa`.

## What Changes

- Add **`osa images [--json]`**, a read-only command. For each agent it reports the base image tag, the container engine, whether the image exists locally (with its id and creation time), and the configured session image when it differs, such as a derived environment.
- Add **`osa image build TAG`**. It hands off to `<front-end> image build`, which uses its default tag and pinned version and accepts no build arguments or tag override. Output streams to stdout and stderr, and the exit code is the result. The front-ends forward SIGTERM and SIGINT to the engine, so a cancelled build stops the engine instead of leaving it running.
- In the dashboard's **Setup** tab, add an **Images** section with one row per agent: base tag, present or missing, created time, the configured image, and a **Build** button.
- Add **`POST /api/images/:agent/build`**: token, read-only refusal, and one build at a time (409). The build keeps running when the browser disconnects. Also add **`GET /events/build`**, an SSE stream that requires the token, replays the current or last build's log, and ends with a `done` event, and **`POST /api/images/build/cancel`**.
- Update the `osa entry point` requirement: `image build` joins the commands that change something. It changes only a local image tag, never a sandbox or the state root.

Out of scope:

- building environment stores (they stay in the terminal);
- version or build-argument overrides;
- pushing or pulling images;
- deleting images;
- build history across restarts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `osa-project-layer`: MODIFIED "osa entry point" (adds `images` and `image build`); ADDED "osa reports and builds base images".
- `dashboard`: ADDED "Base image builds".

## Impact

- `lib/oss-core.sh`: `__image-json`, and a TERM/INT forwarding helper the front-ends' `cmd_image_build` uses.
- `bin/maki-oss`, `bin/opencode-oss`, `bin/claude-oss`, `bin/codex-oss`: run the engine through the helper and route `__image-json`.
- `bin/osa`: `images`, `image build`, `usage()`; `fish/completions/osa.fish`.
- Dashboard:
  - `src/projects.ts`: argv gate shapes `images --json` and `image build TAG`.
  - New `src/builds.ts`: a single-build hub with a ring buffer and SSE fan-out, reusing the `logs.ts` pattern.
  - `src/server.ts`: three routes plus the stream.
  - Frontend: `src/app/images.js`, and the Setup tab, created here if `dashboard-provider-wizard` has not landed.
- Tests: `tests/run-tests.sh` with a stub engine; `dashboard/test/stub/osa` gains `images` and a streaming `image build`; server tests; one browser journey.
- Docs: `docs/helper.md` and `dashboard/README.md`.
- Security:
  - The build context is the repository's own `*/image` directory.
  - No user input reaches the engine argv except the agent tag, which is chosen from four.
  - No bind mounts, secrets, or `--env`.
  - Build output is gated by the token like logs.
- Spec order: this delta assumes `dashboard-health` and `add-provider-setup-noninteractive` are archived first (see design D5).
