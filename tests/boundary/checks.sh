#!/bin/sh
# checks.sh - the scripted isolation checks behind `make test-boundary`.
#
# Six checks, each an assertion over evidence recorded from one sandbox:
#
#   egress-denied        a request to a host in no policy is refused at the
#                        connection layer, and no rule - and no wildcard - in
#                        the effective policy covers it
#   credential-shape     the credential variable holds a gateway-issued
#                        placeholder bound to the variable name, not a key
#   host-paths           a host directory is absent and a system path refuses
#                        a write
#   sandbox-user         the process runs as uid/gid 1500
#   no-bind-mount        the effective policy declares no mount or volume
#   gateway-log-refusal  the refusal from egress-denied appears in the gateway
#                        log, read against the gateway version in the record
#
# Usage:
#
#   checks.sh --sandbox NAME [--evidence DIR] [--credential-var VAR]
#             [--probe-host HOST] [--host-path PATH] [--since WINDOW]
#             [--denial-wait SECONDS] [--gateway-version VERSION]
#             [--manual NAME:REASON]...
#   checks.sh collect --sandbox NAME --evidence DIR [same options]
#   checks.sh run --evidence DIR [same options]
#
# With --sandbox and no --evidence, a temporary directory holds the evidence.
# `run` alone checks evidence recorded elsewhere; the self-test does that, and
# a failure on other evidence is the same assertion.
#
# Output, two lines per check:
#
#   ASSERT <name>: <what is asserted>
#   PASS|FAIL|MANUAL <name>: <detail>
#
# Exit: 0 when every check passed, 1 when any failed, 2 when none failed but a
# manual check was recorded. An incomplete run (exit 2) is never a pass.
#
# A check is never satisfied by an instruction, and it is never made to pass by
# adding an egress rule, disabling policy, or widening a wildcard. It reads
# recorded evidence and fails when the evidence is absent: an assertion that
# cannot run did not pass. The credential value is never printed, including in
# a failure, which names only the variable.
#
# POSIX sh only. `collect` needs the openshell CLI and a reachable gateway;
# `run` needs neither.
#
# The evidence files:
#   probe.out  probe.exit              the refused request
#   credential                         the variable's value, mode 600
#   host-path-ls.out  host-path-ls.exit
#   host-path-touch.out  host-path-touch.exit
#   id.out                             the sandbox process identity
#   policy-full.yaml                   openshell policy get NAME --full
#   gateway-log.txt                    openshell logs NAME --source sandbox,
#                                      polled up to --denial-wait (15s) for the
#                                      probe's denial

set -u

prog=checks.sh

SANDBOX=
EVIDENCE=
CREDENTIAL_VAR=ANTHROPIC_API_KEY
PROBE_HOST=example.com
HOST_PATH=/Users
SINCE=10m
DENIAL_WAIT=15
GATEWAY_VERSION=unknown
MANUALS=
MODE=

usage() {
    printf 'usage: %s [collect|run] [--sandbox NAME] [--evidence DIR]\n' "$prog" >&2
    printf '       [--credential-var VAR] [--probe-host HOST] [--host-path PATH]\n' >&2
    printf '       [--since WINDOW] [--denial-wait SECONDS] [--gateway-version VERSION]\n' >&2
    printf '       [--manual NAME:REASON]...\n' >&2
}

die() {
    printf '%s: %s\n' "$prog" "$1" >&2
    exit 2
}

while [ "$#" -gt 0 ]; do
    case $1 in
        collect | run)
            MODE=$1
            ;;
        --sandbox)
            [ "$#" -ge 2 ] || die '--sandbox needs a value'
            SANDBOX=$2
            shift
            ;;
        --evidence)
            [ "$#" -ge 2 ] || die '--evidence needs a value'
            EVIDENCE=$2
            shift
            ;;
        --credential-var)
            [ "$#" -ge 2 ] || die '--credential-var needs a value'
            CREDENTIAL_VAR=$2
            shift
            ;;
        --probe-host)
            [ "$#" -ge 2 ] || die '--probe-host needs a value'
            PROBE_HOST=$2
            shift
            ;;
        --host-path)
            [ "$#" -ge 2 ] || die '--host-path needs a value'
            HOST_PATH=$2
            shift
            ;;
        --since)
            [ "$#" -ge 2 ] || die '--since needs a value'
            SINCE=$2
            shift
            ;;
        --denial-wait)
            [ "$#" -ge 2 ] || die '--denial-wait needs a value'
            DENIAL_WAIT=$2
            shift
            ;;
        --gateway-version)
            [ "$#" -ge 2 ] || die '--gateway-version needs a value'
            GATEWAY_VERSION=$2
            shift
            ;;
        --manual)
            [ "$#" -ge 2 ] || die '--manual needs NAME:REASON'
            case $2 in
                *:?*) ;;
                *) die '--manual needs NAME:REASON' ;;
            esac
            MANUALS="${MANUALS}${MANUALS:+
}$2"
            shift
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *)
            usage
            die "unknown argument: $1"
            ;;
    esac
    shift
done

case $DENIAL_WAIT in
    '' | *[!0-9]*)
        die '--denial-wait must be a number of seconds'
        ;;
esac

# The variable name goes into a regular expression, so it must be one.
case $CREDENTIAL_VAR in
    '' | *[!A-Za-z0-9_]* | [0-9]*)
        die '--credential-var must be an environment variable name'
        ;;
esac

if [ -z "$MODE" ]; then
    if [ -n "$SANDBOX" ]; then
        MODE=all
    elif [ -n "$EVIDENCE" ]; then
        MODE=run
    else
        usage
        die 'pass --sandbox NAME or --evidence DIR'
    fi
fi

case $MODE in
    collect)
        [ -n "$SANDBOX" ] || die 'collect needs --sandbox NAME'
        [ -n "$EVIDENCE" ] || die 'collect needs --evidence DIR'
        ;;
    run)
        [ -n "$EVIDENCE" ] || die 'run needs --evidence DIR'
        ;;
    all)
        [ -n "$SANDBOX" ] || die 'pass --sandbox NAME or --evidence DIR'
        if [ -z "$EVIDENCE" ]; then
            EVIDENCE=$(mktemp -d "${TMPDIR:-/tmp}/osa-boundary-evidence.XXXXXX") \
                || die 'cannot create a temporary evidence directory'
            trap 'rm -rf "$EVIDENCE"' EXIT HUP INT TERM
        fi
        ;;
esac

failures=0
manual_count=0

assert_line() { # NAME TEXT
    printf 'ASSERT %s: %s\n' "$1" "$2"
}

pass() { # NAME TEXT
    printf 'PASS %s: %s\n' "$1" "$2"
}

fail() { # NAME TEXT
    printf 'FAIL %s: %s\n' "$1" "$2"
    failures=$((failures + 1))
}

manual() { # NAME TEXT
    printf 'MANUAL %s: %s\n' "$1" "$2"
    manual_count=$((manual_count + 1))
}

have_evidence() { # CHECK FILE...
    check_name=$1
    shift
    missing=
    for evidence_file in "$@"; do
        [ -e "$EVIDENCE/$evidence_file" ] || missing="$missing $evidence_file"
    done
    if [ -n "$missing" ]; then
        fail "$check_name" "no evidence:$missing (collect it in ${SANDBOX:-the sandbox} first; a check with no evidence did not pass)"
        return 1
    fi
    return 0
}

exit_code_of() { # FILE
    sed -n '1p' "$EVIDENCE/$1" 2>/dev/null | tr -cd '0-9'
}

# ---------------------------------------------------------------------------
# Collect
# ---------------------------------------------------------------------------

collect_exec() { # NAME ARGS...
    collect_name=$1
    shift
    printf 'collect: sandbox exec %s\n' "$collect_name"
    openshell sandbox exec -n "$SANDBOX" --no-login-shell -- "$@" \
        > "$EVIDENCE/$collect_name.out" 2>&1
    printf '%s\n' "$?" > "$EVIDENCE/$collect_name.exit"
}

collect_command() { # NAME ARGS...
    collect_name=$1
    shift
    printf 'collect: openshell %s\n' "$*"
    openshell "$@" > "$EVIDENCE/$collect_name.out" 2>&1
    printf '%s\n' "$?" > "$EVIDENCE/$collect_name.exit"
}

# The gateway writes the denial, not the exec, so the log can trail the probe.
# Poll it for a bounded window and keep the last capture either way; the check
# then reports a missing denial instead of this collector guessing.
collect_log_after_probe() { # HOST
    collect_host=$1
    collect_waited=0
    while :; do
        openshell logs "$SANDBOX" --since "$SINCE" --source sandbox \
            > "$EVIDENCE/gateway-log.txt" 2>&1
        if awk -v host="$collect_host" \
            '/DENIED/ && index($0, host) > 0 { found = 1 } END { exit !found }' \
            "$EVIDENCE/gateway-log.txt"; then
            return 0
        fi
        if [ "$collect_waited" -ge "$DENIAL_WAIT" ]; then
            printf 'collect: no denial for %s after %ss; the gateway-log check reports it\n' \
                "$collect_host" "$DENIAL_WAIT" >&2
            return 1
        fi
        sleep 1
        collect_waited=$((collect_waited + 1))
    done
}

collect() {
    command -v openshell >/dev/null 2>&1 \
        || die 'openshell not found (install the pinned OpenShell CLI)'
    mkdir -p "$EVIDENCE" || die "cannot create $EVIDENCE"
    chmod 700 "$EVIDENCE" 2>/dev/null || true

    printf 'collect: probe https://%s from sandbox %s\n' "$PROBE_HOST" "$SANDBOX"
    collect_exec probe /usr/bin/curl -sS --max-time 15 "https://$PROBE_HOST"

    printf 'collect: credential variable %s (the value is never printed)\n' "$CREDENTIAL_VAR"
    (
        umask 077
        openshell sandbox exec -n "$SANDBOX" --no-login-shell -- \
            printenv "$CREDENTIAL_VAR" > "$EVIDENCE/credential" 2>&1
    )
    printf '%s\n' "$?" > "$EVIDENCE/credential.exit"
    chmod 600 "$EVIDENCE/credential" 2>/dev/null || true

    printf 'collect: host path %s and a system path write\n' "$HOST_PATH"
    collect_exec host-path-ls ls "$HOST_PATH"
    collect_exec host-path-touch touch /usr/probe

    printf 'collect: sandbox identity\n'
    collect_exec id id

    collect_command policy-full policy get "$SANDBOX" --full
    mv "$EVIDENCE/policy-full.out" "$EVIDENCE/policy-full.yaml"

    printf 'collect: gateway log (%s, waiting up to %ss for the denial)\n' "$SINCE" "$DENIAL_WAIT"
    collect_log_after_probe "$PROBE_HOST" || true
}

# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

# Prints "<rule>|<host>" for every endpoint host in the effective policy that
# is a wildcard or covers PROBE_HOST.
policy_rules_for_probe() { # FILE
    awk -v probe="$PROBE_HOST" '
        function strip(value) {
            sub(/^[[:space:]]+/, "", value)
            sub(/[[:space:]]+$/, "", value)
            sub(/[[:space:]]*#.*$/, "", value)
            gsub(/["\047]/, "", value)
            return value
        }
        function covers(host) {
            if (host == "" || host == "*" || host == "0.0.0.0" || host == "::") return 1
            if (host ~ /\*/) return 1
            if (host == probe) return 1
            if (substr(host, 1, 1) == ".") {
                tail = substr(host, 2)
                if (probe == tail) return 1
                if (length(probe) > length(tail) &&
                    substr(probe, length(probe) - length(tail)) == "." tail) return 1
            }
            return 0
        }
        /^[^[:space:]]/ { in_network = ($0 ~ /^network_policies:[[:space:]]*$/) ? 1 : 0 }
        in_network && /^  [A-Za-z0-9_.-]+:[[:space:]]*$/ {
            rule = $0
            sub(/^  /, "", rule)
            sub(/:[[:space:]]*$/, "", rule)
        }
        in_network && /^[[:space:]]*-?[[:space:]]*host:[[:space:]]*/ {
            host = $0
            sub(/^[[:space:]]*-?[[:space:]]*host:[[:space:]]*/, "", host)
            host = strip(host)
            if (covers(host)) printf "%s|%s\n", rule, host
        }
    ' "$1"
}

check_egress_denied() {
    assert_line egress-denied \
        "a request to $PROBE_HOST is refused at the connection layer, and no rule (and no wildcard) in the effective policy covers it"
    have_evidence egress-denied probe.out probe.exit policy-full.yaml || return 1

    probe_exit=$(exit_code_of probe.exit)
    if [ "$probe_exit" = 0 ]; then
        fail egress-denied "the request to $PROBE_HOST succeeded (exit 0); a host in no policy must be refused"
        return 1
    fi
    if grep -q 'HTTP/' "$EVIDENCE/probe.out" 2>/dev/null; then
        fail egress-denied "the request to $PROBE_HOST returned HTTP content; it must fail at the connection layer"
        return 1
    fi

    rules=$(policy_rules_for_probe "$EVIDENCE/policy-full.yaml")
    if [ -n "$rules" ]; then
        rule_name=$(printf '%s\n' "$rules" | sed -n '1p' | sed 's/|.*$//')
        rule_host=$(printf '%s\n' "$rules" | sed -n '1p' | sed 's/^[^|]*|//')
        fail egress-denied "the effective policy rule $rule_name covers $rule_host; remove that rule instead of widening it"
        return 1
    fi

    pass egress-denied "exit $probe_exit with no HTTP content, and no rule in the effective policy covers $PROBE_HOST"
}

check_credential_shape() {
    assert_line credential-shape \
        "$CREDENTIAL_VAR holds a gateway-issued placeholder bound to the variable name, never a key; the value is not printed"
    have_evidence credential-shape credential credential.exit || return 1

    if [ "$(exit_code_of credential.exit)" != 0 ]; then
        fail credential-shape "reading $CREDENTIAL_VAR in the sandbox failed; an unreadable variable is not a placeholder"
        return 1
    fi
    if [ ! -s "$EVIDENCE/credential" ]; then
        fail credential-shape "$CREDENTIAL_VAR is empty; no provider was bound to the process"
        return 1
    fi

    # The value is read once, compared, and never printed or passed in argv.
    credential_value=$(tr -d '\r\n' < "$EVIDENCE/credential")
    credential_length=${#credential_value}

    case $credential_value in
        *_"$CREDENTIAL_VAR") ;;
        *)
            unset credential_value
            fail credential-shape "$CREDENTIAL_VAR does not end in _$CREDENTIAL_VAR; the gateway binds the placeholder to the variable name, so this is not one"
            return 1
            ;;
    esac

    # A real credential is key-shaped, or far longer than the placeholder the
    # gateway issues. Only the length and the shape are reported.
    if [ "$credential_length" -gt 128 ]; then
        unset credential_value
        fail credential-shape "$CREDENTIAL_VAR is $credential_length characters, too long for a gateway placeholder; treat the value as leaked and rotate the key"
        return 1
    fi
    if printf '%s' "$credential_value" \
        | grep -Eq '^(sk-|sk_|ghp_|github_pat_|xox[abpr]-|AIza|eyJ[A-Za-z0-9_-]+\.)'; then
        unset credential_value
        fail credential-shape "$CREDENTIAL_VAR carries a credential key shape; treat the value as leaked, rotate the key, and do not print it"
        return 1
    fi
    if printf '%s' "$credential_value" | grep -Eq '[[:space:][:cntrl:]]'; then
        unset credential_value
        fail credential-shape "$CREDENTIAL_VAR contains whitespace or control characters; a gateway placeholder does not"
        return 1
    fi

    unset credential_value
    pass credential-shape "$CREDENTIAL_VAR holds a gateway placeholder bound to the variable name ($credential_length characters), not a key (value not printed)"
}

check_host_paths() {
    assert_line host-paths \
        "$HOST_PATH does not exist in the sandbox and /usr/probe cannot be written"
    have_evidence host-paths host-path-ls.out host-path-ls.exit \
        host-path-touch.out host-path-touch.exit || return 1

    ls_exit=$(exit_code_of host-path-ls.exit)
    touch_exit=$(exit_code_of host-path-touch.exit)

    if [ "$ls_exit" = 0 ]; then
        fail host-paths "$HOST_PATH is visible in the sandbox (ls exit 0); no host path may be mounted"
        return 1
    fi
    if ! grep -Eqi 'no such file|not found|permission denied' "$EVIDENCE/host-path-ls.out" 2>/dev/null; then
        fail host-paths "$HOST_PATH is not listed, but the failure is not a missing path; investigate the mount"
        return 1
    fi
    if [ "$touch_exit" = 0 ]; then
        fail host-paths "/usr/probe was created; system paths must be read-only"
        return 1
    fi
    if ! grep -Eqi 'permission denied|read-only file system|operation not permitted' \
        "$EVIDENCE/host-path-touch.out" 2>/dev/null; then
        fail host-paths "/usr/probe was not written, but the failure is not a read-only or permission refusal"
        return 1
    fi

    pass host-paths "$HOST_PATH is absent (exit $ls_exit) and /usr/probe is refused (exit $touch_exit)"
}

check_sandbox_user() {
    assert_line sandbox-user "the sandbox process runs as uid/gid 1500"
    have_evidence sandbox-user id.out || return 1

    uid_line=$(grep -Eo 'uid=[0-9]+\([^)]*\)' "$EVIDENCE/id.out" 2>/dev/null | sed -n '1p')
    gid_line=$(grep -Eo 'gid=[0-9]+\([^)]*\)' "$EVIDENCE/id.out" 2>/dev/null | sed -n '1p')

    if [ "$uid_line" != 'uid=1500(sandbox)' ]; then
        fail sandbox-user "the sandbox user is '${uid_line:-unknown}', not uid=1500(sandbox)"
        return 1
    fi
    if [ "$gid_line" != 'gid=1500(sandbox)' ]; then
        fail sandbox-user "the sandbox group is '${gid_line:-unknown}', not gid=1500(sandbox)"
        return 1
    fi

    pass sandbox-user "$uid_line $gid_line"
}

check_no_bind_mount() {
    assert_line no-bind-mount "the effective policy declares no mount, volume, or bind mount"
    have_evidence no-bind-mount policy-full.yaml || return 1

    violation=$(awk '
        {
            line = $0
            if (line !~ /^[[:space:]]*-?[[:space:]]*(mounts|bind_mounts|mount|bind_mount|volumes)[[:space:]]*:/) next
            number = NR
            value = line
            sub(/^[^:]*:[[:space:]]*/, "", value)
            sub(/[[:space:]]*#.*$/, "", value)
            sub(/[[:space:]]+$/, "", value)
            if (value == "false" || value == "none" || value == "null" || value == "[]") next
            if (value != "") {
                print number ": " line
                exit 0
            }
            while ((getline next_line) > 0) {
                if (next_line ~ /^[[:space:]]*$/) continue
                if (next_line ~ /^[[:space:]]+-[[:space:]]*[^[:space:]]/) {
                    print number ": " line " " next_line
                    exit 0
                }
                break
            }
            next
        }
    ' "$EVIDENCE/policy-full.yaml")

    if [ -n "$violation" ]; then
        fail no-bind-mount "the effective policy declares a mount: $violation; no bind mount may cross the boundary"
        return 1
    fi

    pass no-bind-mount "no mount, volume, or bind mount in the effective policy"
}

check_gateway_log() {
    assert_line gateway-log-refusal \
        "the gateway log for OpenShell $GATEWAY_VERSION shows the refusal of $PROBE_HOST recorded by egress-denied"
    have_evidence gateway-log-refusal gateway-log.txt || return 1

    if [ ! -s "$EVIDENCE/gateway-log.txt" ]; then
        fail gateway-log-refusal "the gateway log is empty, so no denial can be read for OpenShell $GATEWAY_VERSION; record a window after the probe"
        return 1
    fi
    if ! grep -Eq '\[OCSF *\] \[ocsf\] NET:(REFUSE|OPEN) ' "$EVIDENCE/gateway-log.txt"; then
        fail gateway-log-refusal "no OCSF policy event in the log for OpenShell $GATEWAY_VERSION; the format is unrecognized (expected '[OCSF ] [ocsf] NET:OPEN ... DENIED <host>:<port>')"
        return 1
    fi
    if ! awk -v host="$PROBE_HOST" '
        /\[OCSF *\] \[ocsf\] NET:(REFUSE|OPEN) / { policy = 1 }
        policy && /DENIED/ && index($0, host) > 0 { found = 1 }
        END { exit !found }
    ' "$EVIDENCE/gateway-log.txt"; then
        fail gateway-log-refusal "the log for OpenShell $GATEWAY_VERSION has OCSF events but none denies $PROBE_HOST; record the window after the probe"
        return 1
    fi

    pass gateway-log-refusal "a NET:REFUSE/NET:OPEN denial for $PROBE_HOST is in the OpenShell $GATEWAY_VERSION log"
}

run_checks() {
    if [ "$MODE" = all ] || [ "$MODE" = collect ]; then
        collect
    fi

    printf 'readiness check: %s\n' "$EVIDENCE"
    check_egress_denied
    check_credential_shape
    check_host_paths
    check_sandbox_user
    check_no_bind_mount
    check_gateway_log

    if [ -n "$MANUALS" ]; then
        saved_ifs=$IFS
        IFS='
'
        for manual_entry in $MANUALS; do
            manual "${manual_entry%%:*}" "${manual_entry#*:}"
        done
        IFS=$saved_ifs
    fi

    if [ "$failures" -gt 0 ]; then
        printf 'checks: %s failed, run is not a boundary pass\n' "$failures"
        exit 1
    fi
    if [ "$manual_count" -gt 0 ]; then
        printf 'checks: %s manual, run is incomplete and not a boundary pass\n' "$manual_count"
        exit 2
    fi
    printf 'checks: all passed\n'
    exit 0
}

run_checks
