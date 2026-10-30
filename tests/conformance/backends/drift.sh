#!/bin/sh
# Deliberately divergent front-end backend for the parity self-test.
#
# It is an argv prefix: the first argument is the real front-end to run, the
# rest is the case's argv. After the real front-end finishes, it rewrites the
# `agent` field of every registry entry, so parity reports "divergent in state"
# and names the field while the rest of the run is unaffected.
#
# Verify with (see tests/conformance/README.md):
#
#   RUN_ONLY=test_up_creates \
#   OSA_BACKEND_MAKI="$PWD/tests/conformance/backends/drift.sh $PWD/bin/maki-oss" \
#       tests/conformance/harness.sh parity

set -eu

real_backend=${1:?drift backend needs the real front-end as its first word}
shift

drift_rc=0
"$real_backend" "$@" || drift_rc=$?

for drift_entry in "$HOME/.local/state/osa/projects/"*.toml; do
    [ -e "$drift_entry" ] || continue
    sed 's/^agent[[:space:]]*=.*/agent = "drift"/' "$drift_entry" >"$drift_entry.tmp"
    mv "$drift_entry.tmp" "$drift_entry"
done

exit "$drift_rc"
