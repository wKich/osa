#!/bin/sh
# Pin drift gate: the typed gateway client and the gateway must come from the
# same OpenShell release.
#
# The SDK is consumed from source and pinned by git tag in the crate manifest;
# the host playbook installs a CLI and gateway at a release version. A silent
# mismatch produces RPCs the gateway does not implement, discovered at runtime,
# so this check reads both values and fails naming them.
#
# MANIFEST and PLAYBOOK exist so the check can be pointed at fixtures; the
# defaults are the real files.
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
MANIFEST=${MANIFEST:-$ROOT/osa-core/crates/osa-core/Cargo.toml}
PLAYBOOK=${PLAYBOOK:-$ROOT/docs/ai/host-playbook.md}

fail() {
    printf 'pin-drift: %s\n' "$1" >&2
    exit 1
}

[ -f "$MANIFEST" ] || fail "manifest not found: $MANIFEST"
[ -f "$PLAYBOOK" ] || fail "host playbook not found: $PLAYBOOK"

tag=$(sed -n 's/^.*openshell-sdk *= *{[^}]*tag *= *"\([^"]*\)".*$/\1/p' "$MANIFEST" | sed -n 1p)
version=$(sed -n 's/^.*OPENSHELL_VERSION=\(v[0-9][^ ]*\).*$/\1/p' "$PLAYBOOK" | sed -n 1p)

[ -n "$tag" ] || fail "no openshell-sdk git tag in $MANIFEST"
[ -n "$version" ] || fail "no OPENSHELL_VERSION pin in $PLAYBOOK"

if [ "$tag" != "$version" ]; then
    fail "SDK tag '$tag' in ${MANIFEST#"$ROOT"/} does not match gateway version '$version' in ${PLAYBOOK#"$ROOT"/}; pin the SDK to the gateway's release tag"
fi

printf 'pin-drift: ok, SDK tag and gateway version are both %s\n' "$tag"
