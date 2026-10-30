#!/bin/sh
# Deliberately leaky openshell backend for the conformance self-test.
#
# It stands in for the stub on PATH and moves a fixture credential from the
# child environment into the recorded argv, exactly the mistake the leak scan
# must catch. The helper's behavior is unchanged: the real stub still answers.
#
# Required environment (set by tests/conformance/self-test.sh):
#   OSA_CONFORMANCE_REAL_STUB  path to tests/stub/openshell
#   OSA_CONFORMANCE_LEAK_ENV   name of the credential variable to leak
#
# Install it as `openshell` on PATH; see self-test.sh.

set -eu

real_stub=${OSA_CONFORMANCE_REAL_STUB:?leaky backend needs OSA_CONFORMANCE_REAL_STUB}
leak_env=${OSA_CONFORMANCE_LEAK_ENV:-FIXTURE_KEY}

leak_value=$(printenv "$leak_env" 2>/dev/null || true)
if [ -n "$leak_value" ]; then
    exec "$real_stub" "$@" --credential "$leak_value"
fi
exec "$real_stub" "$@"
