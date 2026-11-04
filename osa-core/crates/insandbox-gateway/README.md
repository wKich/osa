# insandbox-gateway

A dev-only OpenShell-compatible control plane that runs **inside** an osa
sandbox. It lets osa's own front-ends exercise their sandbox lifecycle where a
sandbox is a directory under a state root and `exec` is a local child process.

## It is not a boundary

The plane provides **no isolation**, **no policy** enforcement, and **no
credential brokering**. It does not verify an egress decision, does not read a
credential, and does not report a policy result as proved. Its only safety
property is that it refuses to start outside a real osa sandbox: the outer
sandbox is the boundary, and nothing this plane reports is evidence about it.

The startup line says so before it announces the listener.

## The gate

Startup requires all of:

- the invoking uid and gid are 1500, the sandbox identity;
- the marker the development image installs, `/etc/osa-dev/insandbox`,
  exists;
- an explicit `--state-root DIR`;
- a loopback `--listen IP:PORT` (default `127.0.0.1:0`);
- plaintext transport.

A bearer token (`--token`, `--bearer-token`) or mutual TLS (`--tls-dir`,
`--tls-cert`, `--tls-key`, `--tls-ca`) is refused by name, never downgraded.
Every refusal exits non-zero before any listener is opened.

## State root

```text
<state>/
  sandboxes/<name>/
    phase        # Ready, Stopped, ...
    id           # the id reported to clients
    created      # milliseconds since the epoch
    providers    # attached provider names, one per line
    rules        # recorded policy chunks, not proved decisions
    logs         # recorded log lines
    root/        # the sandbox filesystem; a workdir appears only when created
  shim/openshell # the private PATH shim
```

`create`, `start`, `stop`, and `delete` are transitions on the `phase` record;
`delete` removes the directory and its recorded provider attachments. `exec`
runs a real local child in the sandbox workdir with the invoking environment
plus the request's variables and streams its output. Like the real gateway it
creates the sandbox root but not a workdir, so the first `mkdir` comes from the
client, and an exec whose workdir does not exist is refused. Upload and
download are copies; there is no bind mount, and a path that resolves outside
the sandbox directory — including through a symlink — is refused before
anything is written, with the path named. An upload replaces read-only files,
so a repeated refresh overwrites earlier copies.

## The shim

The typed client covers `exec` and the sandbox lifecycle, but the front-ends
also shell out to the CLI. The shim answers `gateway info --output json` and
`status --output json`, and serves `sandbox upload`, `sandbox download`, and
`sandbox exec`. The exec form is the one the helper scripts use (`-n NAME
--no-login-shell -- COMMAND...`); it runs a real local child with the same
environment layering and sandbox-path rewriting as a typed exec, and its exit
code is the child's. No login shell is ever added. The shim is written to
`<state>/shim/openshell` and is found only because the plane prepends that
directory to `PATH` for its own child process tree. It is never installed in a
system bin directory.

## Launching it

Inside the development image (`examples/environments/dev`), after building:

```sh
cargo build --release -p insandbox-gateway
scripts/run-insandbox-plane.sh
```

The script picks the binary, the state root, and the loopback listen address,
then execs the plane. The plane prints the non-guarantee line and then
`insandbox-gateway listening on http://<address>`. Commands the plane execs —
for example the repository's own front-ends — resolve the shim and can answer
`openshell gateway info --output json`.

The end-to-end behavior is covered by
`cargo test -p insandbox-gateway --test plane`, including
`exec_through_the_plane_answers_gateway_info_through_the_shim` and
`an_interactive_exec_streams_input_and_reports_the_exit`.

## What the plane does not do

- No isolation, no container runtime, no nested sandbox.
- No policy enforcement and no egress decision.
- No credential brokering; credentials stay in provider profiles on the host.
- No terminal. An interactive exec is served with pipes: input frames reach the
  child's stdin and output streams back, but the child sees no TTY. A
  full-screen front-end needs a real gateway; the end-to-end suite runs
  headless runs.
