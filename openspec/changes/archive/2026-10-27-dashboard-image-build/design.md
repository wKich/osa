# Design

## Context

Each front-end has `cmd_image_build`, which:

- resolves the engine (`resolved_engine`);
- picks the tag with `resolve_setting "$opt_image" "$(env_setting IMAGE)" "" "$DEFAULT_IMAGE"`, which deliberately ignores the configured `image`;
- runs `"$engine" build [--build-arg VERSION] -t TAG <repo>/<agent>/image` in the foreground, dying with `die_dep` on failure.

Interrupting the shell does not reliably stop the engine child when the signal goes to the shell alone, because the engine runs as a separate process and is not `exec`'d.

The dashboard has a log hub pattern (`src/logs.ts`): one child per key, a 2000-line ring buffer, SSE fan-out with token-in-URL, and a kill when the last subscriber leaves. It spawns only `osa` through `isAllowedOsaArgv`. `dashboard-provider-wizard` (pending) adds the Setup tab, and this change adds its Images section.

## Goals / Non-Goals

**Goals:**

- See and build each agent's base image from the browser, with live output.
- Builds survive tab closes, never run concurrently, and can be cancelled.
- No new spawn target, and no user-controlled engine arguments.

**Non-Goals:**

- Environment stores.
- Version overrides.
- Pull, push, and remove.
- Persistent build history.
- Per-sandbox image reporting (OpenShell does not expose it; see the README's known limitations).

## Decisions

### D1: `osa images` and `__image-json`

`osa images` runs `<front-end> __image-json` for each tag. The front-end prints this object:

```
{agent, image, engine, present, id, created, configured, error}
```

- **`image`** is the tag `image build` would produce, resolved exactly as `cmd_image_build` does.
- **`present`, `id`, and `created`** come from `"$engine" image inspect --format '{{.Id}}|{{.Created}}' "$image"`.
  - The engine exits 0: `present: true` with the id and creation time.
  - It exits non-zero and stderr matches "no such image" (Docker or Podman wording): `present: false`.
  - Anything else: `error`.
- **`configured`** is `resolved_image` when it differs from `image`, otherwise `null`.
- A missing engine sets `error: {message: "container engine '<e>' not found on PATH"}`.

No gateway call is made.

Text mode prints one line per agent.

### D2: `osa image build` execs; the front-end forwards signals

`bin/osa` accepts exactly `image build TAG`. Anything after the tag is a usage error, which rules out version or tag overrides. Once the tag is validated, it runs:

```
exec "$front" image build </dev/null
```

`exec` keeps one PID for the dashboard to signal.

The front-ends' `cmd_image_build` calls a new core helper, `run_forwarding_signals CMD...`:

```sh
"$@" &
rfs_pid=$!
trap 'kill -TERM "$rfs_pid" 2>/dev/null' TERM INT
wait "$rfs_pid"; rfs_rc=$?
# wait returns >128 when interrupted by the trapped signal: wait again
```

It then returns the engine's status. Docker and Podman CLIs cancel an in-progress build on SIGTERM. The existing failure messages, such as OpenCode's sha512 hint, stay in each front-end.

Alternatives:
- A process group and `kill(-pgid)`: Bun's spawn has no portable process-group option, and macOS has no `setsid` command.
- `exec` of the engine in the front-end: this would lose the post-failure hints.

### D3: Build hub in `src/builds.ts`

`BuildHub` is a single instance. Its state is `{id, agent, startedAt, finishedAt?, exitCode?, cancelled, lines: ring(5000)}`, holding the current build or the last one.

- **`start(agent)`:**
  - if a build is running, return `busy`;
  - otherwise spawn `osa image build <tag>` through the gate with `stdout` and `stderr` piped, and split both into lines in arrival order;
  - each line is appended to the ring and broadcast;
  - when the child exits, set `exitCode` and `finishedAt`, and broadcast a `done` event.
- **`cancel()`:** send SIGTERM to the child and set `cancelled = true`. If the child is still alive 10 s later, send SIGKILL.
- **Hard cap:** 60 minutes, then cancel. The `done` event then reports `cancelled: true, reason: "timeout"`.
- **Subscribers** get a replay of the ring, then live lines, then `done`.
  - Subscribing after the build has ended replays the ring and `done` immediately.
  - Unlike `LogHub`, a subscriber leaving never stops the child.
- The last build stays in memory until the next build starts or the server restarts.

### D4: Routes and guards

| Route | Guards | Result |
|---|---|---|
| `GET /api/images` | normal read rules | `osa images --json`, 20 s timeout, no cache |
| `GET /api/images/build` | normal read rules | the hub's summary (no lines): `{build: {id, agent, startedAt, finishedAt, exitCode, cancelled} \| null}` |
| `POST /api/images/:agent/build` | `guardMutation`; `agent` in `mk`, `oc`, `cc`, `cx`, else 400 | 202 `{build}`, or 409 `busy` |
| `POST /api/images/build/cancel` | `guardMutation` | 200, or 409 when nothing is running |
| `GET /events/build?token=` | token required, as with logs | SSE events `line` (data: text), `done` (data: JSON), and heartbeats |

`isAllowedOsaArgv` gains two shapes: `["images", "--json"]` and `["image", "build", tag]` with `tag` in the set.

A build is allowed on a non-loopback bind. It needs the token and exposes no secret: the build contexts are the repository's own and carry no credentials, per the environment-layer spec.

### D5: Spec ordering

The MODIFIED "osa entry point" here builds on the text from `dashboard-health` and `add-provider-setup-noninteractive`. Archive those first. If this change archives earlier, rebase its command lists to drop the entries that have not landed.

### D6: UI

`src/app/images.js` renders the Images section of the Setup tab. If `dashboard-provider-wizard` has not landed, this change creates the tab.

- **Rows** show: agent, base tag, present with its created time or "missing", the engine, "sessions use <configured>" when set, the error text, and a Build button.
- **Build buttons:** while any build runs, every Build button is disabled with the reason "a build is running", and a Cancel button appears.
- **Log panel:** a `<pre>` fed by `EventSource("/events/build?token=…")` through text nodes.
  - It auto-scrolls unless the user has scrolled up.
  - It shows a status line: running for mm:ss, then succeeded, failed (exit N), or cancelled.
  - It is opened when the tab loads if `GET /api/images/build` reports a build.
- **On `done`:** the page refetches `/api/images`.

## Risks / Trade-offs

- **[Docker ignores SIGTERM in some versions]** Mitigation: SIGKILL after 10 s on the `osa` process. The trap in the front-end has then already signaled the engine. The journey test uses the stub; real cancellation is checked manually on this host and recorded.
- **[Ring buffer drops early lines on long builds]** A 5000-line cap is enough for these Dockerfiles. When lines are dropped, the panel notes "earlier output dropped".
- **[Building while a session runs]** Rebuilding a tag does not affect running sandboxes; it changes only new creates. This is shown as a hint, not blocked.

## Migration Plan

Additive. Front-end `image build` behaves the same from a terminal, except that Ctrl-C now also stops the engine reliably.

## Open Questions

None.
