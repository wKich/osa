#!/bin/sh
# build-e2e.sh - build the binaries the end-to-end suite drives.
#
# Two builds, one target directory:
#   - the four front-ends and `osa` with osa-core/test-support, so the client
#     can record a normalized transcript when OSA_E2E_TRANSCRIPT_DIR is set;
#   - the in-sandbox control plane, unchanged by the recording feature.
#
# Not part of `make test`: the suite's binaries are only needed by
# `make test-e2e-local` and `make test-e2e`. Run this inside the development
# image or on a host with the pinned toolchain.

set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
target=$root/osa-core/target/e2e

command -v cargo >/dev/null 2>&1 || {
    printf '%s\n' 'build-e2e: cargo not found (install the pinned toolchain from rust-toolchain.toml)' >&2
    exit 1
}

cargo build --release \
    --manifest-path "$root/osa-core/Cargo.toml" \
    --target-dir "$target" \
    -p osa-core --features test-support --bins
cargo build --release \
    --manifest-path "$root/osa-core/Cargo.toml" \
    --target-dir "$target" \
    -p insandbox-gateway

printf '%s\n' "$target/release"
