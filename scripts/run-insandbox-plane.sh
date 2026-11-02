#!/bin/sh
# run-insandbox-plane.sh - start the dev-only in-sandbox control plane.
#
# Run this inside the development image (examples/environments/dev). It finds
# the binary, picks a state root under /sandbox, and execs the plane, which
# prints the non-guarantee and then its listener before serving.
#
# The plane enforces no isolation or policy. Its safety comes only from the osa
# sandbox it runs in, and its gate refuses to start anywhere else.
#
# Environment:
#   IN_SANDBOX_GATEWAY_BIN     binary to run (default: release, then debug)
#   IN_SANDBOX_STATE_ROOT      state root (default: /sandbox/.local/state/insandbox)
#   IN_SANDBOX_GATEWAY_LISTEN  loopback bind (default: 127.0.0.1:0)
#
# Extra arguments are passed to the plane.

set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd) || exit 1

bin=${IN_SANDBOX_GATEWAY_BIN:-}
if [ -z "$bin" ]; then
    for candidate in \
        "$root/osa-core/target/release/insandbox-gateway" \
        "$root/osa-core/target/debug/insandbox-gateway"; do
        if [ -x "$candidate" ]; then
            bin=$candidate
            break
        fi
    done
fi
[ -n "$bin" ] || {
    printf '%s\n' \
        'run-insandbox-plane: insandbox-gateway is not built; run' \
        '  cargo build --release -p insandbox-gateway' >&2
    exit 1
}

state_root=${IN_SANDBOX_STATE_ROOT:-/sandbox/.local/state/insandbox}
listen=${IN_SANDBOX_GATEWAY_LISTEN:-127.0.0.1:0}

exec "$bin" --state-root "$state_root" --listen "$listen" "$@"
