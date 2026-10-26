#!/bin/sh
# check-playbooks.sh - validate the docs/ai pages against document-contract.md.
#
# Every Markdown file under docs/ai is scanned. A file with no backticked
# metadata `Kind` row is skipped, so the contract page and unretrofitted pages
# do not need an exemption list. Fenced code blocks are stripped before
# metadata and headings are read, so a template cannot satisfy a requirement
# for a real section.
#
# Exit status: 0 when every enforced page passes, 1 on any failure, 2 on usage.
# POSIX sh only: no bash arrays, no pipefail, no local.

set -u

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd) || exit 2
cd "$root" || exit 2

docs_dir=${1:-docs/ai}
if [ ! -d "$docs_dir" ]; then
    printf 'check-playbooks: not a directory: %s\n' "$docs_dir" >&2
    exit 2
fi

work_dir=$(mktemp -d) || {
    printf 'check-playbooks: cannot create a temporary directory\n' >&2
    exit 2
}
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM

find "$docs_dir" -type f -name '*.md' -print | sort > "$work_dir/files" || exit 2

failures=0
fail() {
    printf '%s: %s\n' "$1" "$2"
    failures=$((failures + 1))
}

required_sections() {
    case $1 in
        router) printf '%s\n' '## Scope' '## Copy this prompt' '## Phase map' '## Stop if' '## Invariants' '## See also' ;;
        playbook) printf '%s\n' '## Scope' '## Inputs' '## Handoff' '## Invariants' '## See also' ;;
        verification) printf '%s\n' '## Scope' '## Invariants' '## See also' ;;
        reference) printf '%s\n' '## Scope' '## See also' ;;
        *) return 1 ;;
    esac
}

extra_fields() {
    case $1 in
        playbook) printf '%s\n' Preconditions Handoff Verification Reference ;;
        verification) printf '%s\n' Reference ;;
        *) : ;;
    esac
}

while IFS= read -r file; do
    # Strip fenced code blocks before reading metadata or headings.
    awk '
        /^[[:space:]]*(```|~~~)/ { fence = !fence; next }
        !fence { print }
    ' "$file" > "$work_dir/body"

    # The Kind value is backticked, so tables that merely discuss kinds do not
    # opt a page in.
    kind=$(sed -n 's/^| *Kind *| *`\([^`]*\)` *|.*$/\1/p' "$work_dir/body" | sed -n '1p')
    [ -n "$kind" ] || continue

    case $kind in
        router|playbook|verification|reference) ;;
        *)
            fail "$file" "unknown Kind \`$kind\`"
            continue
            ;;
    esac

    for field in Doc Kind Agent Covers Verified; do
        value=$(sed -n "s/^| *$field *| *\(.*\) *| *$/\1/p" "$work_dir/body" | sed -n '1p')
        value=$(printf '%s\n' "$value" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        [ -n "$value" ] || fail "$file" "missing metadata field $field"
    done

    for field in $(extra_fields "$kind"); do
        value=$(sed -n "s/^| *$field *| *\(.*\) *| *$/\1/p" "$work_dir/body" | sed -n '1p')
        value=$(printf '%s\n' "$value" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        [ -n "$value" ] || fail "$file" "missing metadata field $field"
    done

    required_sections "$kind" > "$work_dir/sections"
    while IFS= read -r section; do
        grep -q "^$section" "$work_dir/body" || fail "$file" "missing $section"
    done < "$work_dir/sections"

    case $kind in
        playbook) block_pattern='^## Phase([[:space:]]|$)'; block_name='## Phase' ;;
        verification) block_pattern='^## Check([[:space:]]|$)'; block_name='## Check' ;;
        *) block_pattern=''; block_name='' ;;
    esac

    if [ -n "$block_pattern" ]; then
        awk -v file="$file" -v block_pattern="$block_pattern" -v block_name="$block_name" '
            function finish_verify() {
                if (in_verify && !verify_expected) {
                    print file ": " block ": missing Expected: in ### Verify"
                    bad = 1
                }
                in_verify = 0
            }
            function finish_block() {
                if (!in_block) return
                finish_verify()
                if (!has_run) {
                    print file ": " block ": missing ### Run"
                    bad = 1
                }
                if (!has_verify) {
                    print file ": " block ": missing ### Verify"
                    bad = 1
                }
                if (!has_stop) {
                    print file ": " block ": missing ### Stop if"
                    bad = 1
                }
            }
            /^## / {
                finish_block()
                if ($0 ~ block_pattern) {
                    blocks++
                    in_block = 1
                    block = $0
                    has_run = 0
                    has_verify = 0
                    has_stop = 0
                } else {
                    in_block = 0
                }
                next
            }
            in_block && /^### / {
                finish_verify()
                if ($0 ~ /^### Run([[:space:]]|$)/) has_run = 1
                else if ($0 ~ /^### Verify([[:space:]]|$)/) {
                    has_verify = 1
                    in_verify = 1
                    verify_expected = 0
                }
                else if ($0 ~ /^### Stop if([[:space:]]|$)/) has_stop = 1
                next
            }
            in_block && in_verify && /^Expected:/ { verify_expected = 1 }
            END {
                finish_block()
                if (blocks == 0) {
                    print file ": missing " block_name " block"
                    bad = 1
                }
                exit bad
            }
        ' "$work_dir/body" || failures=$((failures + 1))
    fi
done < "$work_dir/files"

if [ "$failures" -ne 0 ]; then
    printf '%s failure(s)\n' "$failures" >&2
    exit 1
fi

printf 'check-playbooks: ok\n'
