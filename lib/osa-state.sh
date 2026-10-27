# shellcheck shell=sh
#
# osa-state: the state root every agent front-end shares and the contract its
# files publish. Sourced by lib/oss-core.sh and by bin/osa; it only defines
# functions and constants.
#
# Every agent front-end keeps its state under one root, $state_root
# ($XDG_STATE_HOME/osa). Two kinds of files there are a published contract
# that other tools (osa, the dashboard) read without writing: the registry
# entries projects/<sandbox>.toml and each session's `pending` marker. Both are
# flat TOML (`key = "value"` lines, version "1"); keys may be added within a
# version but never removed, renamed, or repurposed. Everything else under the
# root is internal.
#
# POSIX sh. See docs/helper.md for the full reference.

# The state root every agent front-end shares: $XDG_STATE_HOME/osa.
OSA_STATE_DIR=osa

TAB=$(printf '\t')
NL='
'

# Sets state_base, state_root, and registry_dir from the environment.
# shellcheck disable=SC2034  # read by the sourcing scripts
osa_state_paths() {
    state_base=${XDG_STATE_HOME:-${HOME:-/tmp}/.local/state}
    state_root=$state_base/$OSA_STATE_DIR
    registry_dir=$state_root/projects
}

# Parse a flat TOML file as data and print `key<TAB>value` lines. The parser
# accepts `key = "value"`, comments, and blank lines, and reports keys outside
# ALLOWED (a space-separated list, or `*` for any key); the file is never
# sourced, so it cannot execute code.
parse_flat_file() { # FILE ALLOWED
    awk -v allowed="$2" '
        BEGIN {
            any = (allowed == "*")
            n = split(allowed, names, " ")
            for (i = 1; i <= n; i++) known[names[i]] = 1
            errors = 0
        }
        function problem(message) {
            printf "%s:%d: %s\n", FILENAME, NR, message > "/dev/stderr"
            errors++
        }
        {
            line = $0
            sub(/[[:space:]]+$/, "", line)
            if (line == "" || line ~ /^[[:space:]]*#/) next
            eq = index(line, "=")
            if (eq == 0) { problem("expected: key = \"value\""); next }
            key = substr(line, 1, eq - 1)
            value = substr(line, eq + 1)
            gsub(/^[[:space:]]+/, "", key)
            gsub(/[[:space:]]+$/, "", key)
            gsub(/^[[:space:]]+/, "", value)
            if (key !~ /^[a-z][a-z0-9_]*$/) { problem("invalid key <" key ">"); next }
            if (!any && !(key in known)) { problem("unknown key <" key ">"); next }
            if (value !~ /^"/) { problem("value for <" key "> must be a quoted string"); next }
            if (value !~ /^"([^"\\]|\\.)*"/) { problem("unterminated value for <" key ">"); next }
            match(value, /^"([^"\\]|\\.)*"/)
            quoted = substr(value, RSTART + 1, RLENGTH - 2)
            rest = substr(value, RLENGTH + 1)
            gsub(/^[[:space:]]+/, "", rest)
            if (rest != "" && rest !~ /^#/) { problem("unexpected text after value for <" key ">"); next }
            if (quoted ~ /\t/) { problem("tab characters are not supported in values"); next }
            gsub(/\\"/, "\"", quoted)
            gsub(/\\\\/, "\\", quoted)
            print key "\t" quoted
        }
        END { exit (errors > 0 ? 1 : 0) }
    ' "$1"
}

flat_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# shellcheck disable=SC2034  # written into every contract file by the sourcers
STATE_VERSION=1

# Prints the value of KEY in a flat TOML file, or nothing. Unknown keys are
# accepted so newer writers stay readable.
flat_value() { # FILE KEY
    [ -f "$1" ] || return 0
    parse_flat_file "$1" '*' 2>/dev/null \
        | awk -F "$TAB" -v k="$2" '$1 == k { print substr($0, length(k) + 2); exit }'
}

# Writes FILE atomically (mode 600) as flat TOML from KEY VALUE pairs. A value
# with a newline or tab cannot be stored and fails the whole write.
flat_write() { # FILE KEY VALUE [KEY VALUE ...]
    fw_file=$1
    shift
    fw_tmp=$fw_file.$$
    if ! (
        umask 077
        : >"$fw_tmp" || exit 1
        while [ "$#" -ge 2 ]; do
            case $2 in
                *"$NL"*|*"$TAB"*) exit 1 ;;
            esac
            printf '%s = "%s"\n' "$1" "$(flat_escape "$2")" >>"$fw_tmp" || exit 1
            shift 2
        done
    ); then
        rm -f "$fw_tmp"
        return 1
    fi
    mv -- "$fw_tmp" "$fw_file" 2>/dev/null || { rm -f "$fw_tmp"; return 1; }
}

# Prints a cheap fingerprint of a git project: HEAD plus a checksum of
# `git status` and the diff against HEAD. It covers commits and tracked,
# staged, unstaged, and untracked non-ignored changes without hashing the
# tree. Prints nothing for a plain folder or a host without git. Optional
# locks stay off so the fingerprint never writes the project's index.
project_fingerprint() { # DIR
    command -v git >/dev/null 2>&1 || return 0
    (
        cd "$1" 2>/dev/null || exit 0
        GIT_OPTIONAL_LOCKS=0
        export GIT_OPTIONAL_LOCKS
        [ "$(git rev-parse --is-inside-work-tree 2>/dev/null)" = true ] || exit 0
        pf_head=$(git rev-parse -q --verify HEAD 2>/dev/null) || pf_head=none
        pf_sum=$(
            {
                git status --porcelain=v1 -z --untracked-files=normal 2>/dev/null || :
                if [ "$pf_head" != none ]; then
                    git diff HEAD --no-ext-diff --no-color --binary 2>/dev/null || :
                fi
            } | cksum | awk '{ print $1 "-" $2 }'
        )
        printf '%s-%s' "$pf_head" "$pf_sum"
    )
}

# Prints the pending kind recorded in a session directory: `retained`,
# `parked`, or nothing. A marker without a kind is retained when its patch
# file has content and parked otherwise.
pending_kind() { # SESSION_DIR
    [ -f "$1/pending" ] || return 0
    pk_kind=$(flat_value "$1/pending" kind)
    if [ -z "$pk_kind" ]; then
        pk_patch=$(flat_value "$1/pending" patch)
        if [ -n "$pk_patch" ] && [ -s "$pk_patch" ]; then
            pk_kind=retained
        else
            pk_kind=parked
        fi
    fi
    printf '%s' "$pk_kind"
}

# Prints S as a JSON string literal. Newlines become \n and carriage returns
# are dropped, so multi-line gateway text stays one valid literal.
json_str() { # S
    printf '"%s"' "$(printf '%s' "$1" | tr -d '\r' | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g' \
        | awk 'NR > 1 { printf "\\n" } { printf "%s", $0 }')"
}

# Session and resolve exclusion. Files under sessions/<sandbox>/locks/ are
# internal, not contract: a session writes `session.<pid>`, a resolve creates
# `resolve.d/` (mkdir is atomic) holding `pid`. Each side announces itself
# before it checks the other, so of two concurrent starters at least one sees
# the other. Sessions never check each other. A holder is live while
# `kill -0 <pid>` succeeds.

lock_pid_live() { # PID
    case $1 in
        ''|*[!0-9]*) return 1 ;;
    esac
    kill -0 "$1" 2>/dev/null
}

# Prints the PID of a live session in LOCK_DIR. With CLEAN=1 the files of
# dead sessions are removed on the way.
lock_session_pid() { # LOCK_DIR [CLEAN]
    for lsp_file in "$1"/session.*; do
        [ -f "$lsp_file" ] || continue
        lsp_pid=${lsp_file##*/session.}
        if lock_pid_live "$lsp_pid"; then
            printf '%s' "$lsp_pid"
            return 0
        fi
        if [ "${2:-0}" -eq 1 ]; then
            rm -f "$lsp_file"
        fi
    done
    return 1
}

# Prints the PID of a live resolve in LOCK_DIR, or `unknown` while its PID is
# not written yet. With CLEAN=1 a dead resolve's directory is removed.
lock_resolve_pid() { # LOCK_DIR [CLEAN]
    [ -d "$1/resolve.d" ] || return 1
    if [ ! -f "$1/resolve.d/pid" ]; then
        printf 'unknown'
        return 0
    fi
    lrp_pid=$(cat "$1/resolve.d/pid" 2>/dev/null) || lrp_pid=
    if lock_pid_live "$lrp_pid"; then
        printf '%s' "$lrp_pid"
        return 0
    fi
    if [ "${2:-0}" -eq 1 ]; then
        rm -rf "$1/resolve.d"
    fi
    return 1
}

# Succeeds while a live session or resolve holds LOCK_DIR. Read-only.
lock_busy() { # LOCK_DIR
    lock_session_pid "$1" >/dev/null || lock_resolve_pid "$1" >/dev/null
}

# Idle stop. A session's idle files are internal, not contract: `idle` is a
# stamp naming the session (`<epoch>.<pid>`), and `idle.log` holds one
# `<local time> <event> key=value...` line per event: `armed secs=N
# session=P watcher=W`, `closed session=P`, then one of `superseded`, `busy`,
# `scan-failed`, `stopped`, or `stop-failed`. Only idle_state reads them.

# Seconds since the epoch for a local `YYYY-mm-ddTHH:MM:SS` time.
local_epoch() { # TIME
    case $1 in
        [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]) ;;
        *) return 1 ;;
    esac
    date -d "$1" +%s 2>/dev/null \
        || date -j -f '%Y-%m-%dT%H:%M:%S' "$1" +%s 2>/dev/null
}

# ISO 8601 UTC for seconds since the epoch.
utc_iso() { # EPOCH
    date -u -d "@$1" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
        || date -u -r "$1" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null
}

file_mtime() { # FILE
    stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null
}

# Prints the idle-stop state of a session directory as one tab-separated
# line, `-` for an empty field:
#   STATE PERIOD DEADLINE ESTIMATED LAST_EVENT LAST_TIME
# STATE is off, none, running, counting, stopped, skipped, or failed; times
# are ISO 8601 UTC. SECS is the configured period: 0 means off, and it is the
# period only when no `armed` line names one, since a session's watcher uses
# the period it was armed with (`--idle-stop` may override the setting).
# Reads files only.
idle_state() { # DIR [SECS]
    is_log=$1/idle.log
    is_period=${2-}
    is_state=none
    is_deadline=
    is_estimated=false
    is_event=
    is_time=
    if [ "$is_period" = 0 ]; then
        is_state=off
    elif [ -f "$is_log" ]; then
        is_last=$(awk 'NF >= 2 { line = $0 } END { print line }' "$is_log")
        is_event=$(printf '%s\n' "$is_last" | awk '{ print $2 }')
        is_epoch=$(local_epoch "${is_last%% *}") || is_epoch=
        if [ -n "$is_epoch" ]; then
            is_time=$(utc_iso "$is_epoch")
        fi
        is_session=$(printf '%s\n' "$is_last" | sed -n 's/.* session=\([0-9][0-9]*\).*/\1/p')
        if [ -n "$is_session" ]; then
            is_armed=$(awk -v s="session=$is_session" '
                $2 == "armed" { for (i = 3; i <= NF; i++) if ($i == s) line = $0 }
                END { print line }' "$is_log" | sed -n 's/.* secs=\([0-9][0-9]*\).*/\1/p')
            if [ -n "$is_armed" ]; then
                is_period=$is_armed
            fi
        fi
        is_base=
        case $is_event in
            armed)
                if lock_pid_live "$is_session"; then
                    is_state=running
                else
                    # The session died without a `closed` line (its watcher
                    # was killed too): count from the stamp, as an estimate.
                    is_state=counting
                    is_estimated=true
                    is_base=$(file_mtime "$1/idle") || is_base=$is_epoch
                fi
                ;;
            closed)
                is_state=counting
                is_base=$is_epoch
                ;;
            stopped) is_state=stopped ;;
            superseded|busy) is_state=skipped ;;
            stop-failed|scan-failed) is_state=failed ;;
        esac
        if [ -n "$is_base" ] && [ -n "$is_period" ]; then
            is_deadline=$(utc_iso "$((is_base + is_period))")
        fi
    fi
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$is_state" "${is_period:--}" "${is_deadline:--}" \
        "$is_estimated" "${is_event:--}" "${is_time:--}"
}

# Prints a JSON string literal for S, or null for `-`.
json_or_null() { # S
    if [ "$1" = - ]; then
        printf 'null'
    else
        json_str "$1"
    fi
}

# Prints the idle state of a session directory as a JSON object:
# {period, state, deadline, estimated, last_event, last_time}.
idle_json() { # DIR [SECS]
    IFS=$TAB read -r ij_state ij_period ij_deadline ij_estimated ij_event ij_time <<IDLE
$(idle_state "$@")
IDLE
    case $ij_period in
        ''|-|*[!0-9]*) ij_period=null ;;
    esac
    printf '{"period":%s,"state":%s,"deadline":%s,"estimated":%s,"last_event":%s,"last_time":%s}' \
        "$ij_period" "$(json_str "$ij_state")" "$(json_or_null "$ij_deadline")" "$ij_estimated" \
        "$(json_or_null "$ij_event")" "$(json_or_null "$ij_time")"
}

# Prints one line describing a session directory's idle stop.
idle_text() { # DIR [SECS]
    IFS=$TAB read -r it_state it_period it_deadline it_estimated it_event it_time <<IDLE
$(idle_state "$@")
IDLE
    case $it_state in
        off) printf 'off' ;;
        none) printf 'no session has run' ;;
        running) printf 'session running' ;;
        counting)
            if [ "$it_deadline" = - ]; then
                printf 'counting down'
            elif [ "$it_estimated" = true ]; then
                printf 'counting down; stop due about %s (estimated)' "$it_deadline"
            else
                printf 'counting down; stop due %s' "$it_deadline"
            fi
            ;;
        stopped) printf 'stopped at %s' "$it_time" ;;
        skipped) printf 'skipped (%s at %s)' "$it_event" "$it_time" ;;
        failed) printf 'stop failed (%s at %s)' "$it_event" "$it_time" ;;
        *) printf '%s' "$it_state" ;;
    esac
    if [ "$it_period" != - ] && [ "$it_state" != off ]; then
        printf ' (period %ss)' "$it_period"
    fi
}
