#!/bin/sh
# End-to-end suite for the four front-ends against the in-sandbox control
# plane (local) or a real gateway (host).
#
# What a pass proves: session orchestration, caller-mode sync, lifecycle, and
# pending work. What it does not prove: isolation, policy, egress, or
# credential brokering. The scope line prints on every run, passing or failing;
# the claim table is docs/ai/verification/claims.md.
#
# Modes:
#   local   run inside an osa sandbox against the insandbox plane (default)
#           (make test-e2e-local; use scripts/build-e2e.sh first)
#   host    run on a host against a real gateway (make test-e2e)
#   record  host plus OSA_E2E_RECORD=1: rewrite tests/e2e/recordings/
#
# Knobs:
#   RUN_ONLY=<glob>[,<glob>]   run the matching case functions only
#   OSA_E2E_BIN_DIR=DIR        test-support binaries (default:
#                              osa-core/target/e2e/release)
#   OSA_E2E_FRONTEND=NAME      default front-end (maki-oss, opencode-oss, ...)
#   OSA_E2E_PROVIDER=NAME      provider to configure and require (e2e-noop)
#   OSA_E2E_IMAGE=REF          image for the created sandbox (osa-dev:local)
#   OSA_E2E_ENGINE=NAME        container engine for host mode (docker)
#   OSA_E2E_TLS_DIR=DIR        client certificate directory for host mode
#   OSA_E2E_IDLE_FRONTEND=NAME front-end for the idle-stop case (claude-oss)
#   OSA_E2E_REAL_AGENT=1       opt into the advisory real-agent turn
#   OSA_E2E_REAL_AGENT_PROVIDER=NAME  a real model provider for that turn
#   KEEP_WORK=1                keep the temporary case trees
#
# POSIX sh only, like the rest of the suite. It never reads a credential value.
#
# The case bodies live in the sourced cases.sh, so this file's helpers look
# uncalled to a per-file check and the cases' test_* functions look uncalled in
# turn. Both are invoked through the sourced file and RUN_ONLY's dispatcher.
# shellcheck disable=SC2329
set -u

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)
. "$ROOT/tests/conformance/normalize.sh"
. "$ROOT/tests/e2e/parity.sh"

MODE=${1:-${OSA_E2E_MODE:-local}}
case $MODE in
    local | host | record) ;;
    *)
        printf 'usage: %s [local|host|record]\n' "$0" >&2
        exit 2
        ;;
esac
if [ "$MODE" = record ]; then
    OSA_E2E_RECORD=1
fi

E2E_BIN_DIR=${OSA_E2E_BIN_DIR:-$ROOT/osa-core/target/e2e/release}
E2E_IMAGE=${OSA_E2E_IMAGE:-osa-dev:local}
E2E_PROVIDER=${OSA_E2E_PROVIDER:-e2e-noop}
E2E_ENGINE=${OSA_E2E_ENGINE:-docker}
DEFAULT_FRONTEND=${OSA_E2E_FRONTEND:-maki-oss}
RECORDINGS=$ROOT/tests/e2e/recordings
EXCLUDED_FILE=$ROOT/tests/e2e/excluded.txt
AGENT_FIXTURES=$ROOT/tests/e2e/fixtures/agents
DOCKER_FIXTURE_DIR=$ROOT/tests/e2e/fixtures/bin
SANDBOX_PATH=/sandbox/.e2e/bin:/usr/local/bin:/usr/bin:/bin

WORK=$(mktemp -d "${TMPDIR:-/tmp}/osa-e2e.XXXXXX") || exit 2
WORK=$(CDPATH='' cd -- "$WORK" && pwd -P)
# Sandbox names carry this run's suffix: a gateway may keep a deleted
# sandbox's /sandbox, and a reused name would inherit a baseline from an
# earlier case or run. The suffix keeps every case's filesystem fresh.
RUN_ID=$(basename "$WORK" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')
CASE_NUM=0
CURRENT=
CASE=
PROJECT=
SANDBOX=
E2E_SANDBOXES=
FRONT_BIN=
AGENT_COMMAND=
PARITY_ASSERTIONS=1
CASE_FAILED=0
CASE_SKIPPED=0
CASE_NA=0
CASE_ADVISORY=0
CASE_ADVISORY_FAILED=0
LAST_RC=0
LAST_OUT=
LAST_ERR=

PASS=0
FAIL=0
SKIP=0
NA=0
ADVISORY=0
EXCLUDED=0
RECORDED=0
COMPARED=0
DIVERGED=0
UNRECORDED=0
SCOPE_PRINTED=0
TEARDOWN_FAILED=0
PLANE_PID=
PLANE_SERVER=
PLANE_PORT=
PLANE_STATE=
E2E_HOST=0
E2E_TLS_DIR=${OSA_E2E_TLS_DIR:-}
E2E_REAL_CONFIG=${XDG_CONFIG_HOME:-$HOME/.config}

. "$ROOT/tests/e2e/cases.sh"

# ---------------------------------------------------------------------------
# Output contract
# ---------------------------------------------------------------------------

print_scope() {
    printf '%s\n' \
        'e2e scope: orchestration (sessions, caller sync, lifecycle, pending work) is covered.' \
        'e2e scope: isolation, policy, egress, and credential brokering are NOT covered.'
    SCOPE_PRINTED=1
}

# RUN_ONLY=<glob>[,<glob>] selects case functions; names are global.
run_only_matches() { # TEST-NAME
    [ -n "${RUN_ONLY:-}" ] || return 0
    case $RUN_ONLY in
        *,*)
            e2e_hit=0
            for e2e_pattern in $(printf '%s' "$RUN_ONLY" | tr ',' ' '); do
                # shellcheck disable=SC2254  # the patterns are globs on purpose
                case $1 in
                    $e2e_pattern) e2e_hit=1 ;;
                esac
            done
            [ "$e2e_hit" = 1 ]
            return
            ;;
    esac
    # shellcheck disable=SC2254  # RUN_ONLY is a glob on purpose
    case $1 in
        $RUN_ONLY) return 0 ;;
        *) return 1 ;;
    esac
}

# ---------------------------------------------------------------------------
# Assertions and case verdicts
# ---------------------------------------------------------------------------

case_fail() { # MESSAGE
    CASE_FAILED=1
    printf 'FAIL %s: %s\n' "$CURRENT" "$1"
}

case_pass() { # LABEL
    printf '%s=ok\n' "$1" >>"$ASSERTIONS"
}

skipped() { # REASON
    CASE_SKIPPED=1
    SKIP_REASON=$1
}

not_applicable() { # REASON
    CASE_NA=1
    NA_REASON=$1
}

advisory() { # REASON
    CASE_ADVISORY=1
    # shellcheck disable=SC2034  # read by run_case when it reports the case
    ADVISORY_REASON=$1
}

advisory_failed() { # MESSAGE
    CASE_ADVISORY_FAILED=1
    printf 'advisory %s: %s\n' "$CURRENT" "$1"
}

assert_rc() { # LABEL EXPECTED ACTUAL
    if [ "$2" = "$3" ]; then
        case_pass "$1"
    else
        case_fail "$1: expected exit $2, got $3"
    fi
}

assert_eq() { # LABEL EXPECTED ACTUAL
    if [ "$2" = "$3" ]; then
        case_pass "$1"
    else
        case_fail "$1: expected '$2', got '$3'"
    fi
}

assert_file() { # LABEL FILE
    if [ -f "$2" ]; then
        case_pass "$1"
    else
        case_fail "$1: $2 is missing"
    fi
}

assert_absent() { # LABEL FILE
    if [ -e "$2" ]; then
        case_fail "$1: $2 exists"
    else
        case_pass "$1"
    fi
}

assert_empty_file() { # LABEL FILE
    if [ -f "$2" ] && [ ! -s "$2" ]; then
        case_pass "$1"
    else
        case_fail "$1: $2 is missing or not empty"
    fi
}

assert_nonempty_file() { # LABEL FILE
    if [ -s "$2" ]; then
        case_pass "$1"
    else
        case_fail "$1: $2 is missing or empty"
    fi
}

assert_contains() { # LABEL FILE TEXT
    if grep -Fq -- "$3" "$2" 2>/dev/null; then
        case_pass "$1"
    else
        case_fail "$1: '$3' is not in $2"
    fi
}

assert_matches() { # LABEL FILE REGEX
    if grep -Eq -- "$3" "$2" 2>/dev/null; then
        case_pass "$1"
    else
        case_fail "$1: /$3/ does not match in $2"
    fi
}

assert_not_contains() { # LABEL FILE TEXT
    if grep -Fq -- "$3" "$2" 2>/dev/null; then
        case_fail "$1: '$3' is in $2"
    else
        case_pass "$1"
    fi
}

assert_git_clean() { # LABEL DIRECTORY
    if [ -z "$(git -C "$2" status --porcelain 2>/dev/null)" ]; then
        case_pass "$1"
    else
        case_fail "$1: $2 is not clean"
    fi
}

assert_sandbox_exists() { # LABEL NAME
    if status_exists "$2"; then
        case_pass "$1"
    else
        case_fail "$1: sandbox $2 is gone"
    fi
}

assert_sandbox_absent() { # LABEL NAME
    if status_exists "$2"; then
        case_fail "$1: sandbox $2 still exists"
    else
        case_pass "$1"
    fi
}

status_exists() { # NAME
    run_front status-check status --name "$1" >/dev/null 2>&1
    grep -Eq '^Exists:[[:space:]]+yes$' "$CASE/status-check.out"
}

# ---------------------------------------------------------------------------
# Case setup and front-end invocation
# ---------------------------------------------------------------------------

reset_frontend_env() {
    for e2e_prefix in MAKI_OSS OPENCODE_OSS CLAUDE_OSS CODEX_OSS; do
        eval "unset ${e2e_prefix}_WORKSPACE"
        eval "unset ${e2e_prefix}_SANDBOX_NAME"
        eval "export ${e2e_prefix}_IDLE_STOP=0"
        eval "export ${e2e_prefix}_PROVIDERS=\$E2E_PROVIDER"
        eval "export ${e2e_prefix}_IMAGE=\$E2E_IMAGE"
        eval "export ${e2e_prefix}_ACCOUNT_ID=e2e-account"
        if [ -n "$E2E_TLS_DIR" ]; then
            eval "export ${e2e_prefix}_TLS_DIR=\$E2E_TLS_DIR"
        else
            eval "unset ${e2e_prefix}_TLS_DIR"
        fi
    done
    export OSA_BACKEND_MAKI="$E2E_BIN_DIR/maki-oss"
    export OSA_BACKEND_OPENCODE="$E2E_BIN_DIR/opencode-oss"
    export OSA_BACKEND_CLAUDE="$E2E_BIN_DIR/claude-oss"
    export OSA_BACKEND_CODEX="$E2E_BIN_DIR/codex-oss"
    export OSA_CORE_BIN="$E2E_BIN_DIR/osa"
}

select_frontend() { # NAME
    FRONT_BIN=$E2E_BIN_DIR/$1
    case $1 in
        maki-oss) AGENT_COMMAND=maki ;;
        opencode-oss) AGENT_COMMAND=opencode ;;
        claude-oss) AGENT_COMMAND=claude ;;
        codex-oss) AGENT_COMMAND=codex ;;
        *) printf 'unknown front-end: %s\n' "$1" >&2 ;;
    esac
}

make_project() {
    mkdir -p "$PROJECT"
    (
        cd "$PROJECT" || exit 1
        git init -q
        git config user.email e2e@localhost
        git config user.name e2e
        printf 'before\n' >edited.md
        printf 'delete me\n' >deleted.txt
        printf 'base\n' >note.txt
        printf 'e2e project\n' >README.md
        git add -A
        git commit -qm base
    )
}

dirty_project() {
    printf 'dirty\n' >"$PROJECT/note.txt"
    printf 'untracked\n' >"$PROJECT/dirty.txt"
}

prepare_case() { # NAME
    CASE_NUM=$((CASE_NUM + 1))
    CASE=$WORK/cases/$CASE_NUM-$1
    PROJECT=$CASE/project
    HOME=$CASE/home
    export HOME
    XDG_CONFIG_HOME=$HOME/.config
    export XDG_CONFIG_HOME
    unset XDG_STATE_HOME
    mkdir -p "$CASE" "$HOME" "$XDG_CONFIG_HOME" "$CASE/transcripts"
    OSA_E2E_TRANSCRIPT_DIR=$CASE/transcripts
    export OSA_E2E_TRANSCRIPT_DIR
    if [ "$E2E_HOST" = 1 ]; then
        if [ -d "$E2E_REAL_CONFIG/openshell" ]; then
            ln -sfn "$E2E_REAL_CONFIG/openshell" "$XDG_CONFIG_HOME/openshell"
        fi
    fi
    reset_frontend_env
    select_frontend "$DEFAULT_FRONTEND"
    PARITY_ASSERTIONS=1
    CASE_FAILED=0
    CASE_SKIPPED=0
    CASE_NA=0
    CASE_ADVISORY=0
    CASE_ADVISORY_FAILED=0
    SANDBOX=
    E2E_SANDBOXES=
    ASSERTIONS=$CASE/assertions.log
    OUTCOME=$CASE/outcome.log
    : >"$ASSERTIONS"
    : >"$OUTCOME"
    make_project
}

new_sandbox() {
    SANDBOX=$(printf 'e2e-%02d-%s' "$CASE_NUM" "$RUN_ID")
    E2E_SANDBOXES="$E2E_SANDBOXES $SANDBOX"
    E2E_SANDBOXES=${E2E_SANDBOXES# }
    export E2E_SANDBOXES
    # A previous interrupted host recording may have left the name behind.
    # Delete it through the CLI, never through the front-end under test: this
    # setup step must not enter the case's operation transcript.
    if [ "$E2E_HOST" = 1 ]; then
        openshell sandbox delete "$SANDBOX" >/dev/null 2>&1 || true
    fi
}

run_front() { # LABEL ARG...
    e2e_label=$1
    shift
    (cd "$PROJECT" && "$FRONT_BIN" "$@") >"$CASE/$e2e_label.out" 2>"$CASE/$e2e_label.err"
    LAST_RC=$?
    LAST_OUT=$CASE/$e2e_label.out
    LAST_ERR=$CASE/$e2e_label.err
    capture_run "$e2e_label" "$LAST_RC" "$LAST_OUT" "$LAST_ERR"
    return "$LAST_RC"
}

run_osa() { # LABEL ARG...
    e2e_label=$1
    shift
    "$E2E_BIN_DIR/osa" "$@" >"$CASE/$e2e_label.out" 2>"$CASE/$e2e_label.err"
    LAST_RC=$?
    LAST_OUT=$CASE/$e2e_label.out
    LAST_ERR=$CASE/$e2e_label.err
    capture_run "$e2e_label" "$LAST_RC" "$LAST_OUT" "$LAST_ERR"
    return "$LAST_RC"
}

capture_run() { # LABEL RC OUT ERR
    {
        printf '=== %s rc=%s\n' "$1" "$2"
        printf '%s\n' '--- stdout'
        e2e_normalize "$CASE" "$WORK" "$ROOT" <"$3" 2>/dev/null || true
        printf '%s\n' '--- stderr'
        e2e_normalize "$CASE" "$WORK" "$ROOT" <"$4" 2>/dev/null || true
    } >>"$OUTCOME"
}

# The plane's shim is on PATH; the host's real openshell is on PATH.
sandbox_put() { # NAME LOCAL DEST
    openshell sandbox upload "$1" "$2" "$3" >/dev/null 2>&1
}

sandbox_read_file() { # NAME SANDBOX-PATH DEST
    if [ "$E2E_HOST" = 0 ]; then
        cp "$PLANE_STATE/sandboxes/$1/root$2" "$3" 2>/dev/null
    else
        openshell sandbox download "$1" "$2" "$3" >/dev/null 2>&1
    fi
}

sandbox_path_exists() { # NAME SANDBOX-PATH
    if [ "$E2E_HOST" = 0 ]; then
        [ -e "$PLANE_STATE/sandboxes/$1/root$2" ]
        return
    fi
    e2e_dest=$CASE/exists-$CASE_NUM
    rm -rf "$e2e_dest"
    mkdir -p "$e2e_dest"
    openshell sandbox download "$1" "$2" "$e2e_dest" >/dev/null 2>&1 \
        && [ -n "$(find "$e2e_dest" -mindepth 1 -print -quit 2>/dev/null)" ]
}

upload_agents() { # NAME
    # The plane's shim copies a directory's contents into the destination; the
    # real CLI always appends the source's name. Upload each script on the host
    # so both sides end with /sandbox/.e2e/bin/<agent> and nothing else.
    if [ "$E2E_HOST" = 0 ]; then
        sandbox_put "$1" "$AGENT_FIXTURES" /sandbox/.e2e/bin
    else
        for e2e_agent in agent maki opencode claude codex; do
            sandbox_put "$1" "$AGENT_FIXTURES/$e2e_agent" /sandbox/.e2e/bin
        done
    fi
    E2E_AGENT_MODE=${E2E_AGENT_MODE:-edit}
    printf '%s\n' "$E2E_AGENT_MODE" >"$CASE/mode"
    sandbox_put "$1" "$CASE/mode" /sandbox/.e2e
}

set_agent_mode() { # MODE
    E2E_AGENT_MODE=$1
    printf '%s\n' "$1" >"$CASE/mode"
    sandbox_put "$SANDBOX" "$CASE/mode" /sandbox/.e2e
}

up_sandbox() {
    run_front up up --name "$SANDBOX" --workdir /sandbox/project \
        --env "PATH=$SANDBOX_PATH"
    if [ "$LAST_RC" -ne 0 ]; then
        case_fail "up failed (exit $LAST_RC)"
        return 1
    fi
    if ! wait_for_phase "$SANDBOX" Ready; then
        case_fail "the sandbox did not reach Ready after up"
        return 1
    fi
    E2E_AGENT_MODE=edit
    upload_agents "$SANDBOX"
    case_pass up
}

agent_record() { # FIELD
    e2e_record=$CASE/agent-$1
    rm -f "$e2e_record"
    sandbox_read_file "$SANDBOX" "/sandbox/.e2e/records/$AGENT_COMMAND/$1" "$e2e_record"
    e2e_strip_plane_root <"$e2e_record" 2>/dev/null
}

wait_agent_started() {
    e2e_tries=0
    while [ "$e2e_tries" -lt 300 ]; do
        if sandbox_path_exists "$SANDBOX" "/sandbox/.e2e/records/$AGENT_COMMAND/started"; then
            return 0
        fi
        e2e_tries=$((e2e_tries + 1))
        sleep 0.1
    done
    return 1
}

wait_phase() { # PHASE
    e2e_tries=0
    while [ "$e2e_tries" -lt 300 ]; do
        if status_exists "$SANDBOX"; then
            if grep -Fq "\"phase\":\"$1\"" "$LAST_OUT"; then
                return 0
            fi
        fi
        e2e_tries=$((e2e_tries + 1))
        sleep 0.1
    done
    return 1
}

pending_file() {
    printf '%s/.local/state/osa/sessions/%s/pending\n' "$HOME" "$SANDBOX"
}

resolve_action() { # ACTION [--yes]
    run_osa resolve resolve "$SANDBOX" "$1" --json ${2:+"$2"}
    return "$LAST_RC"
}

# ---------------------------------------------------------------------------
# Recordings and the parity comparison
# ---------------------------------------------------------------------------

effect_digest() { # OUT-FILE
    {
        if [ -d "$PROJECT" ]; then
            find "$PROJECT" -type f ! -path '*/.git/*' -print | LC_ALL=C sort \
                | while IFS= read -r e2e_file; do
                    e2e_rel=${e2e_file#"$PROJECT"/}
                    printf '%s %s\n' "$e2e_rel" \
                        "$(cksum <"$e2e_file" | awk '{ print $1 "-" $2 }')"
                done
        fi
    } >"$1"
}

normalize_transcript() { # OUT-FILE
    if [ -f "$CASE/transcripts/operations.log" ]; then
        e2e_normalize "$CASE" "$WORK" "$ROOT" \
            <"$CASE/transcripts/operations.log" >"$1"
    else
        : >"$1"
    fi
}

is_excluded() { # CASE-ID
    [ -f "$EXCLUDED_FILE" ] || return 1
    sed -e 's/[[:space:]].*$//' -e '/^#/d' -e '/^$/d' "$EXCLUDED_FILE" \
        | grep -Fxq -- "$1"
}

compare_recording() {
    if is_excluded "$CURRENT"; then
        printf 'excluded %s\n' "$CURRENT"
        return 0
    fi
    e2e_rec=$RECORDINGS/$CURRENT
    if [ ! -d "$e2e_rec" ]; then
        UNRECORDED=$((UNRECORDED + 1))
        case_fail "no committed recording for $CURRENT"
        return 0
    fi
    RECORDED=$((RECORDED + 1))
    COMPARED=$((COMPARED + 1))
    e2e_verdict=$(e2e_verdict "$e2e_rec/operations.log" "$CASE/artifacts/operations.log")
    if [ "$e2e_verdict" = identical ]; then
        printf 'parity: identical (%s)\n' "$CURRENT"
    else
        DIVERGED=$((DIVERGED + 1))
        printf 'parity: %s (%s)\n' "$e2e_verdict" "$CURRENT"
        case_fail "$e2e_verdict"
    fi
    if ! cmp -s "$e2e_rec/effects.digest" "$CASE/artifacts/effects.digest"; then
        DIVERGED=$((DIVERGED + 1))
        printf 'parity: divergent in state (%s)\n' "$CURRENT"
        case_fail "divergent in state"
    fi
    if [ "$PARITY_ASSERTIONS" = 1 ] \
        && ! cmp -s "$e2e_rec/assertions.log" "$CASE/artifacts/assertions.log"; then
        DIVERGED=$((DIVERGED + 1))
        printf 'parity: divergent in output (%s)\n' "$CURRENT"
        case_fail "divergent in output"
    fi
}

record_case() {
    e2e_rec=$RECORDINGS/$CURRENT
    mkdir -p "$e2e_rec"
    cp "$CASE/artifacts/operations.log" "$e2e_rec/operations.log"
    cp "$CASE/artifacts/effects.digest" "$e2e_rec/effects.digest"
    cp "$CASE/artifacts/assertions.log" "$e2e_rec/assertions.log"
    RECORDED=$((RECORDED + 1))
    printf 'recorded %s\n' "$CURRENT"
}

# The recorder never writes a credential value; this scans the committed
# transcripts anyway and names only the variable that leaked.
leak_scan() { # DIRECTORY
    e2e_leaks=0
    while IFS= read -r e2e_key; do
        case $e2e_key in
            *_API_KEY | *_TOKEN | *_SECRET | *_SECRET_KEY | *_ACCESS_KEY) ;;
            *) continue ;;
        esac
        eval "e2e_value=\${$e2e_key-}"
        # shellcheck disable=SC2154  # assigned by the eval above
        [ "${#e2e_value}" -ge 8 ] || continue
        if grep -rFl -- "$e2e_value" "$1" >/dev/null 2>&1; then
            printf 'e2e: credential-like value from %s reached a transcript\n' "$e2e_key" >&2
            e2e_leaks=$((e2e_leaks + 1))
        fi
    done <<EOF
$(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p')
EOF
    [ "$e2e_leaks" -eq 0 ]
}

cleanup_case() {
    if [ -n "$SANDBOX" ] && [ "${E2E_KEEP_SANDBOX:-0}" != 1 ]; then
        "$FRONT_BIN" rm --yes --discard --name "$SANDBOX" >/dev/null 2>&1 || true
        if [ "$E2E_HOST" = 1 ] && status_exists "$SANDBOX"; then
            openshell sandbox delete "$SANDBOX" >/dev/null 2>&1 || true
        fi
    fi
    SANDBOX=
}

run_case() { # NAME
    CURRENT=$1
    CASE_FAILED=0
    printf '\n== %s\n' "$CURRENT"
    prepare_case "$CURRENT"
    "$CURRENT"
    if [ "$CASE_SKIPPED" = 1 ]; then
        SKIP=$((SKIP + 1))
        printf 'skip %s (%s)\n' "$CURRENT" "$SKIP_REASON"
    elif [ "$CASE_NA" = 1 ]; then
        NA=$((NA + 1))
        printf 'n/a  %s (%s)\n' "$CURRENT" "$NA_REASON"
    elif [ "$CASE_ADVISORY" = 1 ]; then
        ADVISORY=$((ADVISORY + 1))
        if [ "$CASE_ADVISORY_FAILED" = 1 ]; then
            printf 'advisory-failed %s: %s (does not affect the verdict)\n' "$CURRENT" "$ADVISORY_REASON"
        else
            printf 'advisory %s: %s (does not affect the verdict)\n' "$CURRENT" "$ADVISORY_REASON"
        fi
    else
        mkdir -p "$CASE/artifacts"
        normalize_transcript "$CASE/artifacts/operations.log"
        effect_digest "$CASE/artifacts/effects.digest"
        cp "$ASSERTIONS" "$CASE/artifacts/assertions.log"
        if [ "${OSA_E2E_RECORD:-0}" = 1 ]; then
            if [ "$CASE_FAILED" = 1 ]; then
                printf 'record: refusing to record failed case %s\n' "$CURRENT" >&2
            else
                record_case
            fi
        elif [ "$CASE_FAILED" = 0 ]; then
            compare_recording
        fi
        if [ "$CASE_FAILED" = 1 ]; then
            FAIL=$((FAIL + 1))
            printf 'FAIL %s\n' "$CURRENT"
        else
            PASS=$((PASS + 1))
            printf 'ok   %s\n' "$CURRENT"
        fi
    fi
    cleanup_case
}

# ---------------------------------------------------------------------------
# Preflight and plane lifecycle
# ---------------------------------------------------------------------------

skip_suite() { # REASON
    if [ "${OSA_E2E_RECORD:-0}" = 1 ]; then
        printf 'e2e: cannot record (%s)\n' "$1" >&2
        exit 1
    fi
    printf 'e2e: skipped (%s)\n' "$1"
    printf 'e2e: 0 of %s selected cases ran\n' "$SELECTED"
    print_scope
    exit 0
}

preflight_common() {
    for e2e_bin in maki-oss opencode-oss claude-oss codex-oss osa; do
        if [ ! -x "$E2E_BIN_DIR/$e2e_bin" ]; then
            skip_suite "the test-support binaries are not built in $E2E_BIN_DIR; run scripts/build-e2e.sh"
        fi
    done
    if [ ! -d "$AGENT_FIXTURES" ]; then
        skip_suite "scripted agent fixtures are missing under tests/e2e/fixtures/agents"
    fi
    command -v git >/dev/null 2>&1 || skip_suite "git is not on PATH"
}

preflight_local() {
    preflight_common
    e2e_uid=$(id -u 2>/dev/null || printf '?')
    if [ "$e2e_uid" != 1500 ] || [ ! -f /etc/osa-dev/insandbox ]; then
        skip_suite "not inside an osa sandbox (uid $e2e_uid, /etc/osa-dev/insandbox $([ -f /etc/osa-dev/insandbox ] && printf present || printf missing))"
    fi
    PLANE_BIN=${IN_SANDBOX_GATEWAY_BIN:-$ROOT/osa-core/target/e2e/release/insandbox-gateway}
    if [ ! -x "$PLANE_BIN" ]; then
        skip_suite "insandbox-gateway is not built at $PLANE_BIN; run scripts/build-e2e.sh"
    fi
    if [ "$E2E_HOST" = 0 ] && ! command -v curl >/dev/null 2>&1; then
        skip_suite "curl is needed to check that the plane's listener closed"
    fi
}

preflight_host() {
    preflight_common
    command -v openshell >/dev/null 2>&1 || skip_suite "openshell CLI is not on PATH"
    openshell status >/dev/null 2>&1 || skip_suite "the OpenShell gateway is not reachable (openshell status)"
    command -v "$E2E_ENGINE" >/dev/null 2>&1 || skip_suite "container engine $E2E_ENGINE is not on PATH"
    "$E2E_ENGINE" image inspect "$E2E_IMAGE" >/dev/null 2>&1 \
        || skip_suite "sandbox image $E2E_IMAGE is not present (build osa-dev:local first)"
    if ! openshell provider list 2>/dev/null | awk '{print $1}' | grep -Fxq -- "$E2E_PROVIDER"; then
        skip_suite "provider $E2E_PROVIDER is not on the gateway (create it with --runtime-credentials or set OSA_E2E_PROVIDER)"
    fi
    if [ -z "$E2E_TLS_DIR" ]; then
        e2e_tls_candidate=$HOME/.config/openshell/gateways/${OPENSHELL_GATEWAY:-openshell}/mtls
        if [ -f "$e2e_tls_candidate/ca.crt" ] && [ -f "$e2e_tls_candidate/tls.crt" ] \
            && [ -f "$e2e_tls_candidate/tls.key" ]; then
            E2E_TLS_DIR=$e2e_tls_candidate
        fi
    fi
    reset_frontend_env
    if ! probe_frontend list; then
        skip_suite "the typed client cannot reach the gateway: $(sed -n 1p "$WORK/preflight.err" 2>/dev/null)"
    fi
}

# A probe that must not enter any case's artifacts: it uses its own HOME and
# its own capture files.
probe_frontend() { # ARG...
    e2e_home=$WORK/preflight-home
    mkdir -p "$e2e_home/.config"
    if [ "$E2E_HOST" = 1 ] && [ -d "$E2E_REAL_CONFIG/openshell" ]; then
        ln -sfn "$E2E_REAL_CONFIG/openshell" "$e2e_home/.config/openshell"
    fi
    HOME=$e2e_home XDG_CONFIG_HOME=$e2e_home/.config XDG_STATE_HOME='' \
        "$FRONT_BIN" "$@" >"$WORK/preflight.out" 2>"$WORK/preflight.err"
    LAST_RC=$?
    LAST_OUT=$WORK/preflight.out
    LAST_ERR=$WORK/preflight.err
    return "$LAST_RC"
}

start_plane() {
    PLANE_STATE=$WORK/plane
    mkdir -p "$PLANE_STATE"
    printf '%s\n' "$E2E_PROVIDER" >"$PLANE_STATE/providers"
    IN_SANDBOX_GATEWAY_BIN=$PLANE_BIN \
    IN_SANDBOX_STATE_ROOT=$PLANE_STATE \
    IN_SANDBOX_GATEWAY_LISTEN=127.0.0.1:0 \
        "$ROOT/scripts/run-insandbox-plane.sh" >"$WORK/plane.out" 2>"$WORK/plane.err" &
    PLANE_PID=$!
    e2e_tries=0
    while [ "$e2e_tries" -lt 300 ]; do
        if grep -q '^insandbox-gateway listening on ' "$WORK/plane.out" 2>/dev/null; then
            break
        fi
        if ! kill -0 "$PLANE_PID" 2>/dev/null; then
            printf 'e2e: the plane exited before listening:\n' >&2
            sed 's/^/  /' "$WORK/plane.err" >&2
            exit 1
        fi
        e2e_tries=$((e2e_tries + 1))
        sleep 0.05
    done
    if [ "$e2e_tries" -ge 300 ]; then
        printf 'e2e: the plane did not announce a listener\n' >&2
        exit 1
    fi
    PLANE_SERVER=$(sed -n 's/^insandbox-gateway listening on //p' "$WORK/plane.out" | sed -n 1p)
    PLANE_PORT=${PLANE_SERVER##*:}
    PATH="$PLANE_STATE/shim:$DOCKER_FIXTURE_DIR:$PATH"
    export PATH
    export IN_SANDBOX_GATEWAY_SERVER="$PLANE_SERVER"
    reset_frontend_env
    if ! probe_frontend list; then
        printf 'e2e: the plane is up but the typed client failed:\n' >&2
        sed 's/^/  /' "$WORK/preflight.err" >&2
        exit 1
    fi
}

stop_plane() {
    [ -n "$PLANE_PID" ] || return 0
    kill "$PLANE_PID" 2>/dev/null || true
    e2e_tries=0
    while kill -0 "$PLANE_PID" 2>/dev/null && [ "$e2e_tries" -lt 100 ]; do
        e2e_tries=$((e2e_tries + 1))
        sleep 0.05
    done
    if kill -0 "$PLANE_PID" 2>/dev/null; then
        kill -9 "$PLANE_PID" 2>/dev/null || true
    fi
    wait "$PLANE_PID" 2>/dev/null || true
    PLANE_PID=
    if [ -n "$PLANE_SERVER" ]; then
        if command -v lsof >/dev/null 2>&1; then
            if lsof -iTCP:"$PLANE_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
                printf 'e2e: the plane listener on port %s survived teardown\n' "$PLANE_PORT" >&2
                TEARDOWN_FAILED=1
            fi
        elif command -v curl >/dev/null 2>&1; then
            if curl -fsS --max-time 1 "$PLANE_SERVER" >/dev/null 2>&1; then
                printf 'e2e: the plane listener on port %s survived teardown\n' "$PLANE_PORT" >&2
                TEARDOWN_FAILED=1
            fi
        fi
    fi
}

cleanup() {
    stop_plane
    if [ "${KEEP_WORK:-0}" != 1 ]; then
        rm -rf "$WORK"
    else
        printf 'e2e: work kept at %s\n' "$WORK"
    fi
    if [ "$SCOPE_PRINTED" = 0 ]; then
        print_scope
    fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

summary() {
    if [ "${OSA_E2E_RECORD:-0}" = 1 ]; then
        if leak_scan "$RECORDINGS"; then
            printf 'e2e: recorded %s case transcripts; credential scan clean\n' "$RECORDED"
        else
            FAIL=$((FAIL + 1))
        fi
    fi
    printf '\n'
    print_scope
    printf 'e2e: %s passed, %s failed, %s skipped, %s not applicable, %s advisory\n' \
        "$PASS" "$FAIL" "$SKIP" "$NA" "$ADVISORY"
    printf 'e2e: %s recorded, %s compared, %s unrecorded, %s divergent, %s excluded\n' \
        "$RECORDED" "$COMPARED" "$UNRECORDED" "$DIVERGED" "$EXCLUDED"
    if [ "$FAIL" -ne 0 ] || [ "$DIVERGED" -ne 0 ] || [ "$TEARDOWN_FAILED" -ne 0 ]; then
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

CASES='test_session_maki test_session_opencode test_session_claude
test_session_codex test_session_failure test_session_upload_download
test_caller_patch test_caller_empty test_caller_missing_baseline
test_resolve_apply test_resolve_branch test_resolve_drop test_rm_pending
test_status_list test_logs test_doctor test_policy_provider test_start_stop
test_interrupt test_idle_stop test_determinism test_offline
test_real_agent_smoke'

SELECTED=0
for e2e_case in $CASES; do
    if run_only_matches "$e2e_case"; then
        SELECTED=$((SELECTED + 1))
    fi
done
if [ "$SELECTED" -eq 0 ]; then
    printf 'e2e: 0 cases selected (RUN_ONLY=%s)\n' "${RUN_ONLY:-}"
    print_scope
    exit 0
fi

if [ -f "$EXCLUDED_FILE" ]; then
    EXCLUDED=$(sed -e 's/[[:space:]].*$//' -e '/^#/d' -e '/^$/d' "$EXCLUDED_FILE" | wc -l | tr -d ' ')
fi

select_frontend "$DEFAULT_FRONTEND"

case $MODE in
    local)
        preflight_local
        E2E_HOST=0
        start_plane
        ;;
    host | record)
        E2E_HOST=1
        preflight_host
        ;;
esac

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'e2e: mode %s, %s selected cases\n' "$MODE" "$SELECTED"
print_scope

for e2e_case in $CASES; do
    run_only_matches "$e2e_case" || continue
    run_case "$e2e_case"
done

stop_plane

if summary; then
    exit 0
fi
exit 1
