# Proposal

## Why

Every command above the transport layer needs an OpenShell control plane:
`up` creates a sandbox, a session uploads the workspace, execs the agent, and
downloads the result. Inside an osa sandbox there is no `openshell` CLI, no
gateway, and no container engine, so those flows cannot run there at all. The
existing `tests/stub/openshell` is an assertion fixture — canned output for
argv goldens — not a runnable plane, and `stub-gateway` serves state but runs
no process and moves no file.

## What Changes

- Add a dev-only binary, `insandbox-gateway`, that serves the OpenShell gRPC
  surface over a local state root:
  - a sandbox is a directory under the state root, with a phase file;
  - `exec_sandbox` spawns a real local child process in the sandbox directory,
    streams stdout/stderr, and reports its exit code;
  - upload and download copy files, with no bind mount and no symlink escape;
  - providers, rules, and health are recorded in the state root;
  - lifecycle operations are directory and phase transitions.
- Add a two-subcommand `openshell` shim for the surface the typed client does
  not cover (`gateway info --output json`, `sandbox upload`, `sandbox
  download`), installed in a private directory that is prepended to `PATH` for
  the plane's child process tree only.
- Gate the plane: it binds loopback only, speaks plaintext only, accepts no
  bearer token, refuses `--policy` enforcement claims, and refuses to start
  unless it detects that it is running inside an osa sandbox.
- Reuse the existing SDK contract test so the plane is held to the same
  generated RPC surface as `stub-gateway`.
- Non-goals: no change to production discovery, transports, or front-end
  behavior; no isolation guarantee of any kind; no new provider or egress
  semantics.

## Capabilities

### New Capabilities
- `insandbox-control-plane`: the dev-only, loopback, plaintext OpenShell-
  compatible service that materializes sandboxes as directories and exec as
  local processes, the CLI shim it needs, the inside-sandbox gate that keeps it
  from running anywhere else, and the explicit statement of what it does not
  provide.

### Modified Capabilities
- None. Production discovery and credential handling are unchanged: the plane
  is reached through the same endpoint selection the real gateway uses
  (<https://docs.nvidia.com/openshell/how-it-works/gateways/overview.md>,
  <https://docs.nvidia.com/openshell/sdk/rust.md>).

## Impact

- New: `osa-core/crates/insandbox-gateway/` (service, executor, file transfer,
  gate), the `openshell` shim, and its contract tests; the crate is a workspace
  member and is never built into a released front-end.
- Modified: `osa-core/Cargo.toml` (workspace member), `docs/ai/dev-environment.md`,
  and the in-sandbox verification target.
- Sequencing: builds on `add-openshell-sdk-transport`, which introduces the
  `Gateway` trait and the typed client this plane must satisfy.
- Security: the plane is not a boundary. Its safety property is that it runs
  inside a real osa sandbox, so the gate that refuses to start outside one is
  part of the capability, not a convenience.
