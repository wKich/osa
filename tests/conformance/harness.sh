#!/bin/sh
# Conformance harness for the helper <-> OpenShell seam.
#
# Sourced by tests/run-tests.sh, which tells the harness where each case
# starts and ends. Per case the harness records what crossed the seam (argv and
# environment names only, normalized), the state tree digest, and the captured
# exit status and output, then compares the recording against a committed
# golden when one exists.
#
# Modes:
#   default   run every case, compare goldens that exist, report unrecorded
#   record    OSA_CONFORMANCE_RECORD=1: rewrite goldens and list each one
#   parity    `harness.sh parity`: run the case set twice, two artifact trees,
#             and print one verdict per case (a manual, documented invocation)
#
# Knobs:
#   OSA_CONFORMANCE=0            disable the harness entirely
#   OSA_CONFORMANCE_RECORD=1     record mode (the only mode that writes)
#   OSA_CONFORMANCE_COMPARE=0    do not compare goldens
#   OSA_CONFORMANCE_STRICT=1     fail an unrecorded case not in excluded.txt
#   OSA_CONFORMANCE_ARTIFACTS=D  artifact root (default: $WORK/conformance)
#   OSA_BACKEND_<FRONTEND>_2     parity's second backend for a front-end
#   OSA_PARITY_TRANSPORT=cli     parity's second run selects the CLI transport
#                                (the first always uses the typed client)
#   OSA_PARITY_RUN_ONLY=<glob>   parity runs only the matching cases
#
# Transport: a case declares the transport its converted operation family uses
# with `conformance_transport client` (the suite's `new_case` declares `client`
# for the converted common path). The gateway stub writes every client request
# to `<case>/client-requests.log`, so the harness observes the transport the
# backend actually used and fails a case that declared `cli` while the backend
# used the client. The other direction is left to the golden: a declared-client
# case that never reaches the gateway records no client section.
#
# Goldens live one file per case and transport in
# tests/conformance/golden/<transport>/<case>.log. A case id is
# `<test function>__<case directory>`. A case with no golden for its declared
# transport is recorded without being compared;
# tests/conformance/excluded.txt documents the cases that intentionally have
# none and why.
#
# Recording format: the first line is `@transport <observed>`; the stub
# `openshell` invocations follow as argv blocks; a `@client` line and one line
# per client request follow when the backend used the typed client. Block order
# inside the CLI section is the order the stub saw; the client section is
# appended because the two seams are separate processes.
#
# Review rule: a golden may only contain data that crosses a process boundary
# (the argv/env names the stub saw). Anything else belongs in a case body's own
# assertion.

CONFORMANCE_HOME=${CONFORMANCE_HOME:-$ROOT/tests/conformance}
CONFORMANCE_GOLDEN=$CONFORMANCE_HOME/golden
CONFORMANCE_EXCLUDED=$CONFORMANCE_HOME/excluded.txt
CONFORMANCE_ACTIVE=0
CONFORMANCE_TEST=
CONFORMANCE_TRANSPORT=cli
CONFORMANCE_CASE_ID=
CONFORMANCE_CASE_DIR=
CONFORMANCE_OUTPUT_LOG=
CONFORMANCE_RECORDED=0
CONFORMANCE_UNRECORDED=0
CONFORMANCE_MISMATCH=0
CONFORMANCE_FAIL=0
CONFORMANCE_EXCLUDED_COUNT=0

conformance_enabled() {
    [ "${OSA_CONFORMANCE:-1}" != 0 ]
}

conformance_record_mode() {
    [ "${OSA_CONFORMANCE_RECORD:-0}" = 1 ]
}

# Declare the transport the case exercises. Called from a case body after
# new_case; unset means `cli`, the transport every unconverted case still uses.
conformance_transport() { # cli|client
    case $1 in
        cli | client) CONFORMANCE_TRANSPORT=$1 ;;
        *) bad "conformance: unknown transport '$1' (use cli or client)" ;;
    esac
}

# The transport the backend actually used: the gateway stub only records a
# request when the typed client made one.
conformance_observed_transport() {
    if [ -s "${CASE:-}/client-requests.log" ]; then
        printf 'client\n'
    else
        printf 'cli\n'
    fi
}

conformance_golden_path() {
    printf '%s/%s/%s.log\n' \
        "$CONFORMANCE_GOLDEN" "$CONFORMANCE_TRANSPORT" "$CONFORMANCE_CASE_ID"
}

conformance_sanitize() { # TEXT
    printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_' | sed 's/_*$//'
}

conformance_normalize_stream() { # FILE
    conformance_normalize "$CASE" "$WORK" "$ROOT" <"$1" 2>/dev/null || true
}

conformance_hash() { # TEXT
    printf '%s' "$1" | cksum | awk '{ print $1 "-" $2 }'
}

conformance_excluded() { # CASE-ID
    [ -f "$CONFORMANCE_EXCLUDED" ] || return 1
    sed -e 's/[[:space:]].*$//' -e '/^#/d' -e '/^$/d' "$CONFORMANCE_EXCLUDED" \
        | grep -Fxq -- "$1"
}

# Called at the top of new_case: close the previous case, then open this one.
conformance_case_begin() { # CASE-NAME
    conformance_enabled || return 0
    conformance_case_end
    CONFORMANCE_TEST=${CONFORMANCE_TEST:-unknown}
    CONFORMANCE_CASE_ID="$(conformance_sanitize "$CONFORMANCE_TEST")__$(conformance_sanitize "$1")"
    CONFORMANCE_CASE_DIR=${OSA_CONFORMANCE_ARTIFACTS:-$WORK/conformance}/$CONFORMANCE_CASE_ID
    CONFORMANCE_OUTPUT_LOG=$CONFORMANCE_CASE_DIR/output.log
    mkdir -p "$CONFORMANCE_CASE_DIR"
    : >"$CONFORMANCE_OUTPUT_LOG"
    # Every case starts on the CLI transport; a case that exercises a converted
    # operation family declares `client` before its first run.
    CONFORMANCE_TRANSPORT=cli
    CONFORMANCE_ACTIVE=1
}

# Called after each backend run, so parity compares every exit status and
# every byte of output, not only the last one.
conformance_capture_run() { # RC STDOUT-FILE STDERR-FILE
    conformance_enabled || return 0
    [ "$CONFORMANCE_ACTIVE" = 1 ] || return 0
    {
        printf '=== run rc=%s\n' "$1"
        printf '%s\n' '--- stdout'
        conformance_normalize_stream "$2"
        printf '%s\n' '--- stderr'
        conformance_normalize_stream "$3"
    } >>"$CONFORMANCE_OUTPUT_LOG"
}

# Sorted state-root-relative paths with per-field content hashes. Values are
# hashed, never printed, so the digest can name a changed field without
# carrying a credential.
conformance_state_digest() { # OUT-FILE
    {
        for conformance_pair in "helper:$HOME/.local/state" "gateway:$STUB_STATE_DIR"; do
            conformance_label=${conformance_pair%%:*}
            conformance_base=${conformance_pair#*:}
            [ -n "$conformance_base" ] || continue
            [ -d "$conformance_base" ] || continue
            find "$conformance_base" -type f -print | LC_ALL=C sort \
                | while IFS= read -r conformance_file; do
                    conformance_rel=${conformance_file#"$conformance_base"/}
                    # Path names carry the same incidental data as contents
                    # (patch timestamps, pids), so normalize them too.
                    conformance_rel=$(printf '%s\n' "$conformance_rel" \
                        | conformance_normalize "$CASE" "$WORK" "$ROOT")
                    conformance_content=$(conformance_normalize_stream "$conformance_file")
                    if printf '%s\n' "$conformance_content" | grep -Eq '^[A-Za-z_][A-Za-z0-9_.-]*[[:space:]]*='; then
                        printf '%s\n' "$conformance_content" \
                            | while IFS= read -r conformance_line; do
                                conformance_key=$(printf '%s\n' "$conformance_line" \
                                    | sed -n 's/^\([A-Za-z_][A-Za-z0-9_.-]*\)[[:space:]]*=.*/\1/p')
                                [ -n "$conformance_key" ] || conformance_key=-
                                printf '%s/%s %s %s\n' "$conformance_label" \
                                    "$conformance_rel" "$conformance_key" \
                                    "$(conformance_hash "$conformance_line")"
                            done
                    else
                        printf '%s/%s - %s\n' "$conformance_label" "$conformance_rel" \
                            "$(conformance_hash "$conformance_content")"
                    fi
                done
        done
    } >"$1"
}

# Fails the case when a fixture credential value reaches the recording, the
# state tree, or the captured output. Values come from the stub's credential
# log: exactly the values the helper put in the openshell child environment.
conformance_leak_scan() { # CASE-ARTIFACT-DIR
    [ -n "${CREDENTIAL_LOG:-}" ] && [ -f "$CREDENTIAL_LOG" ] || return 0
    conformance_leaks=0
    while IFS= read -r conformance_secret; do
        [ -n "$conformance_secret" ] || continue

        if [ -f "$1/recording.log" ]; then
            conformance_hits=$(grep -nF -- "$conformance_secret" "$1/recording.log" 2>/dev/null || true)
            if [ -n "$conformance_hits" ]; then
                conformance_line=${conformance_hits%%:*}
                conformance_pos=$(awk -v want="$conformance_line" '
                    NR <= want {
                        if ($0 == "---") { pos = 0 } else { pos++ }
                    }
                    NR == want { print pos; exit }
                ' "$1/recording.log")
                bad "conformance: fixture credential value reached recorded argv position ${conformance_pos:-?}"
                CONFORMANCE_FAIL=$((CONFORMANCE_FAIL + 1))
                conformance_leaks=$((conformance_leaks + 1))
            fi
        fi

        if [ -f "$1/output.log" ] && grep -qF -- "$conformance_secret" "$1/output.log" 2>/dev/null; then
            bad "conformance: fixture credential value reached the captured output"
            CONFORMANCE_FAIL=$((CONFORMANCE_FAIL + 1))
            conformance_leaks=$((conformance_leaks + 1))
        fi

        # The helper's own state root only: the Maki/OpenCode auth stores beside
        # it legitimately hold the fixture credential this case reads.
        for conformance_state in "$HOME/.local/state/osa" "${STUB_STATE_DIR:-}"; do
            [ -n "$conformance_state" ] && [ -d "$conformance_state" ] || continue
            conformance_state_hits=$(grep -rlF -- "$conformance_secret" "$conformance_state" 2>/dev/null || true)
            if [ -n "$conformance_state_hits" ]; then
                bad "conformance: fixture credential value reached state: $(printf '%s\n' "$conformance_state_hits" | sed 's|.*/||' | head -n 1)"
                CONFORMANCE_FAIL=$((CONFORMANCE_FAIL + 1))
                conformance_leaks=$((conformance_leaks + 1))
            fi
        done
    done <"$CREDENTIAL_LOG"
    [ "$conformance_leaks" -eq 0 ]
}

conformance_case_end() {
    [ "$CONFORMANCE_ACTIVE" = 1 ] || return 0
    CONFORMANCE_ACTIVE=0
    conformance_dir=$CONFORMANCE_CASE_DIR

    conformance_observed=$(conformance_observed_transport)
    {
        printf '@transport %s\n' "$conformance_observed"
        if [ -f "${STUB_LOG:-}" ]; then
            conformance_normalize_stream "${STUB_LOG}"
        fi
        if [ -s "${CASE:-}/client-requests.log" ]; then
            printf '%s\n' '@client'
            conformance_normalize "$CASE" "$WORK" "$ROOT" \
                <"$CASE/client-requests.log" 2>/dev/null || true
        fi
    } >"$conformance_dir/recording.log"
    printf '%s\n' "$conformance_observed" >"$conformance_dir/transport"
    conformance_state_digest "$conformance_dir/state.digest"
    printf '%s\n' "${RC:-0}" >"$conformance_dir/meta"

    conformance_leak_scan "$conformance_dir" || true

    # A case that declares `cli` must not have reached the typed client. The
    # other direction is left to the golden: a declared-client case that never
    # reaches the gateway produces no client section, and its golden names
    # that. Failing it here would flag every usage-error case instead.
    if [ "$conformance_observed" = client ] && [ "$CONFORMANCE_TRANSPORT" = cli ]; then
        CONFORMANCE_FAIL=$((CONFORMANCE_FAIL + 1))
        bad "conformance: case declares the cli transport but the backend used client"
    fi

    # An excluded case never gets a golden: its recording is kept as an
    # artifact for inspection, but the suite cannot compare it byte-for-byte.
    if conformance_excluded "$CONFORMANCE_CASE_ID"; then
        CONFORMANCE_UNRECORDED=$((CONFORMANCE_UNRECORDED + 1))
        CONFORMANCE_EXCLUDED_COUNT=$((CONFORMANCE_EXCLUDED_COUNT + 1))
        return 0
    fi

    conformance_golden=$(conformance_golden_path)
    if conformance_record_mode; then
        mkdir -p "${conformance_golden%/*}"
        if [ -f "$conformance_golden" ] \
            && cmp -s "$conformance_golden" "$conformance_dir/recording.log"; then
            printf 'golden: unchanged %s\n' "$CONFORMANCE_CASE_ID"
        else
            cp "$conformance_dir/recording.log" "$conformance_golden"
            printf 'golden: recorded %s (%s transport)\n' \
                "$CONFORMANCE_CASE_ID" "$CONFORMANCE_TRANSPORT"
        fi
        return 0
    fi

    if [ -f "$conformance_golden" ] && [ "${OSA_CONFORMANCE_COMPARE:-1}" != 0 ]; then
        CONFORMANCE_RECORDED=$((CONFORMANCE_RECORDED + 1))
        if ! cmp -s "$conformance_golden" "$conformance_dir/recording.log"; then
            CONFORMANCE_MISMATCH=$((CONFORMANCE_MISMATCH + 1))
            CONFORMANCE_FAIL=$((CONFORMANCE_FAIL + 1))
            bad "conformance: recording differs from golden tests/conformance/golden/$CONFORMANCE_TRANSPORT/$CONFORMANCE_CASE_ID.log"
            diff -u "$conformance_golden" "$conformance_dir/recording.log" 2>/dev/null \
                | sed 's/^/     /' || true
        fi
    else
        CONFORMANCE_UNRECORDED=$((CONFORMANCE_UNRECORDED + 1))
        if [ "${OSA_CONFORMANCE_STRICT:-0}" = 1 ]; then
            CONFORMANCE_FAIL=$((CONFORMANCE_FAIL + 1))
            bad "conformance: case has no golden and is not in tests/conformance/excluded.txt"
        fi
    fi
}

conformance_report() {
    conformance_enabled || return 0
    conformance_case_end
    if [ -n "${OSA_CONFORMANCE_REPORT:-}" ]; then
        if [ "$CONFORMANCE_FAIL" -eq 0 ]; then
            printf 'ok\n' >"$OSA_CONFORMANCE_REPORT"
        else
            printf 'failed %d\n' "$CONFORMANCE_FAIL" >"$OSA_CONFORMANCE_REPORT"
        fi
    fi
    if conformance_record_mode; then
        printf '\nconformance: record mode; goldens written under tests/conformance/golden/\n'
        return 0
    fi
    printf '\nconformance: %d compared, %d unrecorded (%d excluded), %d mismatched\n' \
        "$CONFORMANCE_RECORDED" "$CONFORMANCE_UNRECORDED" \
        "$CONFORMANCE_EXCLUDED_COUNT" "$CONFORMANCE_MISMATCH"
    if [ "${OSA_CONFORMANCE_STRICT:-0}" = 1 ]; then
        printf 'conformance: strict mode; every unrecorded case must be excluded\n'
    fi
}

# ---------------------------------------------------------------------------
# Parity: run the same case set twice, compare the artifact trees per case.
# ---------------------------------------------------------------------------

# One case's verdict from two artifact directories. State and output decide
# first: a conversion must produce the same effects whatever transport carried
# the operations. A recording that differs only because the two backends used
# different transports is `transport-changed`, which is a pass.
conformance_parity_case_verdict() { # DIR-A DIR-B
    if [ ! -d "$2" ]; then
        printf '%s\n' "divergent in exit status or output (case missing from second run)"
        return 0
    fi
    if ! cmp -s "$1/meta" "$2/meta" || ! cmp -s "$1/output.log" "$2/output.log"; then
        printf '%s\n' "divergent in exit status or output"
        return 0
    fi
    if ! cmp -s "$1/state.digest" "$2/state.digest"; then
        printf '%s\n' "divergent in state"
        return 0
    fi
    if cmp -s "$1/recording.log" "$2/recording.log"; then
        printf '%s\n' identical
        return 0
    fi
    conformance_verdict_a=$(sed -n '1s/^@transport //p' "$1/recording.log" 2>/dev/null || true)
    conformance_verdict_b=$(sed -n '1s/^@transport //p' "$2/recording.log" 2>/dev/null || true)
    if [ -n "$conformance_verdict_a" ] && [ -n "$conformance_verdict_b" ] \
        && [ "$conformance_verdict_a" != "$conformance_verdict_b" ]; then
        printf '%s\n' transport-changed
    else
        printf '%s\n' "divergent in recording"
    fi
}

conformance_parity_run() {
    set -eu
    conformance_parity_tmp=$(mktemp -d "${TMPDIR:-/tmp}/osa-parity.XXXXXX")
    conformance_parity_a=$conformance_parity_tmp/a
    conformance_parity_b=$conformance_parity_tmp/b
    mkdir -p "$conformance_parity_a" "$conformance_parity_b"

    conformance_parity_status_a=0
    conformance_parity_status_b=0

    # The first run always uses the typed client, even if the caller's
    # environment selects the CLI: parity must compare client against CLI.
    OSA_CONFORMANCE_ARTIFACTS=$conformance_parity_a \
    OSA_CONFORMANCE_COMPARE=0 \
    RUN_ONLY=${OSA_PARITY_RUN_ONLY:-} \
        env -u OSA_GATEWAY_TRANSPORT "$ROOT/tests/run-tests.sh" \
        || conformance_parity_status_a=$?

    OSA_CONFORMANCE_ARTIFACTS=$conformance_parity_b \
    OSA_CONFORMANCE_COMPARE=0 \
    OSA_BACKEND_OSA=${OSA_BACKEND_OSA_2:-$OSA} \
    OSA_BACKEND_MAKI=${OSA_BACKEND_MAKI_2:-$MAKI} \
    OSA_BACKEND_OPENCODE=${OSA_BACKEND_OPENCODE_2:-$OC} \
    OSA_BACKEND_CLAUDE=${OSA_BACKEND_CLAUDE_2:-$CLAUDE} \
    OSA_BACKEND_CODEX=${OSA_BACKEND_CODEX_2:-$CODEX} \
    RUN_ONLY=${OSA_PARITY_RUN_ONLY:-} \
    OSA_GATEWAY_TRANSPORT=${OSA_PARITY_TRANSPORT:-} \
        "$ROOT/tests/run-tests.sh" || conformance_parity_status_b=$?

    conformance_parity_divergent=0

    for conformance_parity_case in "$conformance_parity_a"/*; do
        [ -e "$conformance_parity_case" ] || continue
        conformance_parity_id=${conformance_parity_case##*/}
        conformance_parity_other=$conformance_parity_b/$conformance_parity_id
        if conformance_excluded "$conformance_parity_id"; then
            printf 'excluded   %s\n' "$conformance_parity_id"
            continue
        fi
        conformance_parity_verdict=$(conformance_parity_case_verdict \
            "$conformance_parity_case" "$conformance_parity_other")
        if [ "$conformance_parity_verdict" = identical ]; then
            printf 'identical  %s\n' "$conformance_parity_id"
        elif [ "$conformance_parity_verdict" = transport-changed ]; then
            # A pass: the same effects arrived over a different transport.
            printf 'transport-changed  %s (%s -> %s)\n' "$conformance_parity_id" \
                "$(sed -n '1s/^@transport //p' "$conformance_parity_case/recording.log" 2>/dev/null)" \
                "$(sed -n '1s/^@transport //p' "$conformance_parity_other/recording.log" 2>/dev/null)"
        else
            conformance_parity_divergent=$((conformance_parity_divergent + 1))
            printf '%s  %s\n' "$conformance_parity_verdict" "$conformance_parity_id"
            if [ "$conformance_parity_verdict" = "divergent in exit status or output" ] \
                && [ -d "$conformance_parity_other" ]; then
                diff -u "$conformance_parity_case/output.log" "$conformance_parity_other/output.log" \
                    2>/dev/null | grep '^[-+]' | grep -v '^---\|^+++' | sed 's/^/     /' || true
            elif [ "$conformance_parity_verdict" = "divergent in state" ]; then
                diff -u "$conformance_parity_case/state.digest" "$conformance_parity_other/state.digest" \
                    2>/dev/null | grep '^[-+]' | grep -v '^---\|^+++' | sed 's/^/     /' || true
            elif [ "$conformance_parity_verdict" = "divergent in recording" ]; then
                diff -u "$conformance_parity_case/recording.log" "$conformance_parity_other/recording.log" \
                    2>/dev/null | grep '^[-+]' | grep -v '^---\|^+++' | sed 's/^/     /' || true
            fi
        fi
    done

    for conformance_parity_case in "$conformance_parity_b"/*; do
        [ -e "$conformance_parity_case" ] || continue
        conformance_parity_id=${conformance_parity_case##*/}
        if [ ! -d "$conformance_parity_a/$conformance_parity_id" ]; then
            if conformance_excluded "$conformance_parity_id"; then
                continue
            fi
            conformance_parity_divergent=$((conformance_parity_divergent + 1))
            printf 'divergent in exit status or output (case missing from first run)  %s\n' \
                "$conformance_parity_id"
        fi
    done

    if [ "$conformance_parity_divergent" -ne 0 ]; then
        printf '\nparity: %d case(s) diverged; suite statuses: first=%s second=%s\n' \
            "$conformance_parity_divergent" "$conformance_parity_status_a" \
            "$conformance_parity_status_b"
        rm -rf "$conformance_parity_tmp"
        return 1
    fi
    printf '\nparity: every case identical or transport-changed; suite statuses: first=%s second=%s\n' \
        "$conformance_parity_status_a" "$conformance_parity_status_b"
    rm -rf "$conformance_parity_tmp"
    return 0
}

if [ "${0##*/}" = harness.sh ]; then
    case ${1:-} in
        parity)
            # Resolve the first-run backends from the same variables the suite
            # uses, without running the suite's setup twice.
            ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)
            CONFORMANCE_HOME=$ROOT/tests/conformance
            CONFORMANCE_GOLDEN=$CONFORMANCE_HOME/golden
            CONFORMANCE_EXCLUDED=$CONFORMANCE_HOME/excluded.txt
            . "$ROOT/tests/conformance/normalize.sh"
            osa_backend_parity() { # ENV-NAME DEFAULT
                eval "osa_backend_parity_value=\${$1-}"
                printf '%s\n' "${osa_backend_parity_value:-$2}"
            }
            OSA=$(osa_backend_parity OSA_BACKEND_OSA "$ROOT/bin/osa")
            MAKI=$(osa_backend_parity OSA_BACKEND_MAKI "$ROOT/bin/maki-oss")
            OC=$(osa_backend_parity OSA_BACKEND_OPENCODE "$ROOT/bin/opencode-oss")
            CLAUDE=$(osa_backend_parity OSA_BACKEND_CLAUDE "$ROOT/bin/claude-oss")
            CODEX=$(osa_backend_parity OSA_BACKEND_CODEX "$ROOT/bin/codex-oss")
            conformance_parity_run
            ;;
        *)
            printf 'usage: %s parity\n' "$0" >&2
            exit 2
            ;;
    esac
fi
