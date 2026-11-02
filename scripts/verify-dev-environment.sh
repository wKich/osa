#!/bin/sh
# verify-dev-environment.sh - prove the development image is usable.
#
# Run it inside the image built from examples/environments/dev:
#
#   scripts/verify-dev-environment.sh        (make verify-dev-environment)
#
# In order, it checks that every pinned runtime resolves at the version the
# image baked, that the front end builds with the network off, that the
# stub-backed suite passes, that the core suite passes with the network off,
# and that the loopback MongoDB starts so the full gate runs its store tests.
#
# It calls cargo, the suite scripts, and scripts/test-all.sh directly rather
# than through make: `make` cannot spawn a child process inside an OpenShell
# sandbox, and this is the command an agent runs there.
#
# It stops at the first failure naming the runtime or the command, and it never
# reports success for a check it did not run. POSIX sh only.

set -u

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd) || exit 1
pins=/etc/osa-dev/pins.env

fail() {
    printf 'verify-dev-environment: %s\n' "$*" >&2
    exit 1
}

[ -r "$pins" ] || fail "not running inside the development image ($pins is missing); build examples/environments/dev and run this there"
# shellcheck disable=SC1090
. "$pins"

# The marker the dev-only control plane's gate requires. It is installed only
# by this image, so a missing marker is a stale image, not a plane bug.
[ -r /etc/osa-dev/insandbox ] \
    || fail "the development image marker /etc/osa-dev/insandbox is missing (rebuild examples/environments/dev)"
printf 'ok   sandbox marker %s\n' /etc/osa-dev/insandbox

check_present() {
    command -v "$1" >/dev/null 2>&1 \
        || fail "$1 not found: the image must carry it (rebuild examples/environments/dev)"
}

check_version() {
    [ "$3" = "$2" ] \
        || fail "$1 is $3, not the pinned $2 (rebuild examples/environments/dev)"
    printf 'ok   %s %s\n' "$1" "$3"
}

## 1. Every runtime resolves.

for tool in cargo rustc cargo-clippy rustfmt cargo-fmt bun openspec jq timeout \
    pkill fish patch make cc git mongod mongosh; do
    check_present "$tool"
done

channel=$(sed -n 's/^channel[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$root/rust-toolchain.toml" 2>/dev/null | head -n 1)
[ -n "$channel" ] || fail "cannot read the Rust channel from $root/rust-toolchain.toml"
[ "$RUST_CHANNEL" = "$channel" ] \
    || fail "the image carries Rust $RUST_CHANNEL but rust-toolchain.toml pins $channel (rebuild examples/environments/dev with RUST_CHANNEL=$channel)"

cargo_version=$(cd "$root" && cargo --version 2>&1) \
    || fail "cargo does not resolve the channel pinned in rust-toolchain.toml ($channel): $cargo_version"
check_version cargo "$channel" "$(printf '%s\n' "$cargo_version" | cut -d' ' -f2)"

clippy_version=$(cd "$root" && cargo clippy --version 2>&1) \
    || fail "cargo clippy does not resolve (the image must carry the clippy component): $clippy_version"
printf 'ok   clippy %s\n' "$(printf '%s\n' "$clippy_version" | cut -d' ' -f2)"

fmt_version=$(cd "$root" && cargo fmt --version 2>&1) \
    || fail "cargo fmt does not resolve (the image must carry the rustfmt component): $fmt_version"
printf 'ok   rustfmt %s\n' "$(printf '%s\n' "$fmt_version" | cut -d' ' -f2)"

check_version bun "$BUN_VERSION" "$(bun --version 2>&1)"
check_version openspec "$OPENSPEC_VERSION" "$(openspec --version 2>&1)"

mongod_version=$(mongod --version 2>&1 | sed -n 's/^db version v//p' | head -n 1)
[ -n "$mongod_version" ] || fail "mongod --version did not report a version (rebuild examples/environments/dev)"
check_version mongod "$MONGODB_VERSION" "$mongod_version"
check_version mongosh "$MONGOSH_VERSION" "$(mongosh --version 2>&1)"

check_present "$OSA_DEV_AGENT"
printf 'ok   %s\n' "$("$OSA_DEV_AGENT" --version 2>&1 | head -n 1)"

## 2. Bun packages the suites import, restored from the image's cache.

ensure_bun_deps() {
    dep_dir=$root/$1
    [ -f "$dep_dir/bun.lock" ] || return 0
    [ -d "$dep_dir/node_modules" ] && return 0
    (cd "$dep_dir" && bun install --frozen-lockfile --offline) \
        || fail "bun install --offline failed in $1 (rebuild examples/environments/dev after a $1/bun.lock change)"
}

for dep in bridge oskhs; do
    ensure_bun_deps "$dep"
done
printf 'ok   bun packages resolve offline\n'

## 3. The front end builds with the network off.

printf '\n== offline build ==\n'
(cd "$root" && CARGO_NET_OFFLINE=true cargo build --release \
    --manifest-path osa-core/Cargo.toml) \
    || fail "the front end did not build with the network off (the image's Cargo cache does not cover osa-core/Cargo.lock)"
[ -x "$root/osa-core/target/release/osa" ] \
    || fail "the build produced no binary at osa-core/target/release/osa"

# The dev-only plane is built on demand, and must build offline too.
(cd "$root" && CARGO_NET_OFFLINE=true cargo build --release \
    --manifest-path osa-core/Cargo.toml -p insandbox-gateway) \
    || fail "the in-sandbox control plane did not build with the network off"
[ -x "$root/osa-core/target/release/insandbox-gateway" ] \
    || fail "the build produced no binary at osa-core/target/release/insandbox-gateway"

## 4. The stub-backed suite.

printf '\n== suite ==\n'
(cd "$root" && tests/run-tests.sh) || fail "the shell suite failed"

## 5. The core suite with the network off.

printf '\n== offline core suite ==\n'
(cd "$root" && CARGO_NET_OFFLINE=true cargo test --workspace \
    --manifest-path osa-core/Cargo.toml) \
    || fail "the core suite failed with the network off"

## 6. The full gate against the image's loopback MongoDB.

printf '\n== full gate ==\n'
osa-dev-start-mongodb \
    || fail "the image's loopback MongoDB did not start"
(cd "$root" && OSKHS_TEST_MONGO_URI="${OSKHS_TEST_MONGO_URI:-mongodb://127.0.0.1:27017}" scripts/test-all.sh) \
    || fail "the full gate failed against the image's loopback MongoDB"

printf '\nverify-dev-environment: every check passed\n'
