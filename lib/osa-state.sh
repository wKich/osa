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

# Prints S as a JSON string literal.
json_str() { # S
    printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g')"
}
