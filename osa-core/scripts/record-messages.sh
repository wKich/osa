#!/bin/sh
# Records the shell implementation's usage output and usage-error messages, so
# the Rust dispatcher can be compared against them byte for byte.
#
# Run from the repository root, before `bin/osa` becomes the shim:
#   osa-core/scripts/record-messages.sh [path-to-osa]
set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)
program=${1:-$root/bin/osa}
out=$root/osa-core/crates/osa-core/tests/fixtures/messages

rm -rf "$out"
mkdir -p "$out"

record() { # NAME ARGS...
    name=$1
    shift
    dir=$out/$name
    mkdir -p "$dir"
    if [ "$#" -gt 0 ]; then
        printf '%s\n' "$@" >"$dir/args"
    else
        : >"$dir/args"
    fi
    rc=0
    "$program" "$@" >"$dir/stdout" 2>"$dir/stderr" </dev/null || rc=$?
    printf '%s\n' "$rc" >"$dir/rc"
}

record help help
record help-flag --help
record no-args
record dashboard-help dashboard --help
record unknown-command up
record quick-on-projects projects --quick
record yes-on-projects projects --yes
record health-missing-sandbox health
record health-two-sandboxes health a b
record remove-missing-sandbox remove
record resolve-missing-action resolve sandbox
record resolve-bad-action resolve sandbox explode
record resolve-extra-argument resolve sandbox apply extra
record providers-bad-agent providers --agent zz
record providers-extra-argument providers extra
record provider-setup-missing-profile provider setup mk
record provider-setup-bad-profile provider setup mk --profile ../x
record provider-setup-bad-name provider setup mk --profile maki-deepseek --name Bad_Name
record provider-setup-bad-tag provider setup zz --profile maki-deepseek
record provider-unknown-subcommand provider remove mk
record image-build-extra image build mk --maki-version 1.2.3
record image-build-bad-tag image build zz
record image-build-missing-tag image build
record image-unknown-subcommand image list
record unknown-option projects --daemon
record profile-on-projects projects --profile maki-deepseek
record dashboard-unknown-option dashboard --daemon
record dashboard-positional dashboard extra
record dashboard-missing-value dashboard --port
record dashboard-missing-token dashboard --read-only --token
