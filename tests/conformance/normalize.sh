#!/bin/sh
# Closed normalization for conformance recordings.
#
# A recording is the stub openshell log for one case: invocations separated by
# `---`, one argv item per line, then zero or more `@env NAME` lines. Absolute
# paths and a few known-nondeterministic values are replaced so two runs of the
# same case compare byte-identically.
#
# The substitution set is closed and enumerated here; nothing else is
# replaced. Every addition needs a self-test in tests/conformance/self-test.sh
# proving that an added, removed, or reordered argument still differs after
# normalization.
#
#   <case>         the per-case directory
#   <work>         the suite's temporary root
#   <repo>         this repository
#   <tmp>          $TMPDIR (or /tmp)
#   <tmp-entry>    anything directly under <tmp>, whose names are random
#   <timestamp>    an ISO-8601 date and time
#   <date>         an ISO-8601 date
#   <epoch-ms>     a 13+ digit epoch value
#   <epoch>        a 10 digit epoch value
#   <sandbox-id>   a stub sandbox id (name + epoch + pid tail)
#   <commit>       a git object id, full or abbreviated (at least 7 hex digits
#                  including a letter)
#   <key>          a caller workspace key, a cksum of the workdir path
#   <pid>          a process id in a log line, tag, ref, or temp-file name
#
# Usage (sourced):  conformance_normalize CASE_DIR WORK_DIR REPO_DIR < in > out
# Usage (command):  normalize.sh CASE_DIR WORK_DIR < in > out

# A path that cannot appear in a recording, used when the caller passes none.
conformance_normalize_sentinel=/__conformance_no_match__

# Abbreviated git object ids are 7+ hex characters. An all-digit run of that
# length in captured output is a git abbreviation rather than an epoch or a
# pid (those are handled by the sed rules first). sed cannot express the
# length-and-shape check without mangling longer tokens, so this pass handles
# the remaining hex runs.
conformance_normalize_commits() {
    awk '
    {
        out = ""
        rest = $0
        while (match(rest, /[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*/)) {
            token = substr(rest, RSTART, RLENGTH)
            out = out substr(rest, 1, RSTART - 1)
            out = out "<commit>"
            rest = substr(rest, RSTART + RLENGTH)
        }
        print out rest
    }'
}

conformance_normalize() {
    cn_case=${1:-$conformance_normalize_sentinel}
    cn_work=${2:-$conformance_normalize_sentinel}
    cn_repo=${3:-$conformance_normalize_sentinel}
    cn_tmp=${TMPDIR:-/tmp}

    # Literal paths may contain sed-special characters.
    cn_case=$(printf '%s' "$cn_case" | sed -e 's/[\\&#]/\\&/g')
    cn_work=$(printf '%s' "$cn_work" | sed -e 's/[\\&#]/\\&/g')
    cn_repo=$(printf '%s' "$cn_repo" | sed -e 's/[\\&#]/\\&/g')
    cn_tmp=$(printf '%s' "$cn_tmp" | sed -e 's/[\\&#]/\\&/g')

    sed -E \
        -e "s#${cn_case}#<case>#g" \
        -e 's#<case>/sandbox/project#<case>/<fixture-workdir>#g' \
        -e "s#${cn_work}#<work>#g" \
        -e "s#${cn_repo}#<repo>#g" \
        -e 's#<case>/<fixture-workdir>#<case>/sandbox/project#g' \
        -e "s#${cn_tmp}#<tmp>#g" \
        -e 's#/tmp#<tmp>#g' \
        -e 's#[0-9a-f]{40}#<commit>#g' \
        -e 's#id-[A-Za-z0-9_.-]*-[0-9][0-9]*-[0-9][0-9]*#<sandbox-id>#g' \
        -e 's#caller/[0-9]+#caller/<key>#g' \
        -e 's#bundle/[0-9]+#bundle/<pid>#g' \
        -e 's#[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(Z|[+-][0-9]{2}:[0-9]{2})?#<timestamp>#g' \
        -e 's#[0-9]{8}T[0-9]{6}Z-[0-9]+#<timestamp>-<pid>#g' \
        -e 's#[0-9]{4}-[0-9]{2}-[0-9]{2}#<date>#g' \
        -e 's#[0-9]{13,}#<epoch-ms>#g' \
        -e 's#<epoch-ms>-[0-9]+#<epoch-ms>-<pid>#g' \
        -e 's#[0-9]{10}#<epoch>#g' \
        -e 's#-[0-9][0-9]*-<epoch>#-<pid>-<epoch>#g' \
        -e 's#session=[0-9]+#session=<pid>#g' \
        -e 's#watcher=[0-9]+#watcher=<pid>#g' \
        -e 's# baseline [0-9]+# baseline <pid>#g' \
        -e 's#PID [0-9]+#PID <pid>#g' \
        -e 's#(^|[^.])\.([0-9][0-9]+)([^0-9A-Za-z_.-]|$)#\1.<pid>\3#g' \
        -e 's#<tmp>/[A-Za-z0-9_.-]+#<tmp>/<entry>#g' \
        | conformance_normalize_commits
}

if [ "${0##*/}" = normalize.sh ]; then
    set -eu
    conformance_normalize_repo=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd -P)
    conformance_normalize "${1:-}" "${2:-}" "$conformance_normalize_repo"
fi
