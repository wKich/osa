# Design

## Context

See `proposal.md` for motivation. Constraints that shape the approach:

- `add-openshell-sdk-transport` introduces a `Gateway` trait with an
  `openshell-sdk` implementation, and `stub-gateway` serving the same generated
  proto over loopback with plaintext transport.
- Discovery runs `openshell gateway info --output json` once per process
  (`gateway/cli.rs`), and file transfer stays on the CLI because the typed
  client has no file-transfer surface.
- `stub-gateway`'s contract is that anything outside the tested surface is
  `unimplemented`, and it executes nothing.
- The security invariants in `AGENTS.md` bind every artifact: no bind mounts,
  no credentials outside provider profiles, no widened egress, non-root user.

## Goals / Non-Goals

**Goals:**

- Let the unchanged product binaries run their whole lifecycle inside one
  sandbox, with real files, real processes, and real exit codes.
- Keep the fidelity contract testable, so the plane can be compared with a real
  gateway rather than trusted.

**Non-Goals:**

- No isolation, no policy enforcement, no credential brokering, no TTY or
  interactive exec in the first cut.
- No change to production selection or transports.

## Decisions

### D1. A separate crate, not a mode of `stub-gateway`

`osa-core/crates/insandbox-gateway/` implements the proto surface with a real
executor over a state root. `stub-gateway` keeps its "runs nothing" contract.

*Why:* the suite relies on the stub being inert; teaching it to spawn processes
would let a fixture execute commands, and a canned-output mode and a real mode
in one binary invite the wrong one being selected.

*Trade-off accepted:* the state layout is implemented twice. The mitigation is
behavioral: both crates run the same SDK contract case set, and the shared state
layout is asserted through the same fixture tree the CLI stub documents.

### D2. The plane is an OpenShell-compatible server, not a new `Gateway` transport

osa keeps talking to an endpoint. The plane is reached through the existing
selection: the `gateway` config key or the environment variable the CLI itself
honours, with the shim answering `gateway info`.

*Why:* production code stays untouched, and the plane is constrained by the
generated proto — the strongest fidelity pressure available without a real
gateway. A new transport in the shipped binary would put a fake sandbox in
every user's build.

*Alternative rejected:* a `Gateway` implementation selected by a dev flag. It
is less code but it ships the capability and changes the product's transport
surface for a development need.

### D3. Exec is a local child process under the invoking identity

`exec` spawns the command with the sandbox directory as its working directory,
the invoking environment plus the request's variables, streams output, and
returns the child's exit code.

*Why:* the outer sandbox is the only boundary; a nested "container" would be an
isolation claim this project cannot support. Running as the same uid keeps
permissions honest — the agent's files are the agent's files.

*Alternative rejected:* rootless container runtimes inside the sandbox. They are
unavailable under the filesystem policy, and a half-working one would invite
boundary conclusions from orchestration runs.

### D4. The CLI shim covers exactly two responsibilities and is PATH-scoped

The shim answers gateway information and sandbox upload and download. The plane
prepends its private directory to `PATH` for its own child process tree only.

*Why:* discovery and file transfer are CLI-only by design, so a shim is
unavoidable; scoping it prevents shadowing a real `openshell` anywhere else, and
prevents an environment image from silently installing a fake one.

*Alternative rejected:* teaching discovery to accept a direct endpoint URL. It
is a product change to spare a two-subcommand script, and it would create a
configuration path that only exists for development.

### D5. The gate is detection plus explicit opt-in

Startup requires an inside-sandbox detection (the sandbox identity and a marker
the development image installs), a loopback bind, plaintext transport, and an
explicit flag naming the state root. Any missing condition is a refusal that
names it.

*Why:* outside a sandbox this binary is an unsandboxed agent runner. An
environment variable alone is too easy to inherit accidentally; a marker file
that only the development image creates is not.

### D6. Plaintext, loopback, no token

*Why:* the client supports plaintext, and a bearer token inside a sandbox is a
secret-shaped artifact with no security value over loopback.

## Risks / Trade-offs

- **Fidelity drift from the real gateway** → the SDK contract case set plus the
  host-recorded parity comparisons in the sibling e2e change; a divergence is
  fixed in the plane, never by loosening normalization.
- **The plane read as a boundary** → refusal outside a sandbox, startup output
  that states the non-guarantee, and the layer-claim table.
- **Path escape through a symlink** → canonicalize before writing and require
  the result to stay under the sandbox directory; a case covers it.
- **Interactive sessions unsupported in the first cut** → the plane reports the
  operation as unimplemented; the e2e suite covers headless flows only.
- **Two state-layout implementations** → one documented fixture tree, both
  crates tested against it.
