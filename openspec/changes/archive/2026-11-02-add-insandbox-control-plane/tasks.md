# Tasks

## 1. Crate and surface

- [x] 1.1 Add `osa-core/crates/insandbox-gateway/` as a workspace member serving the OpenShell proto, with every unmodelled RPC answering an error that names the operation. Verify: `cargo build -p insandbox-gateway` succeeds and a request to an unmodelled operation returns that error.
- [x] 1.2 Run the same SDK contract case set as `stub-gateway`. Verify: the shared contract test passes for both crates with the same case list.

## 2. State and lifecycle

- [x] 2.1 Implement the state root: one directory per sandbox, a phase record, create, start, stop, and delete. Verify: the SDK contract cases for create, list, get, start, stop, and delete pass.
- [x] 2.2 Make delete remove the directory and recorded provider attachments, and make a stopped sandbox refuse exec. Verify: two cases assert both, including that no process starts for the stopped case.

## 3. Exec

- [x] 3.1 Implement exec as a local child in the sandbox workdir with the request's environment, streaming stdout and stderr as they arrive and returning the child's exit code. Verify: a test asserts a command exiting 7 is reported as exit 7 with its stderr, and a two-stage printer yields its first line before exit.
- [x] 3.2 Report a missing command and a killed child distinctly. Verify: two tests assert the exit statuses and that neither is reported as a transport failure.

## 4. File transfer

- [x] 4.1 Implement upload and download as copies into and out of the sandbox directory, with no bind mount. Verify: a round-trip test asserts byte-identical content and that no mount was created (`docker inspect` is not required; assert the destination is a plain file under the state root).
- [x] 4.2 Refuse any path that resolves outside the sandbox directory, including through a symlink, before writing. Verify: an escaping-path test fails the call, names the path, and leaves the outside path untouched.

## 5. CLI shim

- [x] 5.1 Implement the shim for gateway information and sandbox upload and download only. Verify: each supported subcommand returns the expected shape and an unsupported one fails naming it.
- [x] 5.2 Scope the shim to a private directory prepended to `PATH` for the plane's child tree. Verify: a test shows the shim resolving inside the tree and `command -v openshell` failing outside it.
- [x] 5.3 Assert the shim is never installed system-wide. Verify: the image and store files contain no write to a system bin directory under the `openshell` name.

## 6. The gate

- [x] 6.1 Require the inside-sandbox detection (uid/gid 1500 plus the marker the development image installs), an explicit state-root flag, a loopback bind, and plaintext transport; refuse otherwise naming the missing condition. Verify: four refusal tests, each asserting exit non-zero and no listener.
- [x] 6.2 Refuse a bearer or mutual-TLS configuration instead of downgrading. Verify: a test asserts the refusal message names the mode.
- [x] 6.3 Print a startup line stating that the plane enforces no isolation or policy. Verify: a test asserts the wording appears before the listener is announced.

## 7. Integration and documentation

- [x] 7.1 Provide the launch path the suite uses (binary plus state root plus `PATH` scoping) and document it. Verify: `docker run --rm -it osa-dev:local` followed by the documented command starts the plane and `openshell gateway info --output json` answers through the shim.
- [x] 7.2 Document what the plane does not provide and that its safety comes from the outer sandbox. Verify: `docs/ai/dev-environment.md` and the crate README both state the non-guarantee, and `scripts/check-links.sh` passes.
- [x] 7.3 Confirm no release binary links the crate. Verify: `cargo tree -p osa-core` and `cargo tree -p maki-oss` list no `insandbox-gateway` dependency, and the workspace release build contains no such binary.
