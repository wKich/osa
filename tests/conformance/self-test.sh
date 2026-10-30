#!/bin/sh
# Self-test for the conformance harness.
#
# Proves the properties the suite relies on:
#   1. incidental data (case path, work path, timestamps, sandbox ids) is
#      normalized away, so two runs of one case compare identically;
#   2. a real argv change (added, removed, reordered, or an env name change)
#      still differs after normalization, so normalization cannot hide it;
#   3. a backend that moves a fixture credential into argv fails the leak scan,
#      while the real front-ends pass it.
#
# Run it directly or with `make test-conformance-self`:
#
#   tests/conformance/self-test.sh

set -eu

HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
ROOT=$(CDPATH='' cd -- "$HERE/../.." && pwd -P)
# shellcheck source=tests/conformance/normalize.sh disable=SC1091
. "$HERE/normalize.sh"

FAIL=0
CASE_A=/tmp/osa-self-a
CASE_B=/var/tmp/osa-self-b
WORK_A=/tmp/osa-self-work-a
WORK_B=/var/tmp/osa-self-work-b
REPO=/repo

check_same() { # NAME A B
    if [ "$2" != "$3" ]; then
        printf 'FAIL %s: expected identical after normalization\n' "$1"
        printf -- '  a: %s\n  b: %s\n' "$2" "$3"
        FAIL=$((FAIL + 1))
    else
        printf 'ok   %s\n' "$1"
    fi
}

check_diff() { # NAME A B
    if [ "$2" = "$3" ]; then
        printf 'FAIL %s: normalization hid a real change\n' "$1"
        FAIL=$((FAIL + 1))
    else
        printf 'ok   %s\n' "$1"
    fi
}

recording() { # CASE WORK SANDBOX ARG...
    rc_case=$1
    rc_work=$2
    rc_sandbox=$3
    shift 3
    {
        printf -- '---\n'
        printf 'sandbox\ncreate\n--name\nmaki-app\n'
        printf '%s/project\n' "$rc_case"
        printf '%s/out\n' "$rc_work"
        printf '%s\n' "$rc_sandbox"
        printf '2026-10-30 09:22:11\n'
        printf '1793885131000\n'
        for rc_arg in "$@"; do
            printf '%s\n' "$rc_arg"
        done
        printf '@env MAKI_OSS_SANDBOX_NAME\n@env FIXTURE_KEY\n'
    } | conformance_normalize "$rc_case" "$rc_work" "$REPO"
}

base=$(recording "$CASE_A" "$WORK_A" id-maki-app-1-11 alpha beta)
other=$(recording "$CASE_B" "$WORK_B" id-maki-app-9-99 alpha beta)
check_same "incidental paths, ids, and timestamps normalize away" "$base" "$other"
check_same "normalization is idempotent on itself" "$base" \
    "$(printf '%s\n' "$base" | conformance_normalize "$CASE_A" "$WORK_A" "$REPO")"

check_diff "an added argument still differs" "$base" \
    "$(recording "$CASE_A" "$WORK_A" id-maki-app-1-11 alpha beta gamma)"
check_diff "a removed argument still differs" "$base" \
    "$(recording "$CASE_A" "$WORK_A" id-maki-app-1-11 alpha)"
check_diff "a reordered argument still differs" "$base" \
    "$(recording "$CASE_A" "$WORK_A" id-maki-app-1-11 beta alpha)"
check_diff "a renamed argument still differs" "$base" \
    "$(recording "$CASE_A" "$WORK_A" id-maki-app-1-11 alpha bet)"
check_diff "a changed env name still differs" "$base" \
    "$(recording "$CASE_A" "$WORK_A" id-maki-app-1-11 alpha beta | sed 's/FIXTURE_KEY/OTHER_KEY/')"
check_diff "an env line becoming argv still differs" "$base" \
    "$(printf '%s\n' "$base" | sed 's/@env FIXTURE_KEY/FIXTURE_KEY/')"

# A leak scan that cannot fail is not a gate. Run one credentialed case with a
# backend that moves the fixture credential into argv, then with the real one.
leak_bin=$(mktemp -d "${TMPDIR:-/tmp}/osa-leak.XXXXXX")
trap 'rm -rf "$leak_bin"' EXIT
ln -s "$HERE/backends/leaky.sh" "$leak_bin/openshell"

leak_output=$(
    OSA_CONFORMANCE_PATH=$leak_bin \
    OSA_CONFORMANCE_REAL_STUB=$ROOT/tests/stub/openshell \
    OSA_CONFORMANCE_LEAK_ENV=FIXTURE_KEY \
    RUN_ONLY=test_conf_maki_credential \
    KEEP_WORK=0 \
        "$ROOT/tests/run-tests.sh" 2>&1
) && leak_rc=0 || leak_rc=$?
case $leak_output in
    *"fixture credential value reached recorded argv position"*)
        if [ "$leak_rc" -ne 0 ]; then
            printf 'ok   leaky backend fails the case at the recorded argument position\n'
        else
            printf 'FAIL leaky backend was reported but the suite exited 0\n'
            FAIL=$((FAIL + 1))
        fi
        ;;
    *)
        printf 'FAIL leaky backend was not caught (rc %s)\n' "$leak_rc"
        printf '%s\n' "$leak_output" | sed 's/^/     /'
        FAIL=$((FAIL + 1))
        ;;
esac

if RUN_ONLY=test_conf_maki_credential KEEP_WORK=0 \
    "$ROOT/tests/run-tests.sh" >/dev/null 2>&1; then
    printf 'ok   the real front-end passes the same case\n'
else
    printf 'FAIL the real front-end failed the credentialed case\n'
    FAIL=$((FAIL + 1))
fi

if [ "$FAIL" -ne 0 ]; then
    printf '\n%d conformance self-test check(s) failed\n' "$FAIL"
    exit 1
fi
printf '\nconformance self-test passed\n'
