#!/bin/sh
# gate.sh - the host-only boundary gate behind `make test-boundary`.
#
# It composes, in one fixed order, the three parts that together make a
# boundary claim:
#
#   1. the suite gate   scripts/test-all.sh - the body `make test-all` runs
#   2. the live journey run   bun bridge/test/journeys/harness/live.ts
#   3. the isolation checks   tests/boundary/checks.sh
#
# A missing prerequisite fails the gate with a message naming it; nothing is
# skipped and a skip is never reported as a pass. On completion the gate prints
# a boundary record with one of three verdicts: passed, failed, or incomplete
# (a manual check, or a dry run). Exit: 0 passed, 1 failed, 2 incomplete.
#
# Patch mode: `--patch FILE --base COMMIT` applies a patch a sandbox produced
# (`maki-oss collect-patch`) to a throwaway clone at COMMIT, and runs the fixed
# command set there. Before any suite runs the gate refuses a patch whose
# preimage content is not in COMMIT, a target tree that is not clean, and a
# path that escapes the checkout. The gate never runs a command named by the
# patch: the suite runner is the base commit's own scripts/test-all.sh, copied
# out of the checkout, and `make` is never invoked inside it. `--checkout DIR`
# targets an existing clean checkout at COMMIT instead of creating one; the
# gate never deletes a checkout it did not create.
#
# Nothing runs automatically: the gate is started by a person (or a scheduled
# job) after a patch is collected, never by the sandbox that produced it.
#
# The gate is host-only and needs a reachable OpenShell gateway, a container
# engine, the project image, a sandbox holding the provider, bun, cargo,
# opencode, and OSKHS_TEST_MONGO_URI. The CI decision and the record format are
# in docs/ai/verification/claims.md.
#
# POSIX sh only. The functions below are sourceable for the self-test, which is
# why this file sets no shell option at the top and runs main only when it is
# executed directly.

prog=test-boundary

# ---------------------------------------------------------------------------
# Output and record
# ---------------------------------------------------------------------------

boundary_gate_note() {
    printf '%s: %s\n' "$prog" "$*"
}

boundary_gate_fail() {
    printf '%s: %s\n' "$prog" "$*" >&2
}

# The record is a copy of what ran, not a reconstruction: a field with no
# evidence reads `unknown`, and a run that did not complete says `incomplete`.
boundary_gate_record() {
    printf '\nboundary record\n'
    printf '  gateway: %s\n' "${GATEWAY_RECORD:-unknown}"
    printf '  agent: %s\n' "${AGENT_VERSION:-unknown}"
    printf '  engine: %s\n' "${ENGINE_RECORD:-unknown}"
    printf '  image: %s\n' "${IMAGE_RECORD:-unknown}"
    printf '  patch: %s\n' "${PATCH_COMMIT:-none}"
    printf '  checks:\n'
    if [ -n "${CHECK_RESULTS:-}" ] && [ -s "$CHECK_RESULTS" ]; then
        while IFS='|' read -r record_check record_outcome; do
            [ -n "$record_check" ] || continue
            printf '    %s: %s\n' "$record_check" "$record_outcome"
        done < "$CHECK_RESULTS"
    else
        printf '    none recorded\n'
    fi
    printf '  verdict: %s\n' "${VERDICT:-incomplete}"
}

# Prints the record and stops. Used for every refusal and every failed part, so
# a partial run exists only as an `incomplete`/`failed` record.
boundary_gate_stop() { # MESSAGE
    boundary_gate_fail "$1"
    VERDICT=failed
    boundary_gate_record
    exit 1
}

# The same, for a run whose parts passed but that cannot be a boundary pass.
boundary_gate_stop_incomplete() { # MESSAGE
    boundary_gate_fail "$1"
    VERDICT=incomplete
    boundary_gate_record
    exit 2
}

boundary_gate_usage() {
    printf 'usage: %s [--sandbox NAME] [--credential-var VAR] [--probe-host HOST]\n' "$prog" >&2
    printf '       [--patch FILE --base COMMIT] [--checkout DIR] [--repo DIR]\n' >&2
    printf '       [--manual NAME:REASON]... [--dry-run]\n' >&2
    printf '\n' >&2
    printf '  --sandbox NAME        the verification sandbox the checks run against\n' >&2
    printf '  --credential-var VAR  the sandbox variable the credential check reads\n' >&2
    printf '  --probe-host HOST     the host in no policy the egress checks probe\n' >&2
    printf '  --patch FILE          a patch produced in a sandbox (collect-patch)\n' >&2
    printf '  --base COMMIT         the commit the patch was made against\n' >&2
    printf '  --checkout DIR        an existing clean checkout at --base\n' >&2
    printf '  --repo DIR            the repository the patch was made against\n' >&2
    printf '  --manual NAME:REASON  record a check that cannot be automated\n' >&2
    printf '  --dry-run             print the fixed command set; never a pass\n' >&2
}

# ---------------------------------------------------------------------------
# Patch input
# ---------------------------------------------------------------------------

# Prints the first path in PATCH that would leave a checkout: absolute, a
# parent traversal, or a .git path. Exit 1 when such a path exists.
boundary_gate_escaping_path() { # PATCH
    awk '
        function strip(line,   path) {
            path = substr(line, 5)
            sub(/\t.*$/, "", path)
            sub(/^[ab]\//, "", path)
            return path
        }
        /^diff --git / { in_hunk = 0; next }
        /^@@ / { in_hunk = 1; next }
        /^\+\+\+ / || /^--- / {
            if (in_hunk) next
            path = strip($0)
            if (path == "/dev/null") next
            if (path == "") next
            if (path ~ /^\// || path ~ /(^|\/)\.\.(\/|$)/ || path ~ /(^|\/)\.git(\/|$)/) {
                print path
                found = 1
                exit
            }
        }
        END { if (found) exit 1; exit 0 }
    ' "$1"
}

# Prints the first file in PATCH whose preimage content is not what BASE holds:
# the patch records the blob each hunk replaces, so a patch made against another
# revision names content this base does not have. Exit 1 on a mismatch.
boundary_gate_patch_base_mismatch() { # PATCH CHECKOUT BASE
    awk '
        function reset() {
            minus = ""
            plus = ""
            old = ""
            in_hunk = 0
        }
        BEGIN { reset() }
        /^diff --git / {
            if (old != "" && (minus != "" || plus != "")) print (minus != "" ? minus : plus) "|" old
            reset()
            next
        }
        /^@@ / { in_hunk = 1; next }
        /^index [0-9a-f]+\.\.[0-9a-f]+/ {
            spec = $2
            cut = index(spec, "..")
            old = substr(spec, 1, cut - 1)
            next
        }
        /^--- / {
            if (!in_hunk) {
                minus = substr($0, 5)
                sub(/\t.*$/, "", minus)
                sub(/^a\//, "", minus)
                if (minus == "/dev/null") minus = ""
            }
            next
        }
        /^\+\+\+ / {
            if (!in_hunk) {
                plus = substr($0, 5)
                sub(/\t.*$/, "", plus)
                sub(/^b\//, "", plus)
                if (plus == "/dev/null") plus = ""
            }
            next
        }
        END {
            if (old != "" && (minus != "" || plus != "")) print (minus != "" ? minus : plus) "|" old
        }
    ' "$1" | while IFS='|' read -r mismatch_path preimage; do
        [ -n "$mismatch_path" ] || continue
        case $preimage in
            *[!0]*) ;;
            *) preimage=0000000 ;;
        esac
        if [ "$preimage" = 0000000 ]; then
            if git -C "$2" rev-parse --verify --quiet "$3:$mismatch_path" >/dev/null 2>&1; then
                printf '%s (added over a file %s already has)\n' "$mismatch_path" "$3"
            fi
            continue
        fi
        actual=$(git -C "$2" rev-parse --verify --quiet "$3:$mismatch_path" 2>/dev/null)
        if [ -z "$actual" ]; then
            printf '%s (absent at %s)\n' "$mismatch_path" "$3"
            continue
        fi
        case $actual in
            "$preimage"*) ;;
            *) printf '%s (content differs at %s)\n' "$mismatch_path" "$3" ;;
        esac
    done > "$4"
    [ -s "$4" ] && return 1
    return 0
}

# Prints the first dirty path in DIR, tracked or untracked.
boundary_gate_tree_dirty() { # DIR
    git -C "$1" status --porcelain --untracked-files=all 2>/dev/null | sed -n '1p'
}

# Resolves BASE in DIR to a commit id. Exit 1 when it is not there.
boundary_gate_resolve_base() { # DIR BASE
    git -C "$1" rev-parse --verify --quiet --end-of-options "$2^{commit}"
}

# Applies PATCH to TARGET at BASE_SHA and commits it, so the record names the
# patch commit. Every refusal happens before any suite runs.
boundary_gate_apply() { # TARGET BASE_SHA
    target=$1
    base_sha=$2

    escaping=$(boundary_gate_escaping_path "$PATCH") \
        || boundary_gate_stop "refused: the patch escapes the checkout: $escaping"

    : > "$WORK/base-mismatch"
    if ! boundary_gate_patch_base_mismatch "$PATCH" "$target" "$base_sha" "$WORK/base-mismatch"; then
        boundary_gate_stop "refused: the patch does not match base $base_sha: $(sed -n '1p' "$WORK/base-mismatch"); the base commit names the revision the patch was made against"
    fi

    if ! git -C "$target" apply --index --binary --whitespace=nowarn "$PATCH" 2> "$WORK/apply.err"; then
        boundary_gate_stop "refused: the patch does not apply at base $base_sha: $(sed -n '1p' "$WORK/apply.err")"
    fi
    if ! git -C "$target" commit --quiet --no-verify -m 'boundary gate: apply sandbox patch' >/dev/null 2>&1; then
        boundary_gate_stop "refused: cannot commit the applied patch in $target"
    fi
    PATCH_COMMIT=$(git -C "$target" rev-parse HEAD) \
        || boundary_gate_stop "refused: cannot read the patch commit in $target"
}

# Creates the target and validates it before the patch is applied.
boundary_gate_target() {
    if [ -n "$EXISTING_CHECKOUT" ]; then
        TARGET=$(CDPATH='' cd -- "$EXISTING_CHECKOUT" && pwd -P) \
            || boundary_gate_stop "refused: target checkout not found: $EXISTING_CHECKOUT"
        git -C "$TARGET" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
            || boundary_gate_stop "refused: target is not a git work tree: $TARGET"
    else
        TARGET="$WORK/checkout"
        boundary_gate_note "checkout: $TARGET (fresh clone of $REPO)"
        git clone --no-hardlinks --quiet "$REPO" "$TARGET" \
            || boundary_gate_stop "refused: cannot create a throwaway checkout from $REPO"
    fi

    base_sha=$(boundary_gate_resolve_base "$TARGET" "$BASE") \
        || boundary_gate_stop "refused: base commit $BASE is not in $TARGET"

    if [ -z "$EXISTING_CHECKOUT" ]; then
        git -C "$TARGET" checkout --quiet --detach "$base_sha" \
            || boundary_gate_stop "refused: cannot check out base $base_sha in $TARGET"
    else
        head_sha=$(git -C "$TARGET" rev-parse HEAD 2>/dev/null) \
            || boundary_gate_stop "refused: cannot read HEAD in $TARGET"
        [ "$head_sha" = "$base_sha" ] \
            || boundary_gate_stop "refused: target HEAD is $head_sha, not the base $base_sha"
    fi

    dirty=$(boundary_gate_tree_dirty "$TARGET")
    [ -z "$dirty" ] \
        || boundary_gate_stop "refused: the target tree is dirty at $dirty; the gate applies a patch to a clean tree only"

    boundary_gate_note "target: $TARGET at $base_sha"
}

# ---------------------------------------------------------------------------
# The fixed command set
# ---------------------------------------------------------------------------

# Restores the patched checkout's JavaScript dependencies. The commands are
# fixed here, not read from the checkout, and only run for a patch: the
# working tree already has its dependencies.
boundary_gate_prepare() { # TARGET
    target=$1
    for dep_dir in bridge oskhs; do
        boundary_gate_note "prepare: (cd $target/$dep_dir && bun install --frozen-lockfile)"
        (cd "$target/$dep_dir" && bun install --frozen-lockfile) \
            || boundary_gate_stop "prepare failed: bun install in $dep_dir"
    done
    boundary_gate_note "prepare: (cd $target/dashboard && bun install)"
    (cd "$target/dashboard" && bun install) \
        || boundary_gate_stop 'prepare failed: bun install in dashboard'
}

# The suite runner is fixed: the working tree's scripts/test-all.sh, or the
# base commit's copy of it in patch mode. A patch that rewrites Makefile or
# scripts/test-all.sh cannot choose the command that runs. Sets RUNNER.
boundary_gate_runner() { # TARGET BASE_SHA
    target=$1
    base_sha=$2
    if [ -z "$PATCH" ]; then
        RUNNER=$REPO/scripts/test-all.sh
        return 0
    fi
    mkdir -p "$WORK/runner" || boundary_gate_stop 'cannot create the runner directory'
    if ! git -C "$target" show "$base_sha:scripts/test-all.sh" > "$WORK/runner/test-all.sh" 2> "$WORK/runner.err"; then
        boundary_gate_stop "the base commit $base_sha has no scripts/test-all.sh; rebase the patch on a commit that has the gate"
    fi
    if ! grep -q 'ROOT argument' "$WORK/runner/test-all.sh" 2>/dev/null; then
        boundary_gate_stop "scripts/test-all.sh at $base_sha cannot be pointed at a target tree; rebase the patch on a commit that has the gate"
    fi
    RUNNER=$WORK/runner/test-all.sh
    return 0
}

boundary_gate_suites() { # TARGET BASE_SHA
    target=$1
    base_sha=$2
    boundary_gate_runner "$target" "$base_sha" || exit 1

    if [ -n "$PATCH" ]; then
        boundary_gate_prepare "$target"
        boundary_gate_note "1/3 suite gate: sh $RUNNER $target (the base copy; the patch cannot choose it)"
    else
        boundary_gate_note "1/3 suite gate: sh $RUNNER $target (the body make test-all runs)"
    fi
    if ! sh "$RUNNER" "$target"; then
        boundary_gate_stop 'failed part: suite gate (scripts/test-all.sh)'
    fi

    boundary_gate_note "2/3 live journey run: (cd $target && bun bridge/test/journeys/harness/live.ts)"
    if ! (cd "$target" && bun bridge/test/journeys/harness/live.ts); then
        boundary_gate_stop 'failed part: live journey run (bridge/test/journeys/harness/live.ts)'
    fi
}

boundary_gate_checks() {
    checks=$REPO/tests/boundary/checks.sh
    [ -x "$checks" ] || boundary_gate_stop "failed part: isolation checks ($checks is not executable)"

    set -- --sandbox "$SANDBOX" --probe-host "$PROBE_HOST" \
        --credential-var "$CREDENTIAL_VAR" --gateway-version "$GATEWAY_VERSION"
    while IFS= read -r manual_entry; do
        [ -n "$manual_entry" ] || continue
        set -- "$@" --manual "$manual_entry"
    done < "$WORK/manuals"
    boundary_gate_note "3/3 isolation checks: sh $checks $*"

    sh "$checks" "$@" > "$WORK/checks.log" 2>&1
    checks_rc=$?
    cat "$WORK/checks.log"
    while IFS= read -r line; do
        case $line in
            PASS\ * | FAIL\ * | MANUAL\ *)
                outcome=$(printf '%s' "${line%% *}" | tr 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' 'abcdefghijklmnopqrstuvwxyz')
                rest=${line#* }
                printf '%s|%s\n' "${rest%%:*}" "$outcome" >> "$CHECK_RESULTS"
                ;;
        esac
    done < "$WORK/checks.log"

    case $checks_rc in
        0) return 0 ;;
        2) boundary_gate_stop_incomplete 'incomplete: a manual check was recorded; the run is not a boundary pass' ;;
        *) boundary_gate_stop 'failed part: isolation checks (tests/boundary/checks.sh)' ;;
    esac
}

# ---------------------------------------------------------------------------
# Prerequisites and versions
# ---------------------------------------------------------------------------

boundary_gate_prereqs() {
    command -v openshell >/dev/null 2>&1 \
        || boundary_gate_stop 'missing prerequisite: gateway (the openshell CLI is not on PATH)'
    gateway_status=$(openshell status 2>&1) \
        || boundary_gate_stop 'missing prerequisite: gateway (openshell status failed; no reachable gateway)'
    printf '%s\n' "$gateway_status" | grep -q 'Status: *Connected' \
        || boundary_gate_stop 'missing prerequisite: gateway (openshell status does not report Connected)'

    gateway_line=$(printf '%s\n' "$gateway_status" | sed -n 's/^[[:space:]]*Version:[[:space:]]*//p' | sed -n '1p')
    GATEWAY_VERSION=$(printf '%s' "${gateway_line:-unknown}" | sed 's/^v//')
    if [ "$GATEWAY_VERSION" = unknown ]; then
        GATEWAY_RECORD=unknown
    else
        GATEWAY_RECORD="OpenShell $GATEWAY_VERSION"
    fi

    command -v "$ENGINE" >/dev/null 2>&1 \
        || boundary_gate_stop "missing prerequisite: engine ($ENGINE is not on PATH)"
    "$ENGINE" info >/dev/null 2>&1 \
        || boundary_gate_stop "missing prerequisite: engine ($ENGINE is not reachable)"
    engine_version=$("$ENGINE" version --format '{{.Server.Version}}' 2>/dev/null | sed -n '1p')
    ENGINE_RECORD="$ENGINE ${engine_version:-unknown}"

    "$ENGINE" image inspect "$IMAGE" >/dev/null 2>&1 \
        || boundary_gate_stop "missing prerequisite: image ($IMAGE is not in $ENGINE)"
    image_id=$("$ENGINE" image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null | sed -n '1p')
    IMAGE_RECORD=$IMAGE
    [ -n "$image_id" ] && IMAGE_RECORD="$IMAGE ($image_id)"

    command -v bun >/dev/null 2>&1 \
        || boundary_gate_stop 'missing prerequisite: Bun (install Bun: https://bun.sh)'
    command -v cargo >/dev/null 2>&1 \
        || boundary_gate_stop 'missing prerequisite: cargo (install the pinned Rust toolchain from rust-toolchain.toml)'
    command -v opencode >/dev/null 2>&1 \
        || boundary_gate_stop 'missing prerequisite: opencode (the live journey run drives the real TUI)'
    [ -n "${OSKHS_TEST_MONGO_URI:-}" ] \
        || boundary_gate_stop 'missing prerequisite: database URI (OSKHS_TEST_MONGO_URI is not set, e.g. mongodb://127.0.0.1:27017)'
    [ -n "$SANDBOX" ] \
        || boundary_gate_stop 'missing prerequisite: sandbox (pass --sandbox NAME; the isolation checks need the verification sandbox)'
}

# The agent version comes from a throwaway container, so it is read only after
# every cheaper prerequisite passed.
boundary_gate_agent_version() {
    if [ -n "${OSA_BOUNDARY_AGENT_VERSION:-}" ]; then
        AGENT_VERSION=$OSA_BOUNDARY_AGENT_VERSION
    else
        AGENT_VERSION=$("$ENGINE" run --rm "$IMAGE" maki --version 2>/dev/null | sed -n '1p')
    fi
    [ -n "$AGENT_VERSION" ] || AGENT_VERSION='unknown (maki --version failed)'
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

boundary_gate_main() {
    REPO=
    SANDBOX=${MAKI_OSS_SANDBOX_NAME:-}
    CREDENTIAL_VAR=${OSA_BOUNDARY_CREDENTIAL_VAR:-ANTHROPIC_API_KEY}
    PROBE_HOST=${OSA_BOUNDARY_PROBE_HOST:-example.com}
    PATCH=
    BASE=
    EXISTING_CHECKOUT=
    DRY_RUN=0
    ENGINE=${MAKI_OSS_ENGINE:-docker}
    IMAGE=${MAKI_OSS_IMAGE:-maki-agent:local}
    GATEWAY_VERSION=unknown
    GATEWAY_RECORD=
    AGENT_VERSION=
    ENGINE_RECORD=
    IMAGE_RECORD=
    PATCH_COMMIT=
    TARGET=
    CHECK_RESULTS=
    MANUALS=
    VERDICT=incomplete

    default_repo=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P) || exit 2
    REPO=$default_repo

    while [ "$#" -gt 0 ]; do
        case $1 in
            --sandbox)
                [ "$#" -ge 2 ] || { boundary_gate_usage; exit 2; }
                SANDBOX=$2
                shift
                ;;
            --credential-var)
                [ "$#" -ge 2 ] || { boundary_gate_usage; exit 2; }
                CREDENTIAL_VAR=$2
                shift
                ;;
            --probe-host)
                [ "$#" -ge 2 ] || { boundary_gate_usage; exit 2; }
                PROBE_HOST=$2
                shift
                ;;
            --patch)
                [ "$#" -ge 2 ] || { boundary_gate_usage; exit 2; }
                PATCH=$2
                shift
                ;;
            --base)
                [ "$#" -ge 2 ] || { boundary_gate_usage; exit 2; }
                BASE=$2
                shift
                ;;
            --checkout)
                [ "$#" -ge 2 ] || { boundary_gate_usage; exit 2; }
                EXISTING_CHECKOUT=$2
                shift
                ;;
            --repo)
                [ "$#" -ge 2 ] || { boundary_gate_usage; exit 2; }
                REPO=$2
                shift
                ;;
            --manual)
                [ "$#" -ge 2 ] || { boundary_gate_usage; exit 2; }
                case $2 in
                    *:?*) ;;
                    *) boundary_gate_fail '--manual needs NAME:REASON'; boundary_gate_usage; exit 2 ;;
                esac
                MANUALS="${MANUALS}${MANUALS:+
}$2"
                shift
                ;;
            --dry-run)
                DRY_RUN=1
                ;;
            -h | --help)
                boundary_gate_usage
                exit 0
                ;;
            *)
                boundary_gate_usage
                boundary_gate_fail "unknown argument: $1"
                exit 2
                ;;
        esac
        shift
    done

    if [ -n "$PATCH" ] && [ -z "$BASE" ]; then
        boundary_gate_usage
        boundary_gate_fail '--patch needs --base COMMIT'
        exit 2
    fi
    if [ -n "$EXISTING_CHECKOUT" ] && [ -z "$BASE" ]; then
        boundary_gate_usage
        boundary_gate_fail '--checkout needs --base COMMIT'
        exit 2
    fi

    WORK=$(mktemp -d "${TMPDIR:-/tmp}/osa-boundary.XXXXXX") || {
        boundary_gate_fail 'cannot create a temporary work directory'
        exit 2
    }
    trap 'rm -rf "$WORK"' EXIT HUP INT TERM
    : > "$WORK/check-results"
    : > "$WORK/manuals"
    CHECK_RESULTS=$WORK/check-results
    if [ -n "${MANUALS:-}" ]; then
        printf '%s\n' "$MANUALS" > "$WORK/manuals"
    fi
    boundary_gate_note "work: $WORK"

    # No host git identity, no credential helper, no prompt: the checkout runs
    # with a fixed identity and cannot reach the host's credential store.
    GIT_AUTHOR_NAME=osa-boundary
    GIT_AUTHOR_EMAIL=boundary@osa.invalid
    GIT_COMMITTER_NAME=osa-boundary
    GIT_COMMITTER_EMAIL=boundary@osa.invalid
    GIT_CONFIG_GLOBAL=/dev/null
    GIT_CONFIG_NOSYSTEM=1
    GIT_TERMINAL_PROMPT=0
    export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL
    export GIT_CONFIG_GLOBAL GIT_CONFIG_NOSYSTEM GIT_TERMINAL_PROMPT

    if [ -n "$PATCH" ]; then
        [ -f "$PATCH" ] || boundary_gate_stop "refused: no patch file at $PATCH"
        boundary_gate_target
        boundary_gate_apply "$TARGET" "$base_sha"
        boundary_gate_note "patch commit: $PATCH_COMMIT"
    else
        PATCH_COMMIT="none (working tree $(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || printf unknown))"
    fi

    if [ "$DRY_RUN" = 1 ]; then
        boundary_gate_note 'dry run: the fixed command set, in order:'
        target_display=${TARGET:-$REPO}
        if [ -n "$PATCH" ]; then
            boundary_gate_prepare_display "$target_display"
            boundary_gate_runner "$TARGET" "$base_sha" || exit 1
        else
            RUNNER=$REPO/scripts/test-all.sh
        fi
        boundary_gate_note "1/3 suite gate: sh $RUNNER $target_display"
        boundary_gate_note "2/3 live journey run: (cd $target_display && bun bridge/test/journeys/harness/live.ts)"
        boundary_gate_note "3/3 isolation checks: sh $REPO/tests/boundary/checks.sh --sandbox ${SANDBOX:-<none>}"
        boundary_gate_note 'dry run: no suite and no check ran; the verdict is incomplete'
        VERDICT=incomplete
        boundary_gate_record
        exit 2
    fi

    boundary_gate_prereqs
    boundary_gate_agent_version
    boundary_gate_suites "${TARGET:-$REPO}" "${base_sha:-}"
    boundary_gate_checks
    VERDICT=passed
    boundary_gate_record
    exit 0
}

# Prints the preparation commands without a target to install into.
boundary_gate_prepare_display() { # TARGET
    boundary_gate_note "prepare: (cd $1/bridge && bun install --frozen-lockfile)"
    boundary_gate_note "prepare: (cd $1/oskhs && bun install --frozen-lockfile)"
    boundary_gate_note "prepare: (cd $1/dashboard && bun install)"
}

case ${0##*/} in
    gate.sh) boundary_gate_main "$@" ;;
esac
