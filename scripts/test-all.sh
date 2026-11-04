#!/bin/sh
# test-all.sh - the verification gate, runnable without `make`.
#
# The shell suite with the conformance layer in strict mode, then the core,
# bridge, dashboard, and oskhs suites, including the MongoTaskStore tests
# against OSKHS_TEST_MONGO_URI. A conformance-only failure is named as such. A
# missing prerequisite fails instead of skipping.
#
# `make test-all` runs exactly this script, and an agent inside an OpenShell
# sandbox runs it directly: `make` cannot spawn a child process there, so every
# target that needs a subshell has a script behind it.
#
# Optional ROOT argument (used by tests/boundary/gate.sh): run the same suite
# over another checkout instead of this script's repository. The boundary gate
# passes the throwaway tree a sandbox patch was applied to; `make test-all`
# passes nothing, so its meaning is unchanged.
#
# POSIX sh only.

set -u

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P) || exit 1
if [ "$#" -gt 0 ] && [ -n "$1" ]; then
    root=$(CDPATH='' cd -- "$1" && pwd -P) || {
        echo "test-all: not a directory: $1" >&2
        exit 1
    }
fi
cd "$root" || exit 1

command -v bun >/dev/null 2>&1 \
    || { echo 'test-all: bun not found (install Bun: https://bun.sh)' >&2; exit 1; }
command -v cargo >/dev/null 2>&1 \
    || { echo 'test-all: cargo not found (install the pinned Rust toolchain from rust-toolchain.toml)' >&2; exit 1; }
[ -n "${OSKHS_TEST_MONGO_URI:-}" ] \
    || { echo 'test-all: OSKHS_TEST_MONGO_URI is not set (e.g. mongodb://127.0.0.1:27017)' >&2; exit 1; }

cargo build --release --manifest-path osa-core/Cargo.toml >/dev/null \
    || { echo 'test-all: core build failed' >&2; exit 1; }

report=$(mktemp) || exit 1
if ! OSA_CONFORMANCE_STRICT=1 OSA_CONFORMANCE_REPORT="$report" tests/run-tests.sh; then
    if grep -q '^failed' "$report" 2>/dev/null; then
        echo 'test-all: conformance suite failed' >&2
    else
        echo 'test-all: shell suite failed' >&2
    fi
    rm -f "$report"
    exit 1
fi
rm -f "$report"

# The converted set has to behave the same over both transports: run it once
# with the typed client and once with the CLI selector, then compare state,
# exit status, output, and the declared transport. Only `identical` and
# `transport-changed` pass.
if ! OSA_PARITY_TRANSPORT=cli \
    OSA_PARITY_RUN_ONLY='test_up_creates,test_mk_run_stdin_prompt,test_session_plain_apply,test_provider_setup_curated,test_provider_wrappers,test_session_create_race_reuses,test_run_timeout_flag,test_policy_review_lists_chunks,test_exit_surfaces_pending_proposals,test_oc_provider_setup' \
    tests/conformance/harness.sh parity; then
    echo 'test-all: converted-set parity failed' >&2
    exit 1
fi

cargo test --workspace --manifest-path osa-core/Cargo.toml \
    || { echo 'test-all: core suite failed' >&2; exit 1; }
(cd bridge && bun test) || { echo 'test-all: bridge suite failed' >&2; exit 1; }
(cd dashboard && bun test) || { echo 'test-all: dashboard suite failed' >&2; exit 1; }
(cd oskhs && bun test) || { echo 'test-all: oskhs suite failed' >&2; exit 1; }
echo 'test-all: shell, conformance, core, bridge, dashboard, and oskhs (with MongoDB) suites passed'
