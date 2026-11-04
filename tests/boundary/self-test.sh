#!/bin/sh
# self-test.sh - the offline proof for the boundary gate and its checks.
#
# No gateway, engine, image, or network: every case uses recorded evidence and
# a throwaway git repository, so the checks, the patch refusals, the fixed
# command set, and the record verdicts can be exercised anywhere.
#
# Run it directly or with `make lint`'s shellcheck; it is not part of
# `make test-all`, which must keep its meaning.
#
# Output is TAP-like: `ok - <case>` / `not ok - <case>`, with the captured
# output printed for a failure. Exit: 0 every case passed, 1 any failed.
#
# POSIX sh only.

set -u

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P) || exit 2
root=$(CDPATH='' cd -- "$here/../.." && pwd -P) || exit 2
work=$(mktemp -d "${TMPDIR:-/tmp}/osa-boundary-self.XXXXXX") || exit 2
trap 'rm -rf "$work"' EXIT HUP INT TERM

passed=0
failed=0
last_output=

ok() { # NAME
    passed=$((passed + 1))
    printf 'ok - %s\n' "$1"
}

not_ok() { # NAME DETAIL
    failed=$((failed + 1))
    printf 'not ok - %s: %s\n' "$1" "$2"
    if [ -n "$last_output" ] && [ -f "$last_output" ]; then
        sed -n '1,40p' "$last_output" | sed 's/^/    /'
    fi
}

expect_status() { # NAME EXPECTED ACTUAL
    if [ "$2" = "$3" ]; then
        ok "$1"
    else
        not_ok "$1" "exit $3, expected $2"
    fi
}

expect_in_output() { # NAME FILE TEXT
    if grep -qF -- "$3" "$2"; then
        ok "$1"
    else
        not_ok "$1" "output does not contain: $3"
    fi
}

expect_not_in_output() { # NAME FILE TEXT
    if grep -qF -- "$3" "$2"; then
        not_ok "$1" "output contains: $3"
    else
        ok "$1"
    fi
}

# ---------------------------------------------------------------------------
# Evidence fixtures
# ---------------------------------------------------------------------------

good_evidence() { # DIR
    mkdir -p "$1"
    printf 'curl: (7) Failed to connect to example.com port 443: Connection refused\n' \
        > "$1/probe.out"
    printf '7\n' > "$1/probe.exit"

    printf 'boundary-fixture_1_ANTHROPIC_API_KEY\n' > "$1/credential"
    printf '0\n' > "$1/credential.exit"

    printf "ls: cannot access '/Users': No such file or directory\n" > "$1/host-path-ls.out"
    printf '2\n' > "$1/host-path-ls.exit"
    printf "touch: cannot touch '/usr/probe': Permission denied\n" > "$1/host-path-touch.out"
    printf '1\n' > "$1/host-path-touch.exit"

    printf 'uid=1500(sandbox) gid=1500(sandbox) groups=1500(sandbox)\n' > "$1/id.out"

    cat > "$1/policy-full.yaml" <<'YAML'
version: 1
filesystem_policy:
  include_workdir: true
  read_only:
    - /usr
    - /etc
  read_write:
    - /sandbox
    - /tmp
    - /dev/null
landlock:
  compatibility: hard_requirement
process:
  run_as_user: "1500"
  run_as_group: "1500"
network_policies:
  _provider_maki_anthropic:
    name: _provider_maki_anthropic
    endpoints:
      - host: api.anthropic.com
        port: 443
        protocol: rest
        enforcement: enforce
        access: read-write
    binaries:
      - path: /usr/local/bin/maki
YAML

    cat > "$1/gateway-log.txt" <<'LOG'
[1791199570.521] [sandbox] [OCSF ] [ocsf] NET:REFUSE [MED] DENIED example.com [reason:policy_dns_ineligible]
[1791199570.522] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(0) -> example.com:443 [reason:transparent_tcp_policy_denied]
LOG
}

run_checks() { # EVIDENCE [ARGS...]
    evidence=$1
    shift
    last_output=$work/checks.out
    sh "$here/checks.sh" run --evidence "$evidence" --gateway-version 0.1.7 "$@" \
        > "$last_output" 2>&1
}

# ---------------------------------------------------------------------------
# 1. The scripted checks
# ---------------------------------------------------------------------------

case_good_evidence() {
    good_evidence "$work/good"
    run_checks "$work/good"
    expect_status 'checks: good evidence passes' 0 "$?"
    expect_in_output 'checks: the egress check reports a pass' "$last_output" \
        'PASS egress-denied:'
    expect_in_output 'checks: the credential check reports a pass' "$last_output" \
        'PASS credential-shape:'
    expect_in_output 'checks: the gateway-log check reports a pass' "$last_output" \
        'PASS gateway-log-refusal:'
    if [ "$(grep -c '^PASS ' "$last_output")" = 6 ]; then
        ok 'checks: all six checks pass on good evidence'
    else
        not_ok 'checks: all six checks pass on good evidence' 'expected six PASS lines'
    fi
}

case_credential_leak() {
    secret='sk-ant-api03-FIXTURESECRETVALUE_ANTHROPIC_API_KEY'
    cp -R "$work/good" "$work/leak"
    printf '%s\n' "$secret" > "$work/leak/credential"
    run_checks "$work/leak"
    expect_status 'checks: a key-shaped credential fails' 1 "$?"
    expect_in_output 'checks: the credential failure names the variable' "$last_output" \
        'FAIL credential-shape: ANTHROPIC_API_KEY'
    expect_not_in_output 'checks: the credential failure prints no part of the value' \
        "$last_output" 'FIXTURESECRETVALUE'
    expect_in_output 'checks: a key-shaped value is named as a key shape' "$last_output" \
        'credential key shape'
}

case_credential_unbound() {
    cp -R "$work/good" "$work/unbound"
    printf 'boundary-fixture_1_SOME_OTHER_API_KEY\n' > "$work/unbound/credential"
    run_checks "$work/unbound"
    expect_status 'checks: a value not bound to the variable fails' 1 "$?"
    expect_in_output 'checks: the unbound failure names the variable' "$last_output" \
        'does not end in _ANTHROPIC_API_KEY'
}

case_wildcard_policy() {
    cp -R "$work/good" "$work/wildcard"
    cat >> "$work/wildcard/policy-full.yaml" <<'YAML'
  allow_all:
    name: allow_all
    endpoints:
      - host: '*'
        port: 443
YAML
    run_checks "$work/wildcard"
    expect_status 'checks: a wildcard rule fails the egress check' 1 "$?"
    expect_in_output 'checks: the wildcard failure names the rule' "$last_output" 'allow_all'
}

case_probe_succeeded() {
    cp -R "$work/good" "$work/ok-probe"
    printf 'HTTP/2 200\n' > "$work/ok-probe/probe.out"
    printf '0\n' > "$work/ok-probe/probe.exit"
    run_checks "$work/ok-probe"
    expect_status 'checks: a successful probe fails the egress check' 1 "$?"
    expect_in_output 'checks: the failed egress check names the probe host' "$last_output" \
        'FAIL egress-denied:'
}

case_uid_not_1500() {
    cp -R "$work/good" "$work/uid"
    printf 'uid=0(root) gid=0(root) groups=0(root)\n' > "$work/uid/id.out"
    run_checks "$work/uid"
    expect_status 'checks: a root sandbox process fails' 1 "$?"
    expect_in_output 'checks: the identity failure names the observed uid' "$last_output" \
        'uid=0(root)'
}

case_mount_declared() {
    cp -R "$work/good" "$work/mount"
    cat >> "$work/mount/policy-full.yaml" <<'YAML'
mounts:
  - host: /Users/someone/project
    container: /sandbox/project
YAML
    run_checks "$work/mount"
    expect_status 'checks: a declared mount fails' 1 "$?"
    expect_in_output 'checks: the mount failure names the declaration' "$last_output" \
        'FAIL no-bind-mount:'
}

case_log_empty() {
    cp -R "$work/good" "$work/log-empty"
    : > "$work/log-empty/gateway-log.txt"
    run_checks "$work/log-empty"
    expect_status 'checks: an empty gateway log fails' 1 "$?"
    expect_in_output 'checks: the empty-log failure names the gateway version' "$last_output" \
        '0.1.7'
}

case_log_unknown_format() {
    cp -R "$work/good" "$work/log-format"
    printf '2026-11-04T10:00:00Z policy denied the request\n' > "$work/log-format/gateway-log.txt"
    run_checks "$work/log-format"
    expect_status 'checks: an unrecognized log format fails' 1 "$?"
    expect_in_output 'checks: the format failure names the gateway version' "$last_output" \
        '0.1.7'
}

case_missing_evidence() {
    mkdir -p "$work/missing"
    run_checks "$work/missing"
    expect_status 'checks: absent evidence fails instead of passing' 1 "$?"
    expect_in_output 'checks: the missing-evidence failure names the file' "$last_output" \
        'probe.out'
}

case_manual_check() {
    run_checks "$work/good" --manual 'policy-review:needs a human judgment'
    expect_status 'checks: a manual check makes the run incomplete' 2 "$?"
    expect_in_output 'checks: the manual check is recorded by name' "$last_output" \
        'MANUAL policy-review:'
    expect_in_output 'checks: an incomplete run is not a pass' "$last_output" \
        'not a boundary pass'
}

case_collect_evidence() {
    evidence=$work/collected
    last_output=$work/collect.out
    stub_log=$work/collect-stub.log
    stub_state=$work/collect-stub-state
    mkdir -p "$stub_state"
    STUB_LOG=$stub_log STUB_STATE_DIR=$stub_state STUB_EXEC_STDOUT='boundary-fixture_1_DEMO_TOKEN' \
        STUB_EXEC_EXIT=0 STUB_POLICY_FULL='version: 1' \
        PATH="$root/tests/stub:$PATH" \
        sh "$here/checks.sh" collect --sandbox self-test --evidence "$evidence" \
        --credential-var DEMO_TOKEN > "$last_output" 2>&1
    expect_status 'checks: collect records evidence and the checks fail honestly' 1 "$?"
    for file in probe.out probe.exit credential credential.exit policy-full.yaml \
        gateway-log.txt host-path-ls.out host-path-ls.exit host-path-touch.out \
        host-path-touch.exit id.out; do
        if [ -f "$evidence/$file" ]; then
            ok "checks: collect wrote $file"
        else
            not_ok "checks: collect wrote $file" 'missing evidence file'
        fi
    done
    expect_in_output 'checks: collected evidence feeds the credential check' "$last_output" \
        'PASS credential-shape:'
    expect_not_in_output 'checks: collect never prints the credential value' "$last_output" \
        'boundary-fixture_1_DEMO_TOKEN'
}

# ---------------------------------------------------------------------------
# 2. The gate's patch input
# ---------------------------------------------------------------------------

make_repo() { # DIR
    mkdir -p "$1/scripts"
    printf 'all:\n\t@sh scripts/test-all.sh\n' > "$1/Makefile"
    cat > "$1/scripts/test-all.sh" <<'RUNNER'
#!/bin/sh
# ROOT argument (fixture runner for the boundary gate self-test).
target=${1:-$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)}
printf 'fixture suite: %s\n' "$target"
RUNNER
    printf 'base\n' > "$1/base.txt"
    git -C "$1" init -q
    git -C "$1" add -A
    git -C "$1" -c user.name=self-test -c user.email=self-test@osa.invalid \
        commit -qm 'fixture base'
}

make_fixtures() {
    fixture=$work/fixture
    make_repo "$fixture"
    base_a=$(git -C "$fixture" rev-parse HEAD)

    # A patch made against base_a.
    printf 'patched\n' > "$fixture/base.txt"
    git -C "$fixture" diff --binary --full-index > "$work/valid.diff"
    git -C "$fixture" checkout -- base.txt

    # A patch that rewrites the suite runner itself.
    cat > "$fixture/scripts/test-all.sh" <<'RUNNER'
#!/bin/sh
printf 'patched runner ran on the target\n'
RUNNER
    git -C "$fixture" diff --binary --full-index > "$work/runner.diff"
    git -C "$fixture" checkout -- scripts/test-all.sh

    # A later commit, so the same patch mismatches another base.
    printf 'other\n' > "$fixture/base.txt"
    git -C "$fixture" -c user.name=self-test -c user.email=self-test@osa.invalid \
        commit -qam 'fixture second'
    base_b=$(git -C "$fixture" rev-parse HEAD)

    # A hand-written patch whose path leaves the checkout.
    cat > "$work/escape.diff" <<'PATCH'
diff --git a/../escape.txt b/../escape.txt
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/../escape.txt
@@ -0,0 +1 @@
+escaped
PATCH
}

run_gate() { # ARGS...
    last_output=$work/gate.out
    sh "$here/gate.sh" "$@" > "$last_output" 2>&1
}

case_gate_no_gateway() {
    mkdir -p "$work/fakebin"
    cat > "$work/fakebin/openshell" <<'STUB'
#!/bin/sh
printf 'gateway unreachable\n' >&2
exit 1
STUB
    chmod +x "$work/fakebin/openshell"
    last_output=$work/gate.out
    PATH="$work/fakebin:$PATH" sh "$here/gate.sh" --sandbox self-test \
        > "$last_output" 2>&1
    expect_status 'gate: no reachable gateway exits non-zero' 1 "$?"
    expect_in_output 'gate: the missing-gateway failure names the gateway' "$last_output" \
        'missing prerequisite: gateway'
    expect_not_in_output 'gate: no suite ran without a gateway' "$last_output" \
        '1/3 suite gate'
    expect_in_output 'gate: the failed run records a failed verdict' "$last_output" \
        'verdict: failed'
}

case_gate_mismatched_base() {
    run_gate --patch "$work/valid.diff" --base "$base_b" --repo "$fixture" --dry-run
    expect_status 'gate: a mismatched base is refused' 1 "$?"
    expect_in_output 'gate: the mismatch names the base' "$last_output" \
        'does not match base'
    expect_in_output 'gate: the mismatch names the file' "$last_output" 'base.txt'
    expect_not_in_output 'gate: no suite ran on a mismatched base' "$last_output" \
        '1/3 suite gate'
}

case_gate_dirty_target() {
    git clone --quiet --no-hardlinks "$fixture" "$work/dirty"
    git -C "$work/dirty" checkout --quiet --detach "$base_a"
    printf 'dirty\n' >> "$work/dirty/base.txt"
    run_gate --patch "$work/valid.diff" --base "$base_a" --checkout "$work/dirty" --dry-run
    expect_status 'gate: a dirty target is refused' 1 "$?"
    expect_in_output 'gate: the dirty refusal names the tree' "$last_output" \
        'the target tree is dirty'
    expect_not_in_output 'gate: no suite ran on a dirty target' "$last_output" \
        '1/3 suite gate'
}

case_gate_escaping_path() {
    run_gate --patch "$work/escape.diff" --base "$base_a" --repo "$fixture" --dry-run
    expect_status 'gate: a path escaping the checkout is refused' 1 "$?"
    expect_in_output 'gate: the escaping path is named' "$last_output" '../escape.txt'
    expect_not_in_output 'gate: no suite ran on an escaping path' "$last_output" \
        '1/3 suite gate'
}

case_gate_valid_patch() {
    run_gate --patch "$work/valid.diff" --base "$base_a" --repo "$fixture" --dry-run
    status=$?
    expect_status 'gate: a valid patch is prepared and reported' 2 "$status"
    expect_in_output 'gate: the report names a fresh checkout' "$last_output" \
        'checkout: '
    expect_in_output 'gate: the report names the patch commit' "$last_output" \
        'patch commit: '
    expect_in_output 'gate: the dry run is incomplete, not passed' "$last_output" \
        'verdict: incomplete'
    work_dir=$(sed -n 's/^test-boundary: work: //p' "$last_output" | sed -n '1p')
    if [ -n "$work_dir" ] && [ ! -e "$work_dir" ]; then
        ok 'gate: the throwaway checkout is removed on exit'
    else
        not_ok 'gate: the throwaway checkout is removed on exit' \
            "work directory still exists: ${work_dir:-unknown}"
    fi
}

case_gate_patch_cannot_choose_command() {
    run_gate --patch "$work/runner.diff" --base "$base_a" --repo "$fixture" --dry-run
    expect_status 'gate: a patch that rewrites the runner is still gated' 2 "$?"
    expect_in_output 'gate: the fixed command set names the base copy of the runner' \
        "$last_output" 'runner/test-all.sh'
    expect_not_in_output 'gate: the rewritten runner is not the one named' "$last_output" \
        'checkout/scripts/test-all.sh'
    expect_in_output 'gate: the gate names the live journey command' "$last_output" \
        'bun bridge/test/journeys/harness/live.ts'
    expect_in_output 'gate: the gate names the checks command' "$last_output" \
        'tests/boundary/checks.sh'
}

# ---------------------------------------------------------------------------
# 3. The record
# ---------------------------------------------------------------------------

case_record_block() {
    # shellcheck disable=SC1091
    . "$here/gate.sh"

    # Read by the sourced boundary_gate_record; exporting them keeps the
    # assignment visible to shellcheck across the sourced file's boundary.
    GATEWAY_RECORD='OpenShell 0.1.7'
    AGENT_VERSION='maki 0.6.5'
    ENGINE_RECORD='docker 29.4.0'
    IMAGE_RECORD='maki-agent:local (sha256:fixture)'
    PATCH_COMMIT='0123456789abcdef0123456789abcdef01234567'
    export GATEWAY_RECORD AGENT_VERSION ENGINE_RECORD IMAGE_RECORD PATCH_COMMIT
    CHECK_RESULTS=$work/record-results
    cat > "$CHECK_RESULTS" <<'RESULTS'
egress-denied|pass
credential-shape|pass
gateway-log-refusal|pass
RESULTS

    VERDICT=passed
    export VERDICT
    boundary_gate_record > "$work/record-pass.out"
    last_output=$work/record-pass.out
    for field in 'gateway: OpenShell 0.1.7' 'agent: maki 0.6.5' 'engine: docker 29.4.0' \
        'image: maki-agent:local (sha256:fixture)' 'patch: 0123456789abcdef' \
        'checks:' 'egress-denied: pass' 'verdict: passed'; do
        expect_in_output "record: a passing run prints '$field'" "$last_output" "$field"
    done

    printf 'policy-review|manual\n' >> "$CHECK_RESULTS"
    VERDICT=incomplete
    export VERDICT
    boundary_gate_record > "$work/record-incomplete.out"
    last_output=$work/record-incomplete.out
    expect_in_output 'record: a partial run is marked incomplete' "$last_output" \
        'verdict: incomplete'
    expect_in_output 'record: the manual check is named' "$last_output" 'policy-review: manual'
    if grep -qF 'verdict: passed' "$work/record-incomplete.out"; then
        not_ok 'record: an incomplete run cannot read as a pass' 'contains verdict: passed'
    else
        ok 'record: an incomplete run cannot read as a pass'
    fi

    printf 'host-paths|fail\n' >> "$CHECK_RESULTS"
    VERDICT=failed
    export VERDICT
    boundary_gate_record > "$work/record-failed.out"
    last_output=$work/record-failed.out
    expect_in_output 'record: a failed check is named with its outcome' "$last_output" \
        'host-paths: fail'
    expect_in_output 'record: a failed run records a failed verdict' "$last_output" \
        'verdict: failed'
}

# ---------------------------------------------------------------------------
# 4. The documentation contract
# ---------------------------------------------------------------------------

case_docs_point_at_the_gate() {
    for page in maki opencode claude codex; do
        file=$root/docs/ai/verification/$page.md
        if [ -f "$file" ] && grep -q 'test-boundary' "$file"; then
            ok "docs: $page.md points at the gate"
        else
            not_ok "docs: $page.md points at the gate" "no test-boundary reference in $file"
        fi
    done
    file=$root/docs/ai/verification/claims.md
    if [ -f "$file" ] && grep -q 'boundary' "$file" && grep -q 'test-boundary' "$file"; then
        ok 'docs: the claim table names the boundary layer and its gate'
    else
        not_ok 'docs: the claim table names the boundary layer and its gate' 'claims.md is incomplete'
    fi
}

# ---------------------------------------------------------------------------

case_good_evidence
case_credential_leak
case_credential_unbound
case_wildcard_policy
case_probe_succeeded
case_uid_not_1500
case_mount_declared
case_log_empty
case_log_unknown_format
case_missing_evidence
case_manual_check
case_collect_evidence

make_fixtures
case_gate_no_gateway
case_gate_mismatched_base
case_gate_dirty_target
case_gate_escaping_path
case_gate_valid_patch
case_gate_patch_cannot_choose_command

case_record_block
case_docs_point_at_the_gate

printf '\n%s passed, %s failed\n' "$passed" "$failed"
[ "$failed" -eq 0 ]
