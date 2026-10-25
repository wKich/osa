#!/bin/sh
# Stub-backed test suite for bin/maki-oss, the fish plugin, and the safety
# rules in specs/helper-cli and specs/fish-integration.
#
# Runs with only a POSIX shell and the stubs under tests/stub: no Docker, no
# gateway, no network. Run it with `make test` or directly:
#
#   tests/run-tests.sh

set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
MAKI=$ROOT/bin/maki-oss
STUB_DIR=$ROOT/tests/stub
# Session commands arm an idle-stop watcher by default; only the idle cases
# turn it on (run_maki passes ENV_IDLE_STOP, unset means 0).
export MAKI_OSS_IDLE_STOP=0

WORK=$(mktemp -d "${TMPDIR:-/tmp}/maki-oss-tests.XXXXXX")
cleanup() {
    pkill -f "$MAKI __idle-watch" 2>/dev/null || true
    if [ "${KEEP_WORK:-0}" != 1 ]; then
        rm -rf "$WORK"
    fi
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

PASS=0
FAIL=0
SKIP=0
CURRENT=
RC=0
LOG=
OUT=
ERR=

begin() { CURRENT=$1; }

run_test() {
    before_fail=$FAIL
    before_skip=$SKIP
    "$1"
    if [ "$FAIL" -ne "$before_fail" ]; then
        return 0
    fi
    if [ "$SKIP" -ne "$before_skip" ]; then
        return 0
    fi
    PASS=$((PASS + 1))
    printf 'ok   %s\n' "$CURRENT"
}

bad() {
    FAIL=$((FAIL + 1))
    printf 'FAIL %s\n' "$CURRENT"
    if [ -n "${1:-}" ]; then
        printf '     %s\n' "$1"
    fi
}

skipped() { SKIP=$((SKIP + 1)); printf 'skip %s (%s)\n' "$CURRENT" "$1"; }

new_case() {
    CASE=$WORK/$1
    mkdir -p "$CASE/home" "$CASE/project" "$CASE/state" "$CASE/sandbox"
    XDG_CONFIG_HOME=$CASE/home/.config
    HOME=$CASE/home
    SANDBOX_WORKDIR=$CASE/sandbox/project
    # The simulated sandbox always has git, even when the host PATH omits it.
    mkdir -p "$CASE/sandbox-tools"
    if sandbox_real_git=$(command -v git 2>/dev/null); then
        ln -sfn "$sandbox_real_git" "$CASE/sandbox-tools/git"
    fi
    STUB_LOG=$CASE/stub.log
    STUB_STATE_DIR=$CASE/state
    LOG=$STUB_LOG
    OUT=$CASE/out
    ERR=$CASE/err
    RUN_DIR=
    ENV_NAME=
    ENV_TIMEOUT=
    unset ENV_IDLE_STOP
    ENV_RUN_TAG=
    ENV_IMAGE=
    ENV_POLICY=
    ENV_PROVIDERS=
    ENV_MAKI_VERSION=
    ENV_EDITOR=
    EXEC_STDOUT=
    EXEC_EXIT=
    EXEC_CASES=
    GATEWAY_DOWN=
    PROVIDER_NAMES=
    PROFILE_NAMES=
    PROFILE_LINT_EXIT=
    CREDENTIAL_ENV=
    CREDENTIAL_LOG=
    DOWNLOAD_EXIT=
    DOWNLOAD_FIXTURE=
    SETTINGS_EXIT=
    RULE_EXIT=
    RULE_PENDING=
    POLICY_FULL=
    JSON_COMPACT=
    CREATE_RACE=
    INTERACTIVE=
    TEST_ENV_VALUE=
    PATH_OVERRIDE=
    FISH_PATH=
    ENV_TUI=
    TUI_LOG=
    OPENCODE_EXIT=
    STUB_MAKI_SCRIPT=
    STUB_EXEC_SCRIPT_FAIL=
    GIT_TRACE_LOG=
    RC=0
}

run_maki_with_input() { # STDIN_FILE ARGS...
    maki_input=$1
    shift
    RC=0
    (
        cd "${RUN_DIR:-$CASE/project}"
        PATH="${PATH_OVERRIDE:-$STUB_DIR:$PATH}" \
        HOME="$HOME" \
        XDG_CONFIG_HOME="$XDG_CONFIG_HOME" \
        STUB_LOG="$STUB_LOG" \
        STUB_STATE_DIR="$STUB_STATE_DIR" \
        STUB_EXEC_STDOUT="${EXEC_STDOUT:-stub-exec-output}" \
        STUB_EXEC_EXIT="${EXEC_EXIT:-0}" \
        STUB_EXEC_CASES="${EXEC_CASES:-}" \
        STUB_GATEWAY_DOWN="${GATEWAY_DOWN:-0}" \
        STUB_PROVIDER_NAMES="${PROVIDER_NAMES:-}" \
        STUB_PROFILE_NAMES="${PROFILE_NAMES:-}" \
        STUB_PROFILE_LINT_EXIT="${PROFILE_LINT_EXIT:-}" \
        STUB_CREDENTIAL_ENV="${CREDENTIAL_ENV:-}" \
        STUB_ENV_LOG="${CREDENTIAL_LOG:-}" \
        STUB_DOWNLOAD_EXIT="${DOWNLOAD_EXIT:-}" \
        STUB_DOWNLOAD_FIXTURE="${DOWNLOAD_FIXTURE:-}" \
        STUB_SETTINGS_EXIT="${SETTINGS_EXIT:-}" \
        STUB_RULE_EXIT="${RULE_EXIT:-}" \
        STUB_RULE_PENDING="${RULE_PENDING:-}" \
        STUB_POLICY_FULL="${POLICY_FULL:-}" \
        STUB_JSON_COMPACT="${JSON_COMPACT:-0}" \
        STUB_CREATE_RACE="${CREATE_RACE:-0}" \
        MAKI_OSS_SANDBOX_NAME="${ENV_NAME:-}" \
        MAKI_OSS_TUI="${ENV_TUI:-}" \
        MAKI_OSS_TIMEOUT="${ENV_TIMEOUT:-}" \
        MAKI_OSS_IDLE_STOP="${ENV_IDLE_STOP-0}" \
        MAKI_OSS_RUN_TAG="${ENV_RUN_TAG:-}" \
        MAKI_OSS_WORKDIR="$CASE/sandbox/project" \
        STUB_SANDBOX_ROOT="$CASE/sandbox" \
        STUB_MAKI_SCRIPT="${STUB_MAKI_SCRIPT:-}" \
        STUB_EXEC_SCRIPT_FAIL="${STUB_EXEC_SCRIPT_FAIL:-}" \
        STUB_SANDBOX_TOOLS="$CASE/sandbox-tools" \
        GIT_TRACE="${GIT_TRACE_LOG:-}" \
        STUB_TUI_LOG="${TUI_LOG:-}" \
        STUB_OPENCODE_EXIT="${OPENCODE_EXIT:-}" \
        MAKI_OSS_IMAGE="${ENV_IMAGE:-}" \
        MAKI_OSS_POLICY="${ENV_POLICY:-}" \
        MAKI_OSS_PROVIDERS="${ENV_PROVIDERS:-}" \
        MAKI_VERSION="${ENV_MAKI_VERSION:-}" \
        EDITOR="${ENV_EDITOR:-true}" \
        MAKI_OSS_INTERACTIVE="${INTERACTIVE:-}" \
        MAKI_OSS_TEST_ENV_VALUE="${TEST_ENV_VALUE:-}" \
        "$MAKI" "$@" >"$OUT" 2>"$ERR" <"$maki_input"
    ) || RC=$?
}

run_maki() {
    run_maki_with_input /dev/null "$@"
}

# Feeds scripted stdin and makes the helper treat it as interactive, so the
# wizard prompts run under `make test` without a pseudo-terminal. `\n` in the
# input expands to a newline.
run_maki_stdin() {
    maki_stdin_input=$1
    shift
    printf '%b\n' "$maki_stdin_input" >"$CASE/stdin.txt"
    INTERACTIVE=1
    run_maki_with_input "$CASE/stdin.txt" "$@"
}

run_fish() {
    RC=0
    FISH_OUT=$CASE/fish.out
    (
        unset MAKI_OSS_BIN
        PATH="${FISH_PATH:-$STUB_DIR:$PATH}" \
        HOME="$HOME" \
        XDG_CONFIG_HOME="$XDG_CONFIG_HOME" \
        fish -c "$1" >"$FISH_OUT" 2>&1
    ) || RC=$?
}

reset_log() { : >"$LOG"; }

reset_state() {
    rm -rf "$STUB_STATE_DIR"
    mkdir -p "$STUB_STATE_DIR"
}

seed_sandbox() {
    mkdir -p "$STUB_STATE_DIR/sandboxes" "$STUB_STATE_DIR/providers"
    printf '%s\n' "${2:-Ready}" >"$STUB_STATE_DIR/sandboxes/$1"
    : >"$STUB_STATE_DIR/providers/$1"
    # An existing sandbox has a workdir; mirror the project into it (never
    # .git, which OpenShell's upload excludes).
    mkdir -p "$SANDBOX_WORKDIR"
    if [ -n "${RUN_DIR:-}" ] && [ -d "$RUN_DIR" ]; then
        for seed_entry in "$RUN_DIR"/* "$RUN_DIR"/.[!.]* "$RUN_DIR"/..?*; do
            [ -e "$seed_entry" ] || continue
            case $(basename -- "$seed_entry") in
                .git) continue ;;
            esac
            cp -R "$seed_entry" "$SANDBOX_WORKDIR/"
        done
    fi
}

# Records a provider as configured (config file) and known to the gateway
# (stub provider list), matching what `provider setup` persists in real use.
seed_remembered_provider() { # NAME
    mkdir -p "$XDG_CONFIG_HOME/maki-oss" "$STUB_STATE_DIR"
    printf 'providers = "%s"\n' "$1" >"$XDG_CONFIG_HOME/maki-oss/config.toml"
    printf '%s\n' "$1" >>"$STUB_STATE_DIR/providers.list"
}

attach_stub_provider() { # SANDBOX NAME
    mkdir -p "$STUB_STATE_DIR/providers"
    printf '%s\n' "$2" >>"$STUB_STATE_DIR/providers/$1"
}

# Fixture credential stores. Values never touch the fixture files' output in
# tests; they exist so flows can prove the value reaches the child env only.
seed_maki_store() { # SLUG VALUE
    mkdir -p "$HOME/.local/state/maki/auth"
    printf '{"api_key": "%s"}\n' "$2" >"$HOME/.local/state/maki/auth/$1.json"
}

seed_maki_plugin_store() { # SLUG VALUE
    mkdir -p "$HOME/.local/state/maki/auth/plugins"
    printf '{"api_key": "%s"}\n' "$2" >"$HOME/.local/state/maki/auth/plugins/$1.json"
}

seed_maki_oauth() { # SLUG
    mkdir -p "$HOME/.local/state/maki/auth"
    printf '{"access": "fixture-access-%s", "refresh": "fixture-refresh-%s", "expires": 9999999999}\n' \
        "$1" "$1" >"$HOME/.local/state/maki/auth/$1.json"
}

seed_opencode_auth() { # JSON
    mkdir -p "$HOME/.local/share/opencode"
    printf '%s\n' "$1" >"$HOME/.local/share/opencode/auth.json"
}

write_fixture_profile() { # PATH ID ENV
    cat >"$1" <<EOF
id: $2
display_name: Fixture Provider
description: Test-only provider profile
category: inference
inference_capable: true
credentials:
  - name: api_key
    description: Fixture key
    env_vars: [$3]
    required: true
    auth_style: bearer
    header_name: authorization
discovery:
  credentials: [api_key]
endpoints:
  - host: api.fixture.test
    port: 443
    protocol: rest
    access: read-write
    enforcement: enforce
binaries:
  - /usr/local/bin/maki
EOF
}

# Builds a PATH prefix with the shell tools the helper needs but no jq, so the
# grep/awk fallbacks are exercised even where jq ships in /usr/bin.
no_jq_path() {
    no_jq_dir=$CASE/no-jq-bin
    mkdir -p "$no_jq_dir"
    for no_jq_tool in awk basename cat cut dirname grep head mkdir mktemp mv paste printenv rm sed tr; do
        no_jq_tool_path=$(command -v "$no_jq_tool" 2>/dev/null) || continue
        if [ ! -e "$no_jq_dir/$no_jq_tool" ]; then
            ln -s "$no_jq_tool_path" "$no_jq_dir/$no_jq_tool"
        fi
    done
    printf '%s' "$STUB_DIR:$no_jq_dir"
}

# Builds a PATH prefix with the shell tools and CLI stubs the helper needs but
# without bun or opencode, so the conditional TUI doctor checks can fail.
no_tui_path() {
    no_tui_dir=$CASE/no-tui-bin
    mkdir -p "$no_tui_dir"
    for no_tui_tool in awk basename cat cut dirname grep head mkdir mktemp mv paste printenv rm sed sleep tr; do
        no_tui_tool_path=$(command -v "$no_tui_tool" 2>/dev/null) || continue
        if [ ! -e "$no_tui_dir/$no_tui_tool" ]; then
            ln -s "$no_tui_tool_path" "$no_tui_dir/$no_tui_tool"
        fi
    done
    for no_tui_stub in openshell docker podman; do
        if [ ! -e "$no_tui_dir/$no_tui_stub" ]; then
            ln -s "$STUB_DIR/$no_tui_stub" "$no_tui_dir/$no_tui_stub"
        fi
    done
    printf '%s' "$no_tui_dir"
}

# Builds a PATH with the shell tools and CLI stubs the helper needs but no
# git, so the patch/patch-less fallbacks are exercised. `with_patch` adds the
# text apply tool.
no_git_path() { # [with_patch]
    no_git_dir=$CASE/no-git-bin
    mkdir -p "$no_git_dir"
    for no_git_tool in awk basename cat chmod cp cut date dirname grep head mkdir mktemp mv paste printenv rm sed sh sleep tr; do
        no_git_tool_path=$(command -v "$no_git_tool" 2>/dev/null) || continue
        if [ ! -e "$no_git_dir/$no_git_tool" ]; then
            ln -s "$no_git_tool_path" "$no_git_dir/$no_git_tool"
        fi
    done
    if [ "${1:-}" = with_patch ]; then
        no_git_patch=$(command -v patch 2>/dev/null) || no_git_patch=
        if [ -n "$no_git_patch" ]; then
            ln -sfn "$no_git_patch" "$no_git_dir/patch"
        fi
    fi
    printf '%s' "$STUB_DIR:$no_git_dir"
}

# The git-check-then-git-apply order in the plain-directory path.
assert_trace_check_before_apply() {
    if [ -z "${GIT_TRACE_LOG:-}" ] || [ ! -f "$GIT_TRACE_LOG" ]; then
        bad "git trace missing; cannot order apply --check and apply"
        return
    fi
    check_line=$(grep -n -F -- 'apply --check' "$GIT_TRACE_LOG" | head -n 1 | cut -d: -f1)
    apply_line=$(grep -n -E 'git apply [^-]' "$GIT_TRACE_LOG" | head -n 1 | cut -d: -f1)
    if [ -z "$check_line" ] || [ -z "$apply_line" ]; then
        bad "cannot order apply --check and apply in the git trace (one is missing)"
        return
    fi
    if [ "$check_line" -ge "$apply_line" ]; then
        bad "apply --check did not run before apply"
    fi
}

assert_rc() {
    if [ "$RC" -ne "$1" ]; then
        bad "expected exit $1, got $RC (stderr: $(head -n 1 "$ERR" 2>/dev/null))"
    fi
}

assert_out_has() {
    if ! grep -Fq -- "$1" "$OUT" 2>/dev/null; then
        bad "stdout missing: $1"
    fi
}

assert_err_has() {
    if ! grep -Fq -- "$1" "$ERR" 2>/dev/null; then
        bad "stderr missing: $1"
    fi
}

assert_out_missing() {
    if grep -Fq -- "$1" "$OUT" 2>/dev/null; then
        bad "stdout unexpectedly contains: $1"
    fi
}

assert_err_missing() {
    if grep -Fq -- "$1" "$ERR" 2>/dev/null; then
        bad "stderr unexpectedly contains: $1"
    fi
}

assert_log_line() {
    if ! grep -Fxq -- "$1" "$LOG" 2>/dev/null; then
        bad "argv log missing argument: $1"
    fi
}

assert_log_has() {
    if ! grep -Fq -- "$1" "$LOG" 2>/dev/null; then
        bad "argv log missing: $1"
    fi
}

assert_log_missing() {
    if [ -f "$LOG" ] && grep -Fq -- "$1" "$LOG"; then
        bad "argv log unexpectedly contains: $1"
    fi
}

assert_log_line_missing() {
    if [ -f "$LOG" ] && grep -Fxq -- "$1" "$LOG"; then
        bad "argv log unexpectedly contains argument: $1"
    fi
}

assert_log_before() { # FIRST SECOND
    if [ ! -f "$LOG" ]; then
        bad "argv log missing; cannot order '$1' and '$2'"
        return
    fi
    first_seen=$(grep -n -F -m1 -- "$1" "$LOG" | cut -d: -f1)
    second_seen=$(grep -n -F -m1 -- "$2" "$LOG" | cut -d: -f1)
    if [ -z "$first_seen" ] || [ -z "$second_seen" ]; then
        bad "cannot order '$1' and '$2' (one is missing)"
        return
    fi
    if [ "$first_seen" -ge "$second_seen" ]; then
        bad "'$1' was not logged before '$2'"
    fi
}

# Like assert_log_before but matches whole argument lines, for ordering the
# Maki command against the internal sandbox scripts.
assert_log_line_before() { # FIRST SECOND
    if [ ! -f "$LOG" ]; then
        bad "argv log missing; cannot order '$1' and '$2'"
        return
    fi
    first_seen=$(grep -n -Fx -m1 -- "$1" "$LOG" | cut -d: -f1)
    second_seen=$(grep -n -Fx -m1 -- "$2" "$LOG" | cut -d: -f1)
    if [ -z "$first_seen" ] || [ -z "$second_seen" ]; then
        bad "cannot order '$1' and '$2' (one is missing)"
        return
    fi
    if [ "$first_seen" -ge "$second_seen" ]; then
        bad "'$1' was not logged before '$2'"
    fi
}

session_dir() { # SANDBOX
    printf '%s/.local/state/maki-oss/sessions/%s' "$HOME" "$1"
}

baseline_value() { # SANDBOX KEY
    sed -n "s/^$2=//p" "$(session_dir "$1")/baseline" 2>/dev/null | head -n 1
}

assert_file_mode() { # FILE MODE
    if [ ! -e "$1" ]; then
        bad "missing file: $1"
        return
    fi
    current_mode=$(stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1" 2>/dev/null)
    if [ "$current_mode" != "$2" ]; then
        bad "expected mode $2 on $1, got ${current_mode:-unknown}"
    fi
}

assert_trace_before() { # FIRST SECOND
    if [ -z "${GIT_TRACE_LOG:-}" ] || [ ! -f "$GIT_TRACE_LOG" ]; then
        bad "git trace missing; cannot order '$1' and '$2'"
        return
    fi
    first_seen=$(grep -n -F -m1 -- "$1" "$GIT_TRACE_LOG" | cut -d: -f1)
    second_seen=$(grep -n -F -m1 -- "$2" "$GIT_TRACE_LOG" | cut -d: -f1)
    if [ -z "$first_seen" ] || [ -z "$second_seen" ]; then
        bad "cannot order '$1' and '$2' in the git trace (one is missing)"
        return
    fi
    if [ "$first_seen" -ge "$second_seen" ]; then
        bad "'$1' did not run before '$2'"
    fi
}

git_trace_has() { # TEXT
    if [ -z "${GIT_TRACE_LOG:-}" ] || ! grep -Fq -- "$1" "$GIT_TRACE_LOG" 2>/dev/null; then
        bad "git trace missing: $1"
    fi
}

git_trace_missing() { # TEXT
    if [ -n "${GIT_TRACE_LOG:-}" ] && grep -Fq -- "$1" "$GIT_TRACE_LOG" 2>/dev/null; then
        bad "git trace unexpectedly contains: $1"
    fi
}

seed_git_project() { # DIR
    mkdir -p "$1"
    (
        cd "$1" || exit 1
        git init -q
        git config user.name "Test User"
        git config user.email test@example.com
        printf 'base\n' >tracked.txt
        git add tracked.txt
        git commit -q -m initial
    )
}

assert_secret_absent() { # VALUE
    if [ -f "$LOG" ] && grep -Fq -- "$1" "$LOG"; then
        bad "argv log leaked the credential"
    fi
    if [ -f "$OUT" ] && grep -Fq -- "$1" "$OUT"; then
        bad "stdout leaked the credential"
    fi
    if [ -f "$ERR" ] && grep -Fq -- "$1" "$ERR"; then
        bad "stderr leaked the credential"
    fi
}

assert_credential_env() { # VALUE
    if ! grep -Fqx -- "$1" "$CREDENTIAL_LOG" 2>/dev/null; then
        bad "credential was not exported to the openshell child environment"
    fi
}

assert_fish_out_has() {
    if ! grep -Fq -- "$1" "$FISH_OUT" 2>/dev/null; then
        bad "fish output missing: $1"
    fi
}

# ---------------------------------------------------------------------------

test_help() {
    begin "help prints usage"
    new_case help
    run_maki help
    assert_rc 0
    assert_out_has "Usage:"
    assert_out_has "doctor"
    assert_out_has "provider add|attach|list"
    assert_out_has "--continue"
    assert_out_has "--resume"
    assert_out_has "--session-id"
    assert_out_has "survive stop/start"
    assert_out_has "mcp"
    assert_out_has "mcp status"
}

test_usage_errors() {
    begin "usage errors exit 1"
    new_case usage
    run_maki frobnicate
    assert_rc 1
    run_maki up --definitely-not-an-option
    assert_rc 1
    run_maki download
    assert_rc 1
    reset_log
    run_maki download
    assert_log_missing "download"
    run_maki maki --resume
    assert_rc 1
    assert_err_has "option --resume requires a value"
    reset_log
    run_maki maki -r
    assert_rc 1
    assert_err_has "option -r requires a value"
    reset_log
    run_maki maki --resume ""
    assert_rc 1
    assert_err_has "option --resume requires a non-empty value"
    run_maki run --session-id
    assert_rc 1
    assert_err_has "option --session-id requires a value"
    assert_log_missing "exec"
}

test_config_precedence() {
    begin "configuration precedence: flag > env > config > default"
    new_case precedence
    mkdir -p "$XDG_CONFIG_HOME/maki-oss"
    printf 'sandbox_name = "a"\n' >"$XDG_CONFIG_HOME/maki-oss/config.toml"

    run_maki up
    assert_rc 0
    assert_log_line "a"

    reset_state
    reset_log
    ENV_NAME=b
    run_maki up
    assert_rc 0
    assert_log_line "b"
    assert_log_line_missing "a"

    reset_state
    reset_log
    run_maki up --name c
    assert_rc 0
    assert_log_line "c"
    assert_log_line_missing "b"
}

test_config_unknown_key() {
    begin "unknown config key names file and key"
    new_case unknown-key
    mkdir -p "$XDG_CONFIG_HOME/maki-oss"
    printf 'opennshell_path = "/x"\n' >"$XDG_CONFIG_HOME/maki-oss/config.toml"
    run_maki status
    assert_rc 1
    assert_err_has "opennshell_path"
    assert_err_has "config.toml"
}

test_up_creates() {
    begin "first up creates maki-<project> with image, policy, providers"
    new_case create
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    run_maki up --provider maki-anthropic --cpu 2 --memory 4Gi
    assert_rc 0
    assert_log_has "create"
    assert_log_line "--name"
    assert_log_line "maki-myproject"
    assert_log_line "--from"
    assert_log_line "maki-agent:local"
    assert_log_line "--policy"
    assert_log_line "$ROOT/examples/policies/maki-minimal.yaml"
    assert_log_line "--detach"
    assert_log_line "--provider"
    assert_log_line "maki-anthropic"
    assert_log_line "--cpu"
    assert_log_line "--memory"
    if [ ! -e "$STUB_STATE_DIR/sandboxes/maki-myproject" ]; then
        bad "sandbox state was not created"
    fi
}

test_up_idempotent() {
    begin "up is idempotent: starts instead of recreating"
    new_case idempotent
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready

    run_maki up
    assert_rc 0
    assert_log_missing "create"
    assert_log_missing "sandbox start"

    printf 'Stopped\n' >"$STUB_STATE_DIR/sandboxes/maki-myproject"
    reset_log
    run_maki up
    assert_rc 0
    assert_log_has "start"
    assert_log_missing "create"
    count=0
    for entry in "$STUB_STATE_DIR/sandboxes"/*; do
        if [ -e "$entry" ]; then
            count=$((count + 1))
        fi
    done
    if [ "$count" -ne 1 ]; then
        bad "expected exactly 1 sandbox, found $count"
    fi
}

test_run_passthrough() {
    begin "run streams stdout and propagates exit codes"
    new_case run
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    EXEC_STDOUT='{"result":"stub-ok"}'

    run_maki run "fix the tests"
    assert_rc 0
    assert_out_has '{"result":"stub-ok"}'
    assert_log_has "exec"
    assert_log_line "--print"
    assert_log_line "--yolo"
    assert_log_line "--trust"
    assert_log_line "--output-format"
    assert_log_line "json"
    assert_log_line "fix the tests"

    EXEC_STDOUT='partial-output'
    EXEC_EXIT=1
    reset_log
    run_maki run "fail please"
    assert_rc 1
    assert_out_has "partial-output"
}

test_maki_attach() {
    begin "maki attaches interactively through exec --tty"
    new_case maki
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    run_maki maki
    assert_rc 0
    assert_log_has "exec"
    assert_log_line "--tty"
    assert_log_line "maki"
}

test_upload_no_mount() {
    begin "upload delegates and never mounts"
    new_case upload
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    run_maki upload .
    assert_rc 0
    assert_log_has "upload"
    assert_log_line "."
    assert_log_line "$SANDBOX_WORKDIR"
    assert_log_missing "driver-config-json"
    assert_log_missing "mounts"
    assert_log_missing "bind"
}

test_download() {
    begin "download delegates to the gateway with an explicit destination"
    new_case download
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    run_maki download /sandbox/project/out ./out
    assert_rc 0
    assert_log_has "download"
    assert_log_line "/sandbox/project/out"
    assert_log_line "./out"
}

test_env_refusal() {
    begin "--env refuses credential-like keys"
    new_case env-refusal
    run_maki init --env ANTHROPIC_API_KEY=test
    assert_rc 1
    assert_err_has "ANTHROPIC_API_KEY"
    assert_err_has "provider"
    assert_log_missing "create"
}

test_env_allow_override() {
    begin "--allow-env overrides the refusal for one key"
    new_case env-allow
    run_maki init --env MY_TOKEN=x --allow-env MY_TOKEN
    assert_rc 0
    assert_log_has "--env"
    assert_log_line "MY_TOKEN=x"
}

test_env_lookalike() {
    begin "segment matching avoids TOKENIZERS-style false positives"
    new_case env-lookalike
    run_maki init --env TOKENIZERS_PARALLELISM=false
    assert_rc 0
    assert_log_line "TOKENIZERS_PARALLELISM=false"
}

test_env_refusal_session_path() {
    begin "--env refuses credential-like keys on the session path"
    new_case env-refusal-run
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_remembered_provider maki-anthropic
    run_maki run --env ANTHROPIC_API_KEY=sk-secret "hi"
    assert_rc 1
    assert_err_has "ANTHROPIC_API_KEY"
    assert_err_has "provider"
    assert_log_missing "create"
}

test_env_from_refusal() {
    begin "--env-from refuses credential-like names and names the flag"
    new_case env-from-refusal
    run_maki init --env-from ANTHROPIC_API_KEY
    assert_rc 1
    assert_err_has "--env-from"
    assert_err_has "ANTHROPIC_API_KEY"
    assert_err_has "provider"
    assert_log_missing "create"
}

test_env_from_laundered_source() {
    begin "--env-from refuses a credential-shaped source behind a neutral name"
    new_case env-from-laundered
    run_maki init --env-from HARMLESS_NAME=ANTHROPIC_API_KEY
    assert_rc 1
    assert_err_has "--env-from"
    assert_err_has "ANTHROPIC_API_KEY"
    assert_log_missing "create"
}

test_env_from_benign() {
    begin "--env-from passes a benign variable through to sandbox create"
    new_case env-from-benign
    run_maki init --env-from EDITOR
    assert_rc 0
    assert_log_has "--env-from"
    assert_log_line "EDITOR"
}

test_env_from_allow_override() {
    begin "--allow-env overrides the --env-from refusal for one key"
    new_case env-from-allow
    run_maki init --env-from MY_TOKEN --allow-env MY_TOKEN
    assert_rc 0
    assert_log_has "--env-from"
    assert_log_line "MY_TOKEN"
}

test_session_reuse_announces_overwrite() {
    begin "reusing a sandbox announces patch-based sync instead of an overlay"
    new_case reuse-note
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub

    run_maki run "hi"
    assert_rc 0
    assert_err_has "collected as a patch"
    assert_err_has "baseline matches the host"
    assert_log_missing "upload"

    # A session that creates the sandbox uploads instead, so no reuse warning.
    reset_state
    reset_log
    seed_remembered_provider maki-stub
    run_maki run "hi"
    assert_rc 0
    assert_log_has "upload"
    assert_err_missing "Reusing"
}

test_rm_confirmation() {
    begin "rm requires --yes when stdin is not a TTY"
    new_case rm
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready

    run_maki rm
    if [ "$RC" -eq 0 ]; then
        bad "rm without --yes should fail on a non-TTY stdin"
    fi
    assert_log_missing "delete"

    reset_log
    run_maki rm --yes
    assert_rc 0
    assert_log_has "delete"
    assert_log_line "maki-myproject"
    if [ -e "$STUB_STATE_DIR/sandboxes/maki-myproject" ]; then
        bad "sandbox state should be deleted"
    fi
}

test_doctor_missing_cli() {
    begin "doctor reports a missing openshell CLI first"
    new_case doctor-nocli
    mkdir -p "$CASE/nobin"
    PATH_OVERRIDE="$CASE/nobin:/usr/bin:/bin"
    run_maki doctor
    assert_rc 2
    assert_out_has "openshell CLI: not found"
    assert_log_missing "sandbox"
}

test_doctor_gateway_down() {
    begin "doctor fails when the gateway is unreachable"
    new_case doctor-down
    GATEWAY_DOWN=1
    run_maki doctor
    assert_rc 3
    assert_out_has "gateway: unreachable"
}

test_doctor_all_pass() {
    begin "doctor passes with all prerequisites present"
    new_case doctor-ok
    PROVIDER_NAMES=maki-anthropic
    run_maki doctor --provider maki-anthropic
    assert_rc 0
    assert_out_has "openshell CLI:"
    assert_out_has "gateway: connected"
    assert_out_has "container engine: docker"
    assert_out_has "image: maki-agent:local present"
    assert_out_has "policy file:"
    assert_out_has "providers: maki-anthropic"
    assert_out_has "MCP readiness (informational):"
}

# Writes a host mcp.toml declaring one HTTP server (and, when given, a stdio
# server) so mcp status has something to compare against the sandbox config.
# The ${VAR} header values must stay literal: they are the placeholder-only
# references that mcp status verifies never hold a credential.
# shellcheck disable=SC2016
seed_host_mcp() { # [STDIO]
    mkdir -p "$HOME/.config/maki"
    {
        printf '[mcp.context7]\n'
        printf 'url = "https://mcp.context7.com/mcp"\n'
        printf 'headers = { CONTEXT7_API_KEY = "${CONTEXT7_API_KEY}" }\n'
        printf 'enabled = true\n'
        if [ "${1:-}" = stdio ]; then
            printf '\n[mcp.synthetic]\n'
            printf 'command = ["bunx", "-y", "synthetic-search-mcp"]\n'
            printf 'environment = { SYNTHETIC_API_KEY = "${SYNTHETIC_API_KEY}" }\n'
            printf 'enabled = true\n'
        fi
    } >"$HOME/.config/maki/mcp.toml"
}

# The sandbox-side config, returned by the stubbed `sandbox exec cat`. Its
# stdio entry mirrors the baked examples/maki-image/config/mcp.toml: the
# pre-warmed script run under bun (its own bin carries a node shebang).
# shellcheck disable=SC2016  # ${VAR} headers must stay literal placeholders
sandbox_mcp_fixture() { # [STDIO]
    printf '[mcp.context7]\n'
    printf 'url = "https://mcp.context7.com/mcp"\n'
    printf 'headers = { CONTEXT7_API_KEY = "${CONTEXT7_API_KEY}" }\n'
    printf 'enabled = true\n'
    if [ "${1:-}" = stdio ]; then
        printf '[mcp.synthetic]\n'
        printf 'command = ["bun", "/sandbox/.bun/install/global/node_modules/synthetic-search-mcp/bin/index.js"]\n'
        printf 'environment = { SYNTHETIC_API_KEY = "${MCP_SYNTHETIC_API_KEY}" }\n'
        printf 'enabled = true\n'
    fi
}

# Writes the sandbox config fixture and a STUB_EXEC_CASES file where `cat`
# returns it (exit 0) and `command -v` answers per the wanted runtime state:
# seed_exec_stdio RUNTIME_EXIT (0 = runtime present, 1 = missing).
seed_exec_stdio() { # RUNTIME_EXIT
    sandbox_mcp_fixture stdio >"$CASE/sandbox-mcp.toml"
    printf '/usr/local/bin/bun\n' >"$CASE/bun-path"
    printf 'command -v|%s|%s\n-- cat|0|%s\n' \
        "$1" "$CASE/bun-path" "$CASE/sandbox-mcp.toml" >"$CASE/exec-cases"
    EXEC_CASES=$CASE/exec-cases
}

test_mcp_status_all_gates_satisfied() {
    begin "mcp status reports every gate satisfied and exits 0"
    new_case mcp-status-ready
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_host_mcp
    attach_stub_provider maki-myproject mcp-context7
    EXEC_STDOUT=$(sandbox_mcp_fixture)
    POLICY_FULL='network_policies:
  _provider_mcp_context7:
    endpoints:
      - host: mcp.context7.com
        port: 443
        protocol: mcp'

    run_maki mcp status
    assert_rc 0
    assert_out_has "MCP readiness for sandbox 'maki-myproject':"
    assert_out_has "context7: sandbox=ok provider=ok endpoint=ok transport=http"
    assert_out_missing "fix:"
}

test_mcp_status_failing_gate_names_fix() {
    begin "mcp status names the failing gate and its fix, and exits non-zero"
    new_case mcp-status-fail
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_host_mcp
    EXEC_STDOUT=$(sandbox_mcp_fixture)
    POLICY_FULL='host: mcp.context7.com'

    run_maki mcp status
    assert_rc 3
    assert_out_has "context7: sandbox=ok provider=missing endpoint=ok transport=http"
    assert_out_has "fix: maki-oss provider attach mcp-context7"
    # Read-only: no gateway mutation was attempted.
    assert_log_missing "create"
    assert_log_missing "attach"
    assert_log_missing "import"
    assert_log_missing "update"
}

test_mcp_status_host_only_server() {
    begin "mcp status names a host-only server with the environment-image guidance"
    new_case mcp-status-hostonly
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_host_mcp
    # The sandbox config predates the host server: exec fails (no file).
    EXEC_EXIT=1

    run_maki mcp status
    assert_rc 3
    assert_out_has "context7: sandbox=missing"
    assert_out_has "fix: build and select an environment image that declares 'context7' (see docs/ai/environment-playbook.md)"
    assert_out_missing "fix: maki-oss image build"
}

test_mcp_status_zero_mcp_base() {
    begin "mcp status points a zero-MCP base at the environment image"
    new_case mcp-status-zero-base
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_host_mcp
    # The sandbox returns the real base config: comments only, zero servers.
    EXEC_STDOUT=$(cat "$ROOT/examples/maki-image/config/mcp.toml")

    run_maki mcp status
    assert_rc 3
    assert_out_has "context7: sandbox=missing"
    assert_out_has "fix: build and select an environment image that declares 'context7' (see docs/ai/environment-playbook.md)"
    assert_out_missing "fix: maki-oss image build"
    # Reporting stays read-only.
    assert_log_missing "create"
    assert_log_missing "attach"
    assert_log_missing "import"
    assert_log_missing "update"
    assert_log_missing "build"
}

test_mcp_status_stdio_all_gates_satisfied() {
    begin "mcp status judges a stdio server by its runtime gate and exits 0"
    new_case mcp-status-stdio
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_host_mcp stdio
    attach_stub_provider maki-myproject mcp-context7
    attach_stub_provider maki-myproject mcp-synthetic
    seed_exec_stdio 0
    POLICY_FULL='host: mcp.context7.com'

    run_maki mcp status
    assert_rc 0
    assert_out_has "synthetic: sandbox=ok runtime=ok provider=ok transport=stdio"
    assert_out_has "context7: sandbox=ok provider=ok endpoint=ok transport=http"
    assert_out_missing "fix:"
    # Reporting is read-only: no gateway or sandbox mutation, no install.
    assert_log_missing "create"
    assert_log_missing "attach"
    assert_log_missing "import"
    assert_log_missing "update"
    assert_log_missing "build"
    # No credential material (config environment entry) in the output.
    # shellcheck disable=SC2016  # the literal ${VAR} placeholder text is the assertion
    assert_secret_absent '${SYNTHETIC_API_KEY}'
    assert_secret_absent 'SYNTHETIC_API_KEY'
}

test_mcp_status_stdio_missing_runtime_names_build_fix() {
    begin "mcp status names a missing stdio runtime with the environment-image fix"
    new_case mcp-status-stdio-missing
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_host_mcp stdio
    attach_stub_provider maki-myproject mcp-context7
    attach_stub_provider maki-myproject mcp-synthetic
    seed_exec_stdio 1
    POLICY_FULL='host: mcp.context7.com'

    run_maki mcp status
    assert_rc 3
    assert_out_has "synthetic: sandbox=ok runtime=missing provider=ok transport=stdio"
    assert_out_has "fix: build and select an environment image that provides the runtime 'bun' for 'synthetic' (see docs/ai/environment-playbook.md)"
    assert_out_missing "fix: maki-oss provider attach"
    assert_out_missing "fix: maki-oss image build"
    # Read-only: the fix is printed, never performed; nothing is installed.
    assert_log_missing "create"
    assert_log_missing "attach"
    assert_log_missing "import"
    assert_log_missing "update"
    assert_log_missing "build"
    # shellcheck disable=SC2016  # the literal ${VAR} placeholder text is the assertion
    assert_secret_absent '${SYNTHETIC_API_KEY}'
    assert_secret_absent 'SYNTHETIC_API_KEY'
}

test_mcp_status_no_sandbox() {
    begin "mcp status reports no sandbox and exits 0"
    new_case mcp-status-nosandbox
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_host_mcp

    run_maki mcp status
    assert_rc 0
    assert_out_has "No sandbox 'maki-myproject'"
    assert_log_missing "exec"
}

test_mcp_status_none_configured() {
    begin "mcp status reports none configured on both sides and exits 0"
    new_case mcp-status-empty
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    EXEC_STDOUT='(no mcp config present)'

    run_maki mcp status
    assert_rc 0
    assert_out_has "no MCP servers configured"
    assert_log_missing "create"
    assert_log_missing "attach"
    assert_log_missing "import"
}

test_doctor_mcp_section_informational() {
    begin "doctor prints an MCP failure but still exits 0"
    new_case doctor-mcp
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_host_mcp
    EXEC_STDOUT=$(sandbox_mcp_fixture)
    POLICY_FULL='host: mcp.context7.com'

    run_maki doctor
    assert_rc 0
    assert_out_has "MCP readiness (informational):"
    assert_out_has "context7: sandbox=ok provider=missing endpoint=ok transport=http"
    assert_out_has "fix: maki-oss provider attach mcp-context7"
}

test_doctor_mcp_none_configured() {
    begin "doctor's MCP section reports none configured and keeps the exit code"
    new_case doctor-mcp-empty
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    EXEC_STDOUT='(no mcp config present)'

    run_maki doctor
    assert_rc 0
    assert_out_has "MCP readiness (informational):"
    assert_out_has "none configured"
}

test_image_build_argv() {
    begin "image build passes MAKI_VERSION and tags the image"
    new_case image-build
    ENV_MAKI_VERSION=9.9.9
    run_maki image build
    assert_rc 0
    assert_log_has "build"
    assert_log_line "--build-arg"
    assert_log_line "MAKI_VERSION=9.9.9"
    assert_log_line "-t"
    assert_log_line "maki-agent:local"
    assert_log_has "examples/maki-image"
}

test_asset_environment_split() {
    begin "assets: base has no MCP environment; reference store carries it"
    new_case assets-environment-split
    if grep -Eq 'BUN_VERSION|bun add|synthetic-search-mcp' \
        "$ROOT/examples/maki-image/Dockerfile"; then
        bad "base Dockerfile still installs Bun or synthetic-search-mcp"
    fi
    if grep -Eq '^\[mcp\.' "$ROOT/examples/maki-image/config/mcp.toml"; then
        bad "base mcp.toml declares an MCP server"
    fi
    if grep -q 'always_yolo' "$ROOT/examples/maki-image/config/init.lua"; then
        bad "base init.lua still sets a personal preference"
    fi
    grep -q 'BUN_VERSION' "$ROOT/examples/environments/reference/Dockerfile" \
        || bad "reference Dockerfile does not pin Bun"
    grep -q 'synthetic-search-mcp' "$ROOT/examples/environments/reference/Dockerfile" \
        || bad "reference Dockerfile does not install synthetic-search-mcp"
    grep -q '^\[mcp.context7\]' "$ROOT/examples/environments/reference/config/mcp.toml" \
        || bad "reference mcp.toml does not declare context7"
    grep -q '^\[mcp.synthetic\]' "$ROOT/examples/environments/reference/config/mcp.toml" \
        || bad "reference mcp.toml does not declare synthetic"
    grep -q 'always_yolo = true' "$ROOT/examples/environments/reference/config/init.lua" \
        || bad "reference init.lua does not carry the relocated preference"
    grep -q 'maki models --refresh' "$ROOT/examples/maki-image/Dockerfile" \
        || bad "base Dockerfile does not seed Maki's models.dev catalog"
}

test_status_list_logs() {
    begin "status, list, and logs report and delegate"
    new_case status
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    printf 'maki-anthropic\n' >>"$STUB_STATE_DIR/providers/maki-myproject"

    run_maki status
    assert_rc 0
    assert_out_has "Sandbox:   maki-myproject"
    assert_out_has "Exists:    yes"
    assert_out_has "Phase:     Ready"
    assert_out_has "Image:     maki-agent:local (configured)"
    assert_out_has "Providers: maki-anthropic"

    run_maki list
    assert_rc 0
    assert_log_has "list"

    run_maki logs --tail --since 5m --level info -n 50
    assert_rc 0
    assert_log_has "logs"
    assert_log_line "--tail"
    assert_log_line "--since"
    assert_log_line "5m"
    assert_log_line "--level"
    assert_log_line "info"
    assert_log_line "-n"
    assert_log_line "50"
}

test_start_stop() {
    begin "start and stop delegate to the gateway"
    new_case lifecycle
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready

    run_maki stop
    assert_rc 0
    assert_log_has "stop"
    assert_log_line "maki-myproject"

    reset_log
    run_maki start
    assert_rc 0
    assert_log_has "start"
    assert_log_line "maki-myproject"
}

test_policy_wrappers() {
    begin "policy show, edit, and apply wrap the openshell commands"
    new_case policy
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready

    run_maki policy show
    assert_rc 0
    assert_log_has "policy"
    assert_log_has "get"
    assert_log_line "--base"
    assert_log_line "maki-myproject"

    reset_log
    run_maki policy apply
    assert_rc 0
    assert_log_has "set"
    assert_log_line "--policy"
    assert_log_line "$ROOT/examples/policies/maki-minimal.yaml"
    assert_log_line "maki-myproject"

    reset_log
    ENV_EDITOR=true
    run_maki policy edit
    assert_rc 0
}

test_provider_wrappers() {
    begin "provider add, attach, and list wrap the openshell commands"
    new_case provider
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready

    run_maki provider add my-anthropic --type maki-anthropic --from-existing
    assert_rc 0
    assert_log_has "create"
    assert_log_line "--name"
    assert_log_line "my-anthropic"
    assert_log_line "--type"
    assert_log_line "maki-anthropic"
    assert_log_line "--from-existing"

    reset_log
    run_maki provider attach maki-anthropic
    assert_rc 0
    assert_log_has "attach"
    assert_log_line "maki-myproject"
    assert_log_line "maki-anthropic"

    reset_log
    run_maki provider list
    assert_rc 0
    assert_log_has "provider"
    assert_log_has "list"
}

test_provider_inline_secret_rejected() {
    begin "provider add rejects inline credential values"
    new_case provider-secret
    run_maki provider add my-anthropic --type maki-anthropic --credential ANTHROPIC_API_KEY=super-secret
    assert_rc 1
    assert_err_has "inline KEY=VALUE"
    assert_log_missing "super-secret"
}

test_provider_setup_curated() {
    begin "provider setup resolves a stored key through the catalog"
    new_case setup-curated
    seed_maki_store opencode-go "fixture-opencode-go-key"
    CREDENTIAL_ENV=OPENCODE_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_maki provider setup --from maki --credential opencode-go --yes
    assert_rc 0
    assert_log_has "profile"
    assert_log_has "lint"
    assert_log_line "$ROOT/examples/providers/maki-opencode-go.yaml"
    assert_log_has "import"
    assert_log_line "--global"
    assert_log_before "lint" "import"
    assert_log_has "create"
    assert_log_line "maki-opencode-go"
    assert_log_line "--type"
    assert_log_line "--from-existing"
    assert_log_line "--global-profile"
    assert_log_line_missing "update"
    assert_credential_env "fixture-opencode-go-key"
    assert_secret_absent "fixture-opencode-go-key"
    assert_out_has "Provider 'maki-opencode-go' created."
}

test_provider_memory() {
    begin "provider setup remembers names and model without rewriting comments"
    new_case provider-memory
    mkdir -p "$XDG_CONFIG_HOME/maki-oss"
    printf '# keep this comment\nimage = "custom:tag"\n\nproviders = "already-there"\n' \
        >"$XDG_CONFIG_HOME/maki-oss/config.toml"
    seed_maki_store opencode-go "fixture-memory-key"
    CREDENTIAL_ENV=OPENCODE_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_maki_stdin "opencode-go/deepseek-v4.1-flash" provider setup \
        --from maki --credential opencode-go --yes
    assert_rc 0
    config=$XDG_CONFIG_HOME/maki-oss/config.toml
    grep -Fq '# keep this comment' "$config" || bad "comment was not preserved"
    grep -Fq 'image = "custom:tag"' "$config" || bad "unrelated key was not preserved"
    grep -Fxq 'providers = "already-there,maki-opencode-go"' "$config" \
        || bad "provider name was not remembered exactly once"
    grep -Fxq 'model = "opencode-go/deepseek-v4.1-flash"' "$config" \
        || bad "model was not remembered"
    if grep -Fq "fixture-memory-key" "$config"; then
        bad "credential value leaked into the config"
    fi

    # Re-running keeps the list deduplicated.
    reset_log
    INTERACTIVE=
    run_maki provider setup --from maki --credential opencode-go --yes
    assert_rc 0
    grep -Fxq 'providers = "already-there,maki-opencode-go"' "$config" \
        || bad "re-running duplicated the provider name"
    assert_secret_absent "fixture-memory-key"
}

test_provider_setup_catalog_alias() {
    begin "provider setup honors store-specific catalog aliases"
    new_case setup-alias
    seed_opencode_auth '{
  "zai-coding-plan": {"type": "api", "key": "fixture-zai-coding-key"}
}'
    CREDENTIAL_ENV=ZHIPU_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_maki provider setup --from opencode --credential zai-coding-plan --yes
    assert_rc 0
    assert_log_line "$ROOT/examples/providers/maki-zai-coding.yaml"
    assert_log_line "maki-zai-coding"
    assert_credential_env "fixture-zai-coding-key"
    assert_secret_absent "fixture-zai-coding-key"
    assert_out_has "[zai]"
    assert_out_has 'plan = "coding"'
}

test_provider_setup_scanner_and_picker() {
    begin "store scanner lists store, slug, and auth type without values"
    new_case setup-scan
    seed_maki_store opencode-go "fixture-maki-key"
    seed_maki_plugin_store synthetic "fixture-plugin-key"
    seed_opencode_auth '{
  "deepseek": {"type": "api", "key": "fixture-deepseek-key"},
  "openai": {"type": "oauth", "access": "fixture-oauth-access", "refresh": "fixture-oauth-refresh"}
}'
    CREDENTIAL_ENV=OPENCODE_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_maki_stdin "1\n" provider setup --yes
    assert_rc 0
    assert_out_has "maki:opencode-go (api-key)"
    assert_out_has "maki:synthetic (api-key)"
    assert_out_has "opencode:deepseek (api-key)"
    assert_out_has "opencode:openai (oauth)"
    assert_log_line "maki-opencode-go"
    assert_credential_env "fixture-maki-key"
    assert_secret_absent "fixture-maki-key"
    assert_secret_absent "fixture-plugin-key"
    assert_secret_absent "fixture-deepseek-key"
    assert_secret_absent "fixture-oauth-access"
    assert_secret_absent "fixture-oauth-refresh"
}

test_provider_setup_oauth_refused() {
    begin "OAuth store credentials are refused without gateway changes"
    new_case setup-oauth
    seed_maki_oauth openai
    run_maki provider setup --from maki --credential openai --yes
    if [ "$RC" -eq 0 ]; then
        bad "OAuth credential should not be usable"
    fi
    assert_err_has "does not support"
    assert_log_missing "profile"
    assert_log_missing "create"
    assert_log_missing "update"
}

test_provider_setup_oauth_interactive() {
    begin "selecting an OAuth-listed credential exits non-zero"
    new_case setup-oauth-pick
    seed_opencode_auth '{
  "openai": {"type": "oauth", "access": "fixture-pick-access", "refresh": "fixture-pick-refresh"}
}'
    run_maki_stdin "1" provider setup --yes
    if [ "$RC" -eq 0 ]; then
        bad "selecting an OAuth entry should exit non-zero"
    fi
    assert_err_has "does not support"
    assert_log_missing "create"
    assert_log_missing "update"
    assert_secret_absent "fixture-pick-access"
}

test_provider_setup_non_tty_refusal() {
    begin "non-TTY setup without flags makes no gateway calls"
    new_case setup-notty
    run_maki provider setup
    assert_rc 1
    assert_err_has "stdin is not a terminal"
    if [ -s "$LOG" ]; then
        bad "gateway was contacted: $(cat "$LOG")"
    fi

    # An existing provider without --yes also refuses before profile import.
    seed_maki_store opencode-go "fixture-notty-key"
    PROVIDER_NAMES=maki-opencode-go
    reset_log
    run_maki provider setup --from maki --credential opencode-go
    assert_rc 1
    assert_err_has "already exists"
    assert_log_missing "lint"
    assert_log_missing "import"
    assert_log_missing "create"
    assert_log_missing "update"
}

test_provider_setup_update() {
    begin "existing provider is updated, not duplicated"
    new_case setup-update
    seed_maki_store opencode-go "fixture-update-key"
    PROVIDER_NAMES=maki-opencode-go
    PROFILE_NAMES=maki-opencode-go
    CREDENTIAL_ENV=OPENCODE_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_maki provider setup --from maki --credential opencode-go --yes
    assert_rc 0
    assert_log_has "update"
    assert_log_line "maki-opencode-go"
    assert_log_line "--from-existing"
    assert_log_line_missing "create"
    assert_log_missing "import"
    assert_out_has "already imported"
    assert_out_has "updated"
    assert_credential_env "fixture-update-key"
    assert_secret_absent "fixture-update-key"
}

test_provider_setup_attach() {
    begin "provider setup attaches to the project sandbox with --wait"
    new_case setup-attach
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_maki_store opencode-go "fixture-attach-key"
    CREDENTIAL_ENV=OPENCODE_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_maki provider setup --from maki --credential opencode-go --yes --attach
    assert_rc 0
    assert_log_has "attach"
    assert_log_line "maki-myproject"
    assert_log_line "--wait"
    assert_out_has "attached"
    assert_secret_absent "fixture-attach-key"
}

test_provider_setup_file_source() {
    begin "generic JSON file source reads the given field"
    new_case setup-file
    write_fixture_profile "$CASE/fixture-profile.yaml" fixture-provider FIXTURE_KEY
    printf '{"custom_key": "fixture-file-value"}\n' >"$CASE/creds.json"
    CREDENTIAL_ENV=FIXTURE_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_maki provider setup --file "$CASE/creds.json" --field custom_key \
        --profile "$CASE/fixture-profile.yaml" --yes
    assert_rc 0
    assert_log_line "$CASE/fixture-profile.yaml"
    assert_log_line "fixture-provider"
    assert_log_line "--type"
    assert_credential_env "fixture-file-value"
    assert_secret_absent "fixture-file-value"
}

test_provider_setup_env_source() {
    begin "environment variable source is used without stdin"
    new_case setup-env
    write_fixture_profile "$CASE/fixture-profile.yaml" fixture-provider FIXTURE_KEY
    CREDENTIAL_ENV=FIXTURE_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log
    TEST_ENV_VALUE=fixture-env-value

    run_maki provider setup --env MAKI_OSS_TEST_ENV_VALUE \
        --profile "$CASE/fixture-profile.yaml" --yes
    assert_rc 0
    assert_credential_env "fixture-env-value"
    assert_secret_absent "fixture-env-value"
}

test_provider_setup_hidden_prompt() {
    begin "hidden prompt source reads a value without echoing it"
    new_case setup-prompt
    write_fixture_profile "$CASE/fixture-profile.yaml" fixture-provider FIXTURE_KEY
    CREDENTIAL_ENV=FIXTURE_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_maki_stdin "g\n3\nfixture-prompt-value\n" provider setup \
        --profile "$CASE/fixture-profile.yaml" --yes
    assert_rc 0
    assert_out_has "No stored credentials detected."
    assert_credential_env "fixture-prompt-value"
    assert_secret_absent "fixture-prompt-value"
}

test_provider_setup_custom_generation() {
    begin "unknown store slug generates, lints, and imports a custom profile"
    new_case setup-custom
    seed_maki_store acme-router "fixture-nano-key"
    CREDENTIAL_ENV=ACME_ROUTER_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_maki_stdin "1\n\n\napi.acme-router.test\n/v1\n" provider setup --yes
    assert_rc 0
    generated=$XDG_CONFIG_HOME/maki-oss/profiles/maki-acme-router.yaml
    if [ ! -f "$generated" ]; then
        bad "generated profile not found: $generated"
    else
        grep -Fq "id: maki-acme-router" "$generated" || bad "generated profile id missing"
        grep -Fq "env_vars: [ACME_ROUTER_API_KEY]" "$generated" || bad "generated profile env var missing"
        grep -Fq "host: api.acme-router.test" "$generated" || bad "generated profile host missing"
        grep -Fq "path: /v1" "$generated" || bad "generated profile path missing"
        if grep -Fq "fixture-nano-key" "$generated"; then
            bad "generated profile contains the credential value"
        fi
    fi
    assert_log_line "$generated"
    assert_log_before "lint" "import"
    assert_log_line "maki-acme-router"
    assert_credential_env "fixture-nano-key"
    assert_secret_absent "fixture-nano-key"
}

test_provider_setup_custom_preserved() {
    begin "declining overwrite preserves the generated profile"
    new_case setup-custom-keep
    mkdir -p "$XDG_CONFIG_HOME/maki-oss/profiles"
    keep=$XDG_CONFIG_HOME/maki-oss/profiles/maki-acme-router.yaml
    write_fixture_profile "$keep" maki-acme-router ACME_ROUTER_API_KEY
    seed_maki_store acme-router "fixture-keep-key"
    CREDENTIAL_ENV=ACME_ROUTER_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_maki_stdin "1\n\n\nnew.example.com\n\nn\n" provider setup
    assert_rc 0
    assert_out_has "Keeping existing profile"
    if ! grep -Fq "host: api.fixture.test" "$keep"; then
        bad "existing generated profile was overwritten"
    fi
    if grep -Fq "new.example.com" "$keep"; then
        bad "declined custom details leaked into the existing profile"
    fi
    assert_log_line "$keep"
    assert_credential_env "fixture-keep-key"
    assert_secret_absent "fixture-keep-key"
}

test_provider_setup_lint_failure() {
    begin "profile lint failure aborts before import"
    new_case setup-lint-fail
    seed_maki_store opencode-go "fixture-lint-key"
    PROFILE_LINT_EXIT=1

    run_maki provider setup --from maki --credential opencode-go --yes
    assert_rc 3
    assert_log_has "lint"
    assert_log_missing "import"
    assert_log_missing "create"
    assert_log_missing "update"
    assert_secret_absent "fixture-lint-key"
}

test_provider_setup_credential_non_exposure() {
    begin "credential values never reach argv, output, or generated files"
    new_case setup-no-leak
    value='fixture-do-not-leak-9f3a'
    seed_maki_store acme-router "$value"
    CREDENTIAL_ENV=ACME_ROUTER_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_maki_stdin "1\n\n\napi.acme-router.test\n/v1\n" provider setup --yes
    assert_rc 0
    assert_credential_env "$value"
    assert_secret_absent "$value"
    generated=$XDG_CONFIG_HOME/maki-oss/profiles/maki-acme-router.yaml
    if [ -f "$generated" ] && grep -Fq -- "$value" "$generated"; then
        bad "generated profile contains the credential value"
    fi
}

test_provider_setup_usage_errors() {
    begin "provider setup rejects bad flags before touching the gateway"
    new_case setup-usage
    run_maki provider setup --from bogus --credential x --yes
    assert_rc 1
    assert_err_has "maki or opencode"
    run_maki provider setup --file "$CASE/missing.json" --yes
    assert_rc 1
    if [ -s "$LOG" ]; then
        bad "gateway was contacted for invalid input: $(cat "$LOG")"
    fi
}

test_provider_setup_custom_validation() {
    begin "custom setup rejects invalid ids and hosts"
    new_case setup-custom-invalid
    seed_maki_store acme-router "fixture-invalid-key"
    CREDENTIAL_ENV=GOOD_PROVIDER_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_maki_stdin "1\nBad ID\ngood-provider\n\nbad host\napi.good.test\n\n" provider setup --yes
    assert_rc 0
    generated=$XDG_CONFIG_HOME/maki-oss/profiles/good-provider.yaml
    if [ ! -f "$generated" ]; then
        bad "valid custom profile was not generated after invalid input"
    else
        grep -Fq "id: good-provider" "$generated" || bad "custom id not applied"
        grep -Fq "env_vars: [GOOD_PROVIDER_API_KEY]" "$generated" || bad "custom env var not applied"
        grep -Fq "host: api.good.test" "$generated" || bad "custom host not applied"
    fi
    assert_credential_env "fixture-invalid-key"
    assert_secret_absent "fixture-invalid-key"
}

test_provider_setup_no_jq() {
    begin "provider setup reads single-level stores without jq"
    new_case setup-no-jq
    seed_maki_store opencode-go "fixture-no-jq-key"
    PATH_OVERRIDE=$(no_jq_path)
    CREDENTIAL_ENV=OPENCODE_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_maki provider setup --from maki --credential opencode-go --yes
    assert_rc 0
    assert_err_has "jq not found"
    assert_credential_env "fixture-no-jq-key"
    assert_secret_absent "fixture-no-jq-key"
}
test_run_model_flag() {
    begin "run --model passes the model to Maki"
    new_case run-model
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub

    run_maki run --model opencode-go/deepseek-v4.1-flash "check"
    assert_rc 0
    assert_log_has "exec"
    assert_log_line "--model"
    assert_log_line "opencode-go/deepseek-v4.1-flash"
    assert_log_line "check"
}

test_run_timeout_flag() {
    begin "run --timeout wraps Maki in an in-sandbox timeout"
    new_case run-timeout
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub

    run_maki run --timeout 600 "check"
    assert_rc 0
    assert_log_line "maki-oss-run"
    assert_log_has "timeout --kill-after=10"
    assert_log_has "MAKI_OSS_RUN_TAG"
    assert_log_line "600"
    assert_log_before "maki-oss-run" "--print"
    assert_log_missing "--env"

    # The environment variable sets the same limit.
    reset_log
    ENV_TIMEOUT=30
    run_maki run "check"
    ENV_TIMEOUT=
    assert_rc 0
    assert_log_line "maki-oss-run"
    assert_log_line "30"

    # Without the flag the in-sandbox argv starts with maki unchanged.
    reset_log
    run_maki run "check"
    assert_rc 0
    assert_log_line_missing "maki-oss-run"
    assert_log_missing "MAKI_OSS_RUN_TAG"

    # A caller-chosen tag names the run's processes in the sandbox.
    reset_log
    ENV_RUN_TAG=oskhs-t1
    run_maki run --timeout 30 "check"
    assert_rc 0
    assert_log_line "oskhs-t1"
    ENV_RUN_TAG='bad tag'
    reset_log
    run_maki run --timeout 30 "check"
    assert_rc 1
    assert_log_missing "exec"
    ENV_RUN_TAG=

    # An invalid value is a usage error before any gateway call.
    reset_log
    run_maki run --timeout soon "check"
    assert_rc 1
    assert_err_has "--timeout must be a positive number"
    assert_log_missing "exec"
    reset_log
    run_maki run --timeout 0 "check"
    assert_rc 1
    reset_log
    run_maki run "check" --timeout
    assert_rc 1
}

test_maki_resume() {
    begin "maki --continue forwards the resume flag and collects a patch"
    new_case maki-resume
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub

    run_maki maki --continue
    assert_rc 0
    assert_log_line "--tty"
    assert_log_line "--continue"
    assert_log_line_before "maki" 'git diff --binary --full-index refs/maki-oss/base refs/maki-oss/result'
    assert_log_line "$SANDBOX_WORKDIR"
    assert_log_missing "download"

    # -c and -r are aliases for --continue and --resume.
    reset_log
    run_maki maki -c
    assert_rc 0
    assert_log_line "--continue"

    reset_log
    run_maki run -r CgADMGeR7WnHDw7NJRUfN "keep going"
    assert_rc 0
    assert_log_line "--resume"
    assert_log_line "CgADMGeR7WnHDw7NJRUfN"
    assert_log_before "--resume" "keep going"
}

test_run_resume_flags() {
    begin "run forwards session flags and keeps the prompt separate"
    new_case run-resume
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub

    run_maki run --continue "fix the tests"
    assert_rc 0
    assert_log_line "--continue"
    assert_log_line "fix the tests"
    assert_log_before "--continue" "fix the tests"

    reset_log
    run_maki run --resume CgADMGeR7WnHDw7NJRUfN "keep going"
    assert_rc 0
    assert_log_line "--resume"
    assert_log_line "CgADMGeR7WnHDw7NJRUfN"
    assert_log_line "keep going"
    assert_log_before "--resume" "keep going"

    reset_log
    run_maki run --session-id ci-run-42 "start the migration"
    assert_rc 0
    assert_log_line "--session-id"
    assert_log_line "ci-run-42"
    assert_log_line "start the migration"
    assert_log_before "--session-id" "start the migration"

    # Sync-back is unchanged by resume flags: a patch is collected, never a
    # workdir download.
    assert_log_line_before "maki" 'git diff --binary --full-index refs/maki-oss/base refs/maki-oss/result'
    assert_log_line "$SANDBOX_WORKDIR"
    assert_log_missing "download"
}

test_session_flag_conflicts() {
    begin "--continue with --resume is refused, and session flags are inert elsewhere"
    new_case session-flag-conflicts
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready

    run_maki maki --continue --resume CgADMGeR7WnHDw7NJRUfN
    assert_rc 1
    assert_err_has "--continue cannot be combined with --resume"
    assert_log_missing "exec"
    assert_log_missing "create"

    reset_log
    run_maki maki -c -r CgADMGeR7WnHDw7NJRUfN
    assert_rc 1
    assert_err_has "--continue cannot be combined with --resume"
    assert_log_missing "exec"

    reset_log
    run_maki status --continue
    assert_rc 0
    assert_out_has "Sandbox:   maki-myproject"
    assert_log_missing "exec"
}

test_tui_config_key() {
    begin "tui config key: unset keeps the Maki TUI, opencode bridges, env overrides the file, other values fail"
    new_case tui-key
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR" "$XDG_CONFIG_HOME/maki-oss"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub

    # unset: byte-for-byte the Maki TTY session, no bridge started
    run_maki maki
    assert_rc 0
    assert_log_has "exec"
    assert_log_line "--tty"
    assert_log_missing "stub-bun"
    assert_log_missing "stub-opencode"

    # tui = "opencode": the bridge and the TUI attach instead
    printf 'tui = "opencode"\n' >>"$XDG_CONFIG_HOME/maki-oss/config.toml"
    reset_log
    run_maki maki
    assert_rc 0
    assert_log_has "stub-bun start"
    assert_log_has "stub-opencode"
    assert_log_missing "--tty"

    # MAKI_OSS_TUI overrides the file: opencode in the environment bridges
    # even with the key unset
    printf 'providers = "maki-stub"\n' >"$XDG_CONFIG_HOME/maki-oss/config.toml"
    reset_log
    ENV_TUI=opencode
    run_maki maki
    assert_rc 0
    assert_log_has "stub-bun start"
    assert_log_has "stub-opencode"
    ENV_TUI=

    # any other value is a usage error naming the key and the values
    printf 'tui = "vim"\n' >>"$XDG_CONFIG_HOME/maki-oss/config.toml"
    reset_log
    run_maki maki
    assert_rc 1
    assert_err_has "tui"
    assert_err_has "opencode"
    assert_log_missing "exec"
    assert_log_missing "stub-bun"
}

test_tui_resume_flags_refused() {
    begin "OpenCode TUI mode refuses session flags while run keeps them"
    new_case tui-flags
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR" "$XDG_CONFIG_HOME/maki-oss"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    printf 'providers = "maki-stub"\ntui = "opencode"\n' >"$XDG_CONFIG_HOME/maki-oss/config.toml"

    run_maki --continue
    assert_rc 1
    assert_err_has "OpenCode TUI mode"
    assert_log_missing "exec"
    assert_log_missing "stub-bun"

    reset_log
    run_maki maki --resume CgADMGeR7WnHDw7NJRUfN
    assert_rc 1
    assert_err_has "OpenCode TUI mode"
    assert_log_missing "exec"
    assert_log_missing "stub-bun"

    reset_log
    run_maki maki --session-id ci-run-42
    assert_rc 1
    assert_err_has "OpenCode TUI mode"
    assert_log_missing "exec"

    # run is unaffected by tui and keeps the headless resume path
    reset_log
    run_maki run --continue "keep going"
    assert_rc 0
    assert_log_has "exec"
    assert_log_line "--continue"
    assert_log_missing "stub-bun"

    # without the tui setting the session flags keep working
    printf 'providers = "maki-stub"\n' >"$XDG_CONFIG_HOME/maki-oss/config.toml"
    reset_log
    run_maki maki --continue
    assert_rc 0
    assert_log_has "exec"
    assert_log_line "--tty"
    assert_log_line "--continue"
    assert_log_missing "stub-bun"
}

test_opencode_tui_session() {
    begin "OpenCode mode: ensure, bridge start, TUI attach, bridge kill, sync"
    new_case tui-session
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR" "$XDG_CONFIG_HOME/maki-oss"
    seed_remembered_provider maki-stub
    printf 'providers = "maki-stub"\ntui = "opencode"\n' >"$XDG_CONFIG_HOME/maki-oss/config.toml"
    TUI_LOG=$LOG

    run_maki
    assert_rc 0
    assert_log_has "create"
    assert_log_has "upload"
    assert_log_has "stub-bun start"
    assert_log_has "stub-opencode"
    assert_log_has "stub-bun SIGTERM"
    assert_log_line_before "stub-bun SIGTERM" 'git diff --binary --full-index refs/maki-oss/base refs/maki-oss/result'
    assert_log_before "create" "stub-bun start"
    assert_log_before "stub-bun start" "stub-opencode"
    assert_log_before "stub-opencode" "stub-bun SIGTERM"
    assert_log_missing "download"
    # the bridge runs maki in the same project sandbox, with no --env value
    assert_log_has "stub-bun env: OPENMAKI_SANDBOX=maki-myproject"
    assert_log_has "OPENMAKI_CWD=$SANDBOX_WORKDIR"
    assert_log_missing "--env"
    # the TUI is attached on the TTY against the bridge's loopback URL
    assert_log_has "stub-opencode argv: --server"
    assert_log_has "stub-opencode argv: http://127.0.0.1:4698"
    assert_log_missing "--tty"
    assert_err_has "Starting the OpenCode TUI bridge"
    assert_err_has "Attaching the OpenCode TUI"

    # --no-sync keeps the flow but skips patch collection
    reset_log
    run_maki --no-sync
    assert_rc 0
    assert_log_has "stub-bun SIGTERM"
    assert_log_missing "download"
    assert_log_missing "maki-oss/result"
    assert_err_has "Skipped download (--no-sync)"
}

test_doctor_tui_checks() {
    begin "doctor checks bun, opencode, and the bridge only when tui is opencode"
    new_case doctor-tui
    PROVIDER_NAMES=maki-anthropic

    # unset: no TUI lines at all
    run_maki doctor --provider maki-anthropic
    assert_rc 0
    assert_out_missing "bun:"
    assert_out_missing "opencode:"
    assert_out_missing "bridge entrypoint:"

    # opencode with everything present: three ok lines, exit 0
    mkdir -p "$XDG_CONFIG_HOME/maki-oss"
    printf 'tui = "opencode"\n' >"$XDG_CONFIG_HOME/maki-oss/config.toml"
    run_maki doctor --provider maki-anthropic
    assert_rc 0
    assert_out_has "ok    bun:"
    assert_out_has "ok    opencode:"
    assert_out_has "ok    bridge entrypoint:"

    # opencode without bun or opencode on PATH: named failures, exit 2
    PATH_OVERRIDE=$(no_tui_path)
    run_maki doctor --provider maki-anthropic
    assert_rc 2
    assert_out_has "fail  bun: not found on PATH"
    assert_out_has "fail  opencode: not found on PATH"
    PATH_OVERRIDE=

    # an invalid value fails the command naming the key and the values
    printf 'tui = "vim"\n' >"$XDG_CONFIG_HOME/maki-oss/config.toml"
    run_maki doctor
    assert_rc 1
    assert_err_has "tui"
    assert_err_has "opencode"
}

test_session_creates_uploads_and_syncs() {
    begin "bare maki-oss creates, uploads, runs, and collects a patch in order"
    new_case session-create
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_remembered_provider maki-stub

    run_maki
    assert_rc 0
    assert_log_has "create"
    assert_log_has "upload"
    assert_log_has "exec"
    assert_log_line "--tty"
    assert_log_line_before "maki" 'git diff --binary --full-index refs/maki-oss/base refs/maki-oss/result'
    assert_log_missing "download"
    assert_log_before "create" "upload"
    assert_log_line_before "upload" "maki"
    if [ ! -e "$STUB_STATE_DIR/sandboxes/maki-myproject" ]; then
        bad "sandbox was not created"
    fi
    assert_log_missing "driver-config-json"
}

test_session_reuses_without_upload() {
    begin "existing sandbox is reused and nothing is uploaded"
    new_case session-reuse
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub

    run_maki
    assert_rc 0
    assert_err_has "Reusing sandbox"
    assert_log_missing "create"
    assert_log_missing "upload"
    assert_log_line_before "maki" 'git diff --binary --full-index refs/maki-oss/base refs/maki-oss/result'
    assert_log_missing "download"
}

test_session_starts_stopped_sandbox() {
    begin "stopped sandbox is started instead of recreated"
    new_case session-stopped
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Stopped
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub

    run_maki
    assert_rc 0
    assert_log_has "start"
    assert_log_missing "create"
    assert_log_missing "upload"
    assert_log_line_before "maki" 'git diff --binary --full-index refs/maki-oss/base refs/maki-oss/result'
}

test_session_attaches_missing_provider() {
    begin "missing remembered provider is attached with --wait before exec"
    new_case session-attach
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub

    run_maki
    assert_rc 0
    assert_log_has "attach"
    assert_log_line "--wait"
    assert_log_line_before "attach" "--tty"
    assert_log_missing "create"
    assert_log_missing "upload"
}

test_session_inline_bootstrap() {
    begin "no provider on a TTY bootstraps through the wizard and continues"
    new_case session-bootstrap
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_maki_store opencode-go "fixture-bootstrap-key"
    CREDENTIAL_ENV=OPENCODE_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_maki_stdin "1\n"
    assert_rc 0
    assert_out_has "No provider is configured yet"
    assert_out_has "Provider 'maki-opencode-go' created."
    assert_log_has "exec"
    assert_log_line "--tty"
    assert_log_line_before "maki" 'git diff --binary --full-index refs/maki-oss/base refs/maki-oss/result'
    assert_log_missing "download"
    grep -Fq 'providers = "maki-opencode-go"' "$XDG_CONFIG_HOME/maki-oss/config.toml" \
        || bad "bootstrap did not remember the provider"
    if [ ! -e "$STUB_STATE_DIR/sandboxes/maki-myproject" ]; then
        bad "sandbox was not created after the bootstrap"
    fi
    assert_secret_absent "fixture-bootstrap-key"
}

test_session_no_provider_non_tty() {
    begin "no provider refuses before any gateway mutation"
    new_case session-noprov
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"

    run_maki
    assert_rc 1
    assert_err_has "provider setup"
    if [ -s "$LOG" ]; then
        bad "gateway was contacted: $(cat "$LOG")"
    fi
}

test_session_unknown_gateway_provider() {
    begin "remembered provider missing from the gateway fails before create"
    new_case session-missing-provider
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR" "$XDG_CONFIG_HOME/maki-oss"
    printf 'providers = "maki-ghost"\n' >"$XDG_CONFIG_HOME/maki-oss/config.toml"

    run_maki
    assert_rc 1
    assert_err_has "maki-ghost"
    assert_err_has "provider setup"
    assert_log_missing "create"
    assert_log_missing "exec"
}

test_run_bootstraps_from_scratch() {
    begin "run ensures and bootstraps a fresh project with stdout left clean"
    new_case run-scratch
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_remembered_provider maki-stub
    EXEC_STDOUT='{"result":"stub-ok"}'

    run_maki run "hello"
    assert_rc 0
    assert_out_has '{"result":"stub-ok"}'
    assert_out_missing "Creating sandbox"
    assert_out_missing "Uploading the project"
    assert_out_missing "No sandbox changes"
    assert_err_has "Creating sandbox"
    assert_err_has "No sandbox changes to sync."
    assert_log_has "create"
    assert_log_has "upload"
    assert_log_has "exec"
    assert_log_missing "download"
    assert_log_before "create" "upload"
    assert_log_line_before "upload" "maki"
}

test_session_model_precedence() {
    begin "config model is used unless --model overrides it"
    new_case session-model
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    attach_stub_provider maki-myproject maki-stub
    mkdir -p "$XDG_CONFIG_HOME/maki-oss"
    printf 'providers = "maki-stub"\nmodel = "config/model"\n' \
        >"$XDG_CONFIG_HOME/maki-oss/config.toml"
    printf 'maki-stub\n' >>"$STUB_STATE_DIR/providers.list"

    run_maki run "one"
    assert_rc 0
    assert_log_line "config/model"

    reset_log
    run_maki run --model flag/model "two"
    assert_rc 0
    assert_log_line "flag/model"
    assert_log_line_missing "config/model"
}

test_session_no_sync() {
    begin "--no-sync skips the download and prints the manual hint"
    new_case session-nosync
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub

    run_maki --no-sync maki
    assert_rc 0
    assert_log_missing "download"
    assert_log_missing "maki-oss/result"
    assert_err_has "--no-sync"
}

test_session_sync_failure_preserves_code() {
    begin "collection failure warns on stderr and keeps Maki's exit code"
    new_case session-sync-fail
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    EXEC_STDOUT='partial-output'
    EXEC_EXIT=7
    STUB_EXEC_SCRIPT_FAIL='maki-oss result'

    run_maki run "boom"
    assert_rc 7
    assert_out_has "partial-output"
    assert_err_has "could not collect sandbox changes"
    assert_err_has "sandbox:   maki-myproject"
    assert_log_missing "download"
    if [ ! -f "$HOME/.local/state/maki-oss/sessions/maki-myproject/pending" ]; then
        bad "collection failure did not write the pending marker"
    fi
}

test_session_plain_apply() {
    begin "a clean patch applies to a plain project and preserves host-only files"
    new_case session-plain-apply
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'host-version\n' >"$RUN_DIR/readme.txt"
    printf 'host-only\n' >"$RUN_DIR/hostonly.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    GIT_TRACE_LOG=$CASE/git.trace
    STUB_MAKI_SCRIPT='printf "sandbox-version\n" > readme.txt; printf "new-file\n" > new.txt'

    run_maki maki
    assert_rc 0
    patch_file=$(find "$(session_dir maki-myproject)" -maxdepth 1 -name 'patch-*.patch' -type f 2>/dev/null | head -n 1)
    [ -n "$patch_file" ] || bad "the applied patch was not retained"
    assert_trace_before "maki-oss result" "apply --check"
    assert_trace_check_before_apply
    grep -Fq 'sandbox-version' "$RUN_DIR/readme.txt" \
        || bad "the patch did not update the matching file"
    grep -Fq 'new-file' "$RUN_DIR/new.txt" 2>/dev/null \
        || bad "the patch did not create the new file"
    grep -Fq 'host-only' "$RUN_DIR/hostonly.txt" 2>/dev/null \
        || bad "host-only file was removed"
    assert_log_missing "download"
}

test_session_plain_conflict_keeps_project() {
    begin "a conflicting plain patch leaves every host file unchanged"
    new_case session-plain-conflict
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'host-version\n' >"$RUN_DIR/readme.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    # Fix the host file exactly as it is when the conflict check runs.
    STUB_MAKI_SCRIPT='printf "sandbox-version\n" > readme.txt
printf "changed-during-session\n" > "'"$RUN_DIR"'/readme.txt"'

    run_maki maki
    assert_rc 0
    if [ "$(cat "$RUN_DIR/readme.txt")" != changed-during-session ]; then
        bad "the conflict changed the host file"
    fi
    assert_err_has "does not apply cleanly"
    patch_file=$(find "$HOME/.local/state/maki-oss/sessions/maki-myproject" -maxdepth 1 -name 'patch-*.patch' -type f 2>/dev/null | head -n 1)
    if [ -z "$patch_file" ] || [ ! -s "$patch_file" ]; then
        bad "the conflicting patch was not retained"
    fi
    if [ ! -f "$HOME/.local/state/maki-oss/sessions/maki-myproject/pending" ]; then
        bad "the conflict did not write the pending marker"
    fi
}

test_policy_advisor_enabled_on_session() {
    begin "session ensure enables the policy advisor before Maki attaches"
    new_case advisor-enable
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub

    run_maki maki
    assert_rc 0
    assert_log_has "settings"
    assert_log_line "agent_policy_proposals_enabled"
    assert_log_line "true"
    assert_log_before "settings" "exec"
}

test_policy_advisor_enabled_on_fresh_create() {
    begin "a freshly created sandbox also gets the advisor before exec"
    new_case advisor-create
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_remembered_provider maki-stub

    run_maki maki
    assert_rc 0
    assert_log_has "create"
    assert_log_has "settings"
    assert_log_before "create" "settings"
    assert_log_before "settings" "exec"
}

test_policy_advisor_failure_is_soft() {
    begin "advisor enable failure warns and the session still runs"
    new_case advisor-softfail
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    SETTINGS_EXIT=1

    run_maki maki
    assert_rc 0
    assert_err_has "policy advisor"
    assert_log_has "exec"
}

test_policy_advisor_not_set_by_up() {
    begin "explicit up never touches settings"
    new_case advisor-up
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"

    run_maki up
    assert_rc 0
    assert_log_missing "settings"
}

test_exit_surfaces_pending_proposals() {
    begin "session exit surfaces pending network-rule proposals"
    new_case advisor-exit
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    RULE_PENDING='Network Rules:  (version 3, 2 chunks)

  Chunk: 2258b82a-8253-4094-bf5f-3e309b2b9c11
  Status: pending

  Chunk: 07d2d597-a043-40aa-bc47-21f0ae0d9971
  Status: pending'

    run_maki maki
    assert_rc 0
    assert_err_has "2 pending network-rule proposal"
    assert_err_has "policy review"
}

test_exit_silent_when_no_proposals() {
    begin "exit prints no policy note when nothing is pending"
    new_case advisor-exit-empty
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub

    run_maki maki
    assert_rc 0
    assert_err_missing "pending network-rule proposal"
}

test_exit_surfaces_proposals_on_interrupt() {
    begin "interrupted session still surfaces pending proposals"
    new_case advisor-exit-int
    if ! command -v pkill >/dev/null 2>&1; then
        skipped "pkill is not installed"
        return 0
    fi
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    RULE_PENDING='Network Rules:  (version 3, 1 chunk)

  Chunk: 2258b82a-8253-4094-bf5f-3e309b2b9c11
  Status: pending'

    # Run in the foreground so SIGINT is not ignored, then signal once the
    # exec stub has started. The exit hook must still surface proposals.
    (
        sleep 2
        pkill -INT -f "$MAKI maki" 2>/dev/null || true
        sleep 3
        pkill -KILL -f "$MAKI maki" 2>/dev/null || true
    ) &
    RC=0
    PATH="$STUB_DIR:$PATH" \
    HOME="$HOME" \
    XDG_CONFIG_HOME="$XDG_CONFIG_HOME" \
    STUB_LOG="$STUB_LOG" \
    STUB_STATE_DIR="$STUB_STATE_DIR" \
    STUB_RULE_PENDING="$RULE_PENDING" \
    STUB_EXEC_STDOUT='interrupted' \
        "$MAKI" maki >"$OUT" 2>"$ERR" </dev/null || RC=$?
    wait || true
    assert_err_has "1 pending network-rule proposal"
}

test_exit_rule_failure_keeps_exit_code() {
    begin "an unavailable rule command never masks Maki's exit code"
    new_case advisor-exit-rulefail
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    EXEC_EXIT=5
    RULE_EXIT=1

    run_maki run "boom"
    assert_rc 5
    assert_err_missing "pending network-rule proposal"
}

test_policy_review_empty() {
    begin "policy review reports an empty inbox and exits zero"
    new_case policy-review-empty
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready

    run_maki policy review
    assert_rc 0
    assert_log_has "rule"
    assert_log_line "pending"
    assert_log_line "maki-myproject"
}

test_policy_review_lists_chunks() {
    begin "policy review passes through pending chunk text"
    new_case policy-review-list
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    RULE_PENDING='Network Rules:  (version 3, 1 chunk)

  Chunk: 2258b82a-8253-4094-bf5f-3e309b2b9c11
  Status: pending'

    run_maki policy review
    assert_rc 0
    assert_out_has "2258b82a-8253-4094-bf5f-3e309b2b9c11"
}

test_policy_approve_non_tty_requires_yes() {
    begin "policy approve refuses without --yes when stdin is not a TTY"
    new_case policy-approve-notty
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready

    run_maki policy approve 2258b82a
    assert_rc 1
    assert_err_has "--yes"
    assert_log_missing "approve"
}

test_policy_approve_with_yes_targets_one_chunk() {
    begin "policy approve --yes approves exactly one chunk id"
    new_case policy-approve-yes
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready

    run_maki policy approve 2258b82a --yes
    assert_rc 0
    assert_log_has "approve"
    assert_log_line "--chunk-id"
    assert_log_line "2258b82a"
    assert_log_missing "approve-all"
}

test_policy_reject_requires_reason() {
    begin "policy reject without --reason is a usage error"
    new_case policy-reject-noreason
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready

    run_maki policy reject 2258b82a
    assert_rc 1
    assert_err_has "--reason"
    assert_log_missing "reject"
}

test_policy_reject_passes_reason() {
    begin "policy reject forwards the reason to the agent"
    new_case policy-reject-reason
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready

    run_maki policy reject 2258b82a --reason "Scope this to docs/ paths only."
    assert_rc 0
    assert_log_has "reject"
    assert_log_line "--chunk-id"
    assert_log_line "2258b82a"
    assert_log_line "--reason"
    assert_log_line "Scope this to docs/ paths only."
}

test_no_jq_fallback() {
    begin "sandbox parsing works without jq"
    new_case no-jq
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    PATH_OVERRIDE=$(no_jq_path)

    run_maki up
    assert_rc 0
    assert_log_has "create"

    reset_log
    run_maki up
    assert_rc 0
    assert_log_missing "create"
    assert_out_has "already exists"

    reset_log
    run_maki status
    assert_rc 0
    assert_out_has "Phase:     Ready"

    # Compact single-line JSON (no space after the colon) parses too.
    reset_log
    JSON_COMPACT=1
    run_maki status
    assert_rc 0
    assert_out_has "Phase:     Ready"

    reset_log
    run_maki up
    assert_rc 0
    assert_log_missing "create"
    assert_out_has "already exists"

    # A later sandbox on the same line must not supply the target's phase.
    printf 'Stopped\n' >"$STUB_STATE_DIR/sandboxes/maki-myproject"
    printf 'Ready\n' >"$STUB_STATE_DIR/sandboxes/maki-zzz"
    reset_log
    run_maki status
    assert_rc 0
    assert_out_has "Phase:     Stopped"
}

test_no_jq_attached_providers() {
    begin "status lists every attached provider without jq"
    new_case no-jq-providers
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    PATH_OVERRIDE=$(no_jq_path)
    JSON_COMPACT=1
    seed_sandbox maki-myproject Ready
    attach_stub_provider maki-myproject anthropic
    attach_stub_provider maki-myproject openrouter
    run_maki status
    assert_rc 0
    assert_out_has "Providers: anthropic,openrouter"
}

test_session_create_race_reuses() {
    begin "losing a create race reuses the winner's sandbox"
    new_case create-race
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_remembered_provider maki-stub
    CREATE_RACE=1
    run_maki run "hi"
    assert_rc 0
    assert_log_line_before "maki" 'git diff --binary --full-index refs/maki-oss/base refs/maki-oss/result'
    assert_log_missing "download"
    assert_log_missing "upload"
}

test_provider_setup_sigint() {
    begin "SIGINT during provider setup exits and cleans up"
    new_case setup-sigint
    if ! command -v pkill >/dev/null 2>&1; then
        skipped "pkill is not installed"
        return 0
    fi
    mkdir -p "$CASE/tmp"
    mkfifo "$CASE/in.fifo"
    # The helper runs in the foreground so SIGINT is not ignored (async
    # children ignore it). The watchdog holds the fifo's write end open,
    # signals the helper once it is prompting, then force-kills so a
    # regression fails instead of hanging the suite.
    (
        exec 3>"$CASE/in.fifo"
        sleep 2
        pkill -INT -f "$MAKI provider setup" 2>/dev/null || true
        sleep 3
        pkill -KILL -f "$MAKI provider setup" 2>/dev/null || true
    ) &
    RC=0
    TMPDIR="$CASE/tmp" \
    PATH="$STUB_DIR:$PATH" \
    HOME="$HOME" \
    XDG_CONFIG_HOME="$XDG_CONFIG_HOME" \
    STUB_LOG="$STUB_LOG" \
    STUB_STATE_DIR="$STUB_STATE_DIR" \
    MAKI_OSS_INTERACTIVE=1 \
        "$MAKI" provider setup >"$OUT" 2>"$ERR" <"$CASE/in.fifo" || RC=$?
    wait || true
    if [ "$RC" -ne 130 ]; then
        bad "expected exit 130 after SIGINT, got $RC"
    fi
    if ls "$CASE/tmp"/maki-oss-setup.* >/dev/null 2>&1; then
        bad "setup temp directory left behind after SIGINT"
    fi
}

test_missing_policy_dependency() {
    begin "up fails as a dependency error when the policy file is missing"
    new_case missing-policy
    run_maki up --policy "$CASE/does-not-exist.yaml"
    assert_rc 2
}

test_fish_plugin() {
    begin "fish install, idempotence, resolution, and uninstall"
    new_case fish-plugin
    if ! command -v fish >/dev/null 2>&1; then
        skipped "fish is not installed"
        return 0
    fi

    run_maki fish install
    assert_rc 0
    assert_out_has "linked:"
    if [ ! -L "$XDG_CONFIG_HOME/fish/functions/maki-oss.fish" ]; then
        bad "mutations symlink was not created"
    fi

    run_maki fish install
    assert_rc 0
    assert_out_has "already installed"

    run_fish "type -q maki-oss; and maki-oss help"
    assert_rc 0
    assert_fish_out_has "Usage:"

    mkdir -p "$XDG_CONFIG_HOME/fish/functions"
    printf 'keep me\n' >"$XDG_CONFIG_HOME/fish/functions/foreign.fish"
    run_maki fish uninstall
    assert_rc 0
    assert_out_has "removed:"
    if [ ! -f "$XDG_CONFIG_HOME/fish/functions/foreign.fish" ]; then
        bad "foreign file was deleted"
    fi
    if [ -e "$XDG_CONFIG_HOME/fish/functions/maki-oss.fish" ]; then
        bad "managed symlink was not removed"
    fi
}

test_fish_fisher_layout() {
    begin "fisher-style copy (not symlink) resolves via PATH"
    new_case fish-fisher
    if ! command -v fish >/dev/null 2>&1; then
        skipped "fish is not installed"
        return 0
    fi

    # fisher expands plugins into the fish config directory (copies, not
    # symlinks); the wrapper then finds the helper on PATH.
    mkdir -p "$XDG_CONFIG_HOME/fish/functions" "$XDG_CONFIG_HOME/fish/completions"
    cp "$ROOT/fish/functions/maki-oss.fish" "$XDG_CONFIG_HOME/fish/functions/maki-oss.fish"
    cp "$ROOT/fish/completions/maki-oss.fish" "$XDG_CONFIG_HOME/fish/completions/maki-oss.fish"
    FISH_PATH="$STUB_DIR:$ROOT/bin:$PATH"

    run_fish "type -q maki-oss; and maki-oss help"
    assert_rc 0
    assert_fish_out_has "Usage:"
}

test_fish_completions() {
    begin "fish completions list subcommands and flags"
    new_case fish-completions
    if ! command -v fish >/dev/null 2>&1; then
        skipped "fish is not installed"
        return 0
    fi

    run_maki fish install
    assert_rc 0

    run_fish "complete -C 'maki-oss '"
    assert_rc 0
    assert_fish_out_has "doctor"
    assert_fish_out_has "up"
    assert_fish_out_has "run"
    assert_fish_out_has "status"

    run_fish "complete -C 'maki-oss run --'"
    assert_rc 0
    assert_fish_out_has "--name"
    assert_fish_out_has "--yes"
    assert_fish_out_has "--model"
    assert_fish_out_has "--no-sync"
    assert_fish_out_has "--continue"
    assert_fish_out_has "--resume"
    assert_fish_out_has "--session-id"

    run_fish "complete -C 'maki-oss provider '"
    assert_rc 0
    assert_fish_out_has "setup"

    run_fish "complete -C 'maki-oss provider setup --'"
    assert_rc 0
    assert_fish_out_has "--from"
    assert_fish_out_has "--credential"
    assert_fish_out_has "--profile"
}

# ---------------------------------------------------------------------------
# Session idle stop
# ---------------------------------------------------------------------------

idle_dir() {
    printf '%s' "$HOME/.local/state/maki-oss/sessions/maki-myproject"
}

# Succeeds once FILE has a line matching PATTERN (grep), within SECS seconds.
wait_for_match() { # FILE PATTERN SECS
    wfm_i=0
    while [ "$wfm_i" -lt "$3" ]; do
        if grep -q -- "$2" "$1" 2>/dev/null; then
            return 0
        fi
        sleep 1
        wfm_i=$((wfm_i + 1))
    done
    return 1
}

stop_count() {
    grep -cx 'stop' "$LOG" 2>/dev/null || true
}

# Makes the in-sandbox scan answer WORD (idle or busy).
idle_scan_answers() { # WORD
    printf '%s\n' "$1" >"$CASE/scan-answer"
    printf 'maki-oss-idle|0|%s\n' "$CASE/scan-answer" >"$CASE/exec-cases"
    EXEC_CASES=$CASE/exec-cases
}

# Kills the watchers a case armed (and their sleeps) so none outlive it.
kill_idle_watchers() {
    sed -n 's/.*watcher=\([0-9][0-9]*\).*/\1/p' "$(idle_dir)/idle.log" 2>/dev/null |
        while read -r kiw_pid; do
            pkill -P "$kiw_pid" 2>/dev/null || true
            kill "$kiw_pid" 2>/dev/null || true
        done
}

idle_session_case() { # CASE-NAME
    new_case "$1"
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
}

test_idle_stop_setting() {
    begin "idle_stop resolves to seconds, 0 disables it, and bad values are usage errors"
    idle_session_case idle-setting

    ENV_IDLE_STOP=
    run_maki maki
    assert_rc 0
    kill_idle_watchers
    grep -q 'armed secs=3600 ' "$(idle_dir)/idle.log" || bad "default is not 3600 seconds"

    rm -rf "$(idle_dir)"
    ist_config=$XDG_CONFIG_HOME/maki-oss/config.toml
    cp "$ist_config" "$CASE/config.orig"
    printf 'idle_stop = "90m"\n' >>"$ist_config"
    run_maki maki
    assert_rc 0
    kill_idle_watchers
    grep -q 'armed secs=5400 ' "$(idle_dir)/idle.log" || bad "90m is not 5400 seconds"
    cp "$CASE/config.orig" "$ist_config"

    reset_log
    run_maki maki --idle-stop soon
    assert_rc 1
    assert_err_has "idle_stop"
    if [ -s "$LOG" ]; then
        bad "an invalid idle_stop reached openshell"
    fi

    rm -rf "$(idle_dir)"
    run_maki maki --idle-stop 0
    assert_rc 0
    if [ -e "$(idle_dir)/idle" ]; then
        bad "--idle-stop 0 wrote an idle stamp"
    fi

    ENV_IDLE_STOP=2
    run_maki up
    assert_rc 0
    if [ -e "$(idle_dir)/idle" ]; then
        bad "up wrote an idle stamp"
    fi
}

test_idle_stop_after_idle() {
    begin "the sandbox stops once the idle period passes after the last session"
    idle_session_case idle-stop
    idle_scan_answers idle
    ENV_IDLE_STOP=2s
    run_maki maki
    assert_rc 0
    if ! wait_for_match "$LOG" '^stop$' 15; then
        bad "no sandbox stop after the idle period"
        kill_idle_watchers
        return 0
    fi
    sleep 1
    [ "$(stop_count)" = 1 ] || bad "expected one stop, saw $(stop_count)"
    assert_log_line "maki-oss-idle"
    assert_log_line_before "maki-oss-idle" "stop"
    grep -q ' stopped ' "$(idle_dir)/idle.log" || bad "idle.log has no stopped line"
    [ "$(cat "$STUB_STATE_DIR/sandboxes/maki-myproject")" = Stopped ] || bad "sandbox is not Stopped"
}

test_idle_stop_after_sighup() {
    begin "a session killed by SIGHUP still arms the idle stop"
    idle_session_case idle-sighup
    idle_scan_answers idle
    ENV_IDLE_STOP=2
    STUB_MAKI_SCRIPT='sleep 20'
    # The job's shell reports the hangup on its stderr; keep the suite quiet.
    run_maki maki 2>/dev/null &
    ish_job=$!
    STUB_MAKI_SCRIPT=
    if ! wait_for_match "$(idle_dir)/idle.log" 'armed ' 10; then
        bad "the session never armed a watcher"
        wait "$ish_job" || true
        return 0
    fi
    sleep 1
    ish_pid=$(sed -n 's/.*session=\([0-9][0-9]*\).*/\1/p' "$(idle_dir)/idle.log" | head -n 1)
    kill -HUP "$ish_pid" 2>/dev/null || bad "could not signal the helper"
    wait "$ish_job" 2>/dev/null || true
    if ! wait_for_match "$LOG" '^stop$' 15; then
        bad "no sandbox stop after SIGHUP"
        kill_idle_watchers
    fi
}

test_idle_stop_newer_session_cancels() {
    begin "a newer session cancels the pending stop until it closes"
    idle_session_case idle-newer
    idle_scan_answers idle
    ENV_IDLE_STOP=3
    run_maki maki
    assert_rc 0
    if ! wait_for_match "$(idle_dir)/idle.log" 'closed ' 10; then
        bad "the first session never closed"
        kill_idle_watchers
        return 0
    fi
    STUB_MAKI_SCRIPT='sleep 7'
    run_maki maki &
    inc_job=$!
    STUB_MAKI_SCRIPT=
    # The first deadline passes while the second session still runs.
    if ! wait_for_match "$(idle_dir)/idle.log" 'superseded ' 10; then
        bad "the first watcher was not superseded"
    fi
    [ "$(stop_count)" = 0 ] || bad "stopped while the newer session ran"
    wait "$inc_job" || true
    if ! wait_for_match "$LOG" '^stop$' 15; then
        bad "no stop after the newer session closed"
        kill_idle_watchers
        return 0
    fi
    sleep 1
    [ "$(stop_count)" = 1 ] || bad "expected one stop, saw $(stop_count)"
}

test_idle_stop_busy_sandbox() {
    begin "a running Maki inside the sandbox keeps it up"
    idle_session_case idle-busy
    idle_scan_answers busy
    ENV_IDLE_STOP=2
    run_maki maki
    assert_rc 0
    if ! wait_for_match "$(idle_dir)/idle.log" ' busy ' 15; then
        bad "idle.log has no busy line"
        kill_idle_watchers
        return 0
    fi
    assert_log_line "maki-oss-idle"
    [ "$(stop_count)" = 0 ] || bad "stopped a busy sandbox"
}

test_idle_stop_failure_is_silent() {
    begin "a failed idle stop is logged, silent, and not retried"
    idle_session_case idle-stop-fail
    idle_scan_answers idle
    ENV_IDLE_STOP=2
    run_maki maki
    assert_rc 0
    cp "$ERR" "$CASE/err.before"
    # The stub's stop fails once the sandbox is gone from its state.
    rm -f "$STUB_STATE_DIR/sandboxes/maki-myproject"
    if ! wait_for_match "$(idle_dir)/idle.log" 'stop-failed ' 15; then
        bad "idle.log has no stop-failed line"
        kill_idle_watchers
        return 0
    fi
    sleep 3
    [ "$(stop_count)" = 1 ] || bad "expected one stop attempt, saw $(stop_count)"
    cmp -s "$ERR" "$CASE/err.before" || bad "the watcher wrote to the session's stderr"
}

test_example_config() {
    begin "examples/config.toml selects the base image and no provider"
    new_case example-config
    mkdir -p "$XDG_CONFIG_HOME/maki-oss"
    cp "$ROOT/examples/config.toml" "$XDG_CONFIG_HOME/maki-oss/config.toml"
    run_maki up
    assert_rc 0
    assert_log_missing "--provider"
    assert_log_line "maki-agent:local"
    assert_log_line "2"
    assert_log_line "4Gi"
    assert_log_has "maki-minimal.yaml"
}

# The placeholder prefix is never written in this repository. OpenShell's proxy
# answers 403 to any request body containing it, and Maki sends loaded context
# in every request body, so one literal spelling in a file the agent reads
# breaks every later request (AGENTS.md, "Never spell the placeholder").
test_no_placeholder_spelling() {
    begin "no agent-readable file spells the credential placeholder"
    new_case placeholder-spelling
    needle=$(printf 'openshell:resolve'':env:')
    hits=
    for f in "$ROOT/AGENTS.md" "$ROOT/README.md" "$ROOT/Makefile" \
        "$ROOT/docs"/*.md "$ROOT/docs/ai"/*.md "$ROOT/examples"/*.toml \
        "$ROOT/examples/providers"/*.yaml "$ROOT/examples/policies"/*.yaml; do
        [ -f "$f" ] || continue
        if grep -qF -- "$needle" "$f"; then
            hits="$hits ${f#"$ROOT"/}"
        fi
    done
    if [ -n "$hits" ]; then
        bad "placeholder prefix spelled in:$hits (reword; see AGENTS.md)"
    fi
}

test_baseline_capture_clean_git() {
    begin "clean git baseline records branch, commit, and tree without touching the repo"
    new_case baseline-clean
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub
    branch_before=$(git -C "$RUN_DIR" symbolic-ref --short HEAD)
    commit_before=$(git -C "$RUN_DIR" rev-parse HEAD)
    tree_before=$(git -C "$RUN_DIR" rev-parse 'HEAD^{tree}')

    run_maki run "hi"
    assert_rc 0
    [ "$(baseline_value maki-repo mode)" = clean ] || bad "baseline mode is not clean"
    [ "$(baseline_value maki-repo dirty)" = 0 ] || bad "baseline was marked dirty"
    [ "$(baseline_value maki-repo branch)" = "$branch_before" ] || bad "baseline branch differs"
    [ "$(baseline_value maki-repo commit)" = "$commit_before" ] || bad "baseline commit differs"
    [ "$(baseline_value maki-repo tree)" = "$tree_before" ] || bad "baseline tree differs"
    [ "$(baseline_value maki-repo stale)" = 0 ] || bad "fresh sandbox was marked stale"
    [ "$(git -C "$RUN_DIR" symbolic-ref --short HEAD)" = "$branch_before" ] \
        || bad "capture changed the branch"
    [ -z "$(git -C "$RUN_DIR" status --porcelain)" ] || bad "capture changed the worktree"
}

test_baseline_capture_dirty_git() {
    begin "dirty git baseline uses a synthetic commit and leaves the index alone"
    new_case baseline-dirty
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    printf 'local edit\n' >>"$RUN_DIR/tracked.txt"
    printf 'untracked\n' >"$RUN_DIR/untracked.txt"
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub
    commit_before=$(git -C "$RUN_DIR" rev-parse HEAD)
    branch_before=$(git -C "$RUN_DIR" symbolic-ref --short HEAD)
    tmp_index=$CASE/expected.index
    rm -f "$tmp_index"
    GIT_INDEX_FILE=$tmp_index git -C "$RUN_DIR" read-tree HEAD
    GIT_INDEX_FILE=$tmp_index git -C "$RUN_DIR" add -A
    expected_tree=$(GIT_INDEX_FILE=$tmp_index git -C "$RUN_DIR" write-tree)
    rm -f "$tmp_index"

    run_maki run "hi"
    assert_rc 0
    [ "$(baseline_value maki-repo mode)" = dirty ] || bad "baseline mode is not dirty"
    [ "$(baseline_value maki-repo dirty)" = 1 ] || bad "baseline dirty flag is not set"
    [ "$(baseline_value maki-repo commit)" = "$commit_before" ] || bad "baseline commit differs"
    [ "$(baseline_value maki-repo tree)" = "$expected_tree" ] || bad "synthetic tree does not match the working tree"
    base=$(baseline_value maki-repo base)
    [ "$base" != "$commit_before" ] || bad "dirty baseline reused HEAD instead of a synthetic commit"
    [ "$(git -C "$RUN_DIR" rev-parse "$base^")" = "$commit_before" ] \
        || bad "synthetic baseline is not a child of HEAD"
    [ "$(git -C "$RUN_DIR" symbolic-ref --short HEAD)" = "$branch_before" ] \
        || bad "capture changed the branch"
    [ "$(git -C "$RUN_DIR" status --porcelain)" = " M tracked.txt
?? untracked.txt" ] || bad "capture changed the user's working tree state"
}

test_sandbox_baseline_after_upload() {
    begin "sandbox baseline is recorded after upload and keeps git out of the workdir"
    new_case sandbox-baseline
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    seed_remembered_provider maki-stub

    run_maki run "hi"
    assert_rc 0
    assert_log_line_before "upload" "maki-oss-git"
    assert_log_line_before "maki-oss-git" "maki"
    if [ ! -d "$CASE/sandbox/.maki-oss/git" ]; then
        bad "sandbox git directory was not created outside the workdir"
    fi
    if [ -e "$SANDBOX_WORKDIR/.git" ] || [ -e "$SANDBOX_WORKDIR/.maki-oss" ]; then
        bad "baseline initialization wrote into the project workdir"
    fi
    [ "$(baseline_value maki-repo mode)" = clean ] || bad "baseline was not recorded"
}

test_existing_sandbox_baseline_migration() {
    begin "a reused sandbox without a baseline gets one and warns once"
    new_case sandbox-migration
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub

    run_maki run "hi"
    assert_rc 0
    assert_err_has "Recording a sandbox baseline"
    assert_err_has "changes already in the sandbox are not exported"
    init_count=$(grep -c 'git init -q' "$LOG" 2>/dev/null || true)
    [ "$init_count" = 1 ] || bad "expected exactly one baseline initialization, got ${init_count:-0}"
}

test_stale_sandbox_keeps_patch() {
    begin "a stale sandbox is reported and its patch is kept without applying"
    new_case stale-sandbox
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub
    run_maki upload .
    reset_log
    GIT_TRACE_LOG=$CASE/git.trace
    printf 'host-change\n' >>"$RUN_DIR/tracked.txt"
    STUB_MAKI_SCRIPT='printf "sandbox-change\n" >> tracked.txt'

    run_maki maki
    assert_rc 0
    assert_err_has "is stale"
    assert_err_has "patch will be kept for review"
    git_trace_missing "worktree add"
    git_trace_missing "git apply"
    if grep -Fq 'sandbox-change' "$RUN_DIR/tracked.txt"; then
        bad "a stale sandbox patch was applied to the host"
    fi
    patch_file=$(find "$(session_dir maki-repo)" -maxdepth 1 -name 'patch-*.patch' -type f 2>/dev/null | head -n 1)
    [ -n "$patch_file" ] || bad "the stale patch was not retained"
    [ -f "$(session_dir maki-repo)/pending" ] || bad "the stale patch did not write a pending marker"
}

test_session_state_permissions_and_second_session() {
    begin "session state is owner-only and a second session reuses the baseline"
    new_case state-perms
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'v1\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    STUB_MAKI_SCRIPT='printf "v2\n" > file.txt'

    run_maki maki
    assert_rc 0
    state_dir=$(session_dir maki-myproject)
    assert_file_mode "$state_dir" 700
    assert_file_mode "$state_dir/baseline" 600
    patch_file=$(find "$state_dir" -maxdepth 1 -name 'patch-*.patch' -type f 2>/dev/null | head -n 1)
    [ -n "$patch_file" ] || bad "patch file was not written"
    if [ -n "$patch_file" ]; then
        assert_file_mode "$patch_file" 600
    fi
    [ ! -f "$state_dir/pending" ] || bad "a successful apply left a pending marker"

    reset_log
    GIT_TRACE_LOG=$CASE/git.trace
    STUB_MAKI_SCRIPT=
    run_maki maki
    assert_rc 0
    assert_err_missing "Recording a sandbox baseline"
    [ -f "$state_dir/baseline" ] || bad "the previous baseline disappeared"
    [ ! -f "$state_dir/pending" ] || bad "a no-op session wrote a pending marker"
}

test_interrupt_still_collects_patch() {
    begin "SIGINT still collects the sandbox patch"
    new_case interrupt-collect
    if ! command -v pkill >/dev/null 2>&1; then
        skipped "pkill is not installed"
        return 0
    fi
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    STUB_MAKI_SCRIPT='sleep 3; printf "after-int\n" > after.txt'

    run_maki maki &
    helper_pid=$!
    sleep 1
    pkill -INT -f "$MAKI maki" 2>/dev/null || true
    wait "$helper_pid" 2>/dev/null || true
    patch_file=$(find "$(session_dir maki-myproject)" -maxdepth 1 -name 'patch-*.patch' -type f 2>/dev/null | head -n 1)
    [ -n "$patch_file" ] || bad "no patch was collected after SIGINT"
    grep -Fq 'after-int' "$RUN_DIR/after.txt" 2>/dev/null \
        || bad "the interrupted session's changes were not applied"
}

test_patch_content_and_git_isolation() {
    begin "patch carries edits, deletes, renames, mode, symlink, and binary without .git"
    new_case patch-content
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/tracked.txt"
    printf 'delete me\n' >"$RUN_DIR/deleted.txt"
    printf 'rename me\n' >"$RUN_DIR/renamed.txt"
    printf 'base-script\n' >"$RUN_DIR/mode.sh"
    printf 'base-binary\n' >"$RUN_DIR/binary.bin"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    STUB_MAKI_SCRIPT='printf "modified\n" > tracked.txt
rm deleted.txt
mv renamed.txt renamed-new.txt
printf "new\n" > added.txt
printf "\000\001\002binary-v2" > binary.bin
chmod +x mode.sh
ln -s tracked.txt link
mkdir -p .git && printf "fake\n" > .git/config'

    run_maki maki
    assert_rc 0
    [ "$(cat "$RUN_DIR/tracked.txt")" = modified ] || bad "modification did not travel"
    [ ! -e "$RUN_DIR/deleted.txt" ] || bad "deletion did not travel"
    [ ! -e "$RUN_DIR/renamed.txt" ] || bad "renamed source still exists"
    [ "$(cat "$RUN_DIR/renamed-new.txt" 2>/dev/null)" = 'rename me' ] || bad "rename did not travel"
    [ "$(cat "$RUN_DIR/added.txt" 2>/dev/null)" = new ] || bad "addition did not travel"
    [ "$(cat "$RUN_DIR/binary.bin")" = "$(printf '\000\001\002binary-v2')" ] || bad "binary change did not travel"
    [ -x "$RUN_DIR/mode.sh" ] || bad "mode change did not travel"
    [ -L "$RUN_DIR/link" ] || bad "symlink did not travel"
    [ ! -e "$RUN_DIR/.git" ] || bad "sandbox .git crossed into the host project"
    [ -f "$SANDBOX_WORKDIR/.git/config" ] || bad "sandbox .git was removed instead of staying in the sandbox"
    patch_file=$(find "$(session_dir maki-myproject)" -maxdepth 1 -name 'patch-*.patch' -type f 2>/dev/null | head -n 1)
    [ -n "$patch_file" ] || bad "no patch was written"
    if [ -n "$patch_file" ]; then
        grep -Fq 'GIT binary patch' "$patch_file" || bad "patch has no binary hunk"
        grep -Fq 'new mode 100755' "$patch_file" || bad "patch has no mode change"
        grep -Fq 'rename to renamed-new.txt' "$patch_file" || bad "patch has no rename"
        if grep -Eq '^diff --git a/\.git/|^diff --git b/\.git/|^diff --git a/\.git$' "$patch_file"; then
            bad "patch contains a .git path"
        fi
    fi
}

test_large_patch_uses_a_file() {
    begin "a large patch is written to a file, never carried through a shell value"
    new_case large-patch
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    awk 'BEGIN { for (i = 0; i < 200000; i++) printf "a" }' >"$RUN_DIR/large.txt"
    printf '\n' >>"$RUN_DIR/large.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    STUB_MAKI_SCRIPT='awk "BEGIN { for (i = 0; i < 200000; i++) printf \"b\" }" > large.txt'

    run_maki maki
    assert_rc 0
    patch_file=$(find "$(session_dir maki-myproject)" -maxdepth 1 -name 'patch-*.patch' -type f 2>/dev/null | head -n 1)
    [ -n "$patch_file" ] || bad "large patch file was not written"
    if [ -n "$patch_file" ]; then
        patch_size=$(wc -c <"$patch_file" | tr -d ' ')
        [ "$patch_size" -gt 100000 ] || bad "patch file is unexpectedly small"
    fi
    if grep -Fq 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' "$LOG" "$ERR" "$OUT" 2>/dev/null; then
        bad "patch content leaked into a helper stream"
    fi
}

test_git_clean_fast_forward() {
    begin "clean git baseline applies in a worktree and fast-forwards, then cleans up"
    new_case git-ff
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub
    run_maki upload .
    reset_log
    commit_before=$(git -C "$RUN_DIR" rev-parse HEAD)
    # A stale worktree entry must be pruned before the new worktree is added.
    git -C "$RUN_DIR" worktree add "$CASE/stale-worktree" HEAD >/dev/null 2>&1
    rm -rf "$CASE/stale-worktree"
    GIT_TRACE_LOG=$CASE/git.trace
    STUB_MAKI_SCRIPT='printf "agent\n" > agent.txt; printf "modified\n" > tracked.txt'

    run_maki maki
    assert_rc 0
    git_trace_has "worktree prune"
    assert_trace_before "worktree prune" "worktree add"
    assert_trace_before "worktree add" "apply --check"
    assert_trace_before "apply --check" "maki-oss: apply sandbox changes"
    assert_trace_before "maki-oss: apply sandbox changes" "merge --ff-only"
    assert_trace_before "merge --ff-only" "worktree remove"
    assert_trace_before "worktree remove" "branch -d"
    git_trace_has "maki-oss/maki-repo-"
    git_trace_has "worktrees/"
    [ "$(cat "$RUN_DIR/tracked.txt")" = modified ] || bad "agent change is not on the host"
    [ "$(cat "$RUN_DIR/agent.txt" 2>/dev/null)" = agent ] || bad "agent file is not on the host"
    [ -z "$(git -C "$RUN_DIR" status --porcelain)" ] || bad "fast-forward left the host dirty"
    [ "$(git -C "$RUN_DIR" rev-parse HEAD^)" = "$commit_before" ] || bad "result commit parent is not the baseline"
    [ "$(git -C "$RUN_DIR" log -1 --format=%s)" = "maki-oss: apply sandbox changes" ] \
        || bad "result commit has the wrong subject"
    [ -z "$(git -C "$RUN_DIR" branch --list 'maki-oss/*')" ] || bad "temporary branch was not deleted"
    worktrees=$(git -C "$RUN_DIR" worktree list | wc -l | tr -d ' ')
    [ "$worktrees" = 1 ] || bad "a worktree entry remains after fast-forward"
    [ ! -f "$(session_dir maki-repo)/pending" ] || bad "a successful fast-forward left a pending marker"
    patch_file=$(find "$(session_dir maki-repo)" -maxdepth 1 -name 'patch-*.patch' -type f 2>/dev/null | head -n 1)
    [ -n "$patch_file" ] || bad "the applied patch was not retained"

    # A later session starts from the advanced baseline and replays nothing.
    reset_log
    GIT_TRACE_LOG=$CASE/git2.trace
    STUB_MAKI_SCRIPT=
    run_maki maki
    assert_rc 0
    assert_err_missing "is stale"
    assert_err_has "No sandbox changes to sync."
    git_trace_missing "worktree add"
    git_trace_missing "git apply"
}

test_git_crlf_attributes() {
    begin "line-ending attributes either apply cleanly or fail safely"
    new_case git-crlf
    RUN_DIR=$CASE/project/repo
    mkdir -p "$RUN_DIR"
    (
        cd "$RUN_DIR" || exit 1
        git init -q
        git config user.name "Test User"
        git config user.email test@example.com
        printf '*.txt text eol=crlf\n' >.gitattributes
        printf 'one\r\ntwo\r\n' >crlf.txt
        git add .gitattributes crlf.txt
        git commit -q -m initial
    )
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub
    run_maki upload .
    reset_log
    GIT_TRACE_LOG=$CASE/git.trace
    STUB_MAKI_SCRIPT='printf "three\r\n" >> crlf.txt'

    run_maki maki
    assert_rc 0
    if grep -Fq 'three' "$RUN_DIR/crlf.txt"; then
        [ "$(git -C "$RUN_DIR" log -1 --format=%s)" = "maki-oss: apply sandbox changes" ] \
            || bad "CRLF patch applied without a result commit"
    else
        patch_file=$(find "$(session_dir maki-repo)" -maxdepth 1 -name 'patch-*.patch' -type f 2>/dev/null | head -n 1)
        [ -n "$patch_file" ] || bad "safe CRLF conflict did not retain the patch"
        git_trace_missing "merge --ff-only"
    fi
}

test_git_host_moved_or_dirty() {
    begin "a moved or dirty host keeps the result branch and never merges"
    for moved_case in commit branch dirty; do
        new_case "moved-$moved_case"
        RUN_DIR=$CASE/project/repo
        seed_git_project "$RUN_DIR"
        seed_sandbox maki-repo Ready
        seed_remembered_provider maki-stub
        attach_stub_provider maki-repo maki-stub
        run_maki upload .
        reset_log
        GIT_TRACE_LOG=$CASE/git.trace
        case $moved_case in
            commit)
                STUB_MAKI_SCRIPT='printf "agent\n" > agent.txt
printf "host\n" > "'"$RUN_DIR"'/host.txt"
git -C "'"$RUN_DIR"'" add host.txt
git -C "'"$RUN_DIR"'" commit -q -m host-move'
                ;;
            branch)
                STUB_MAKI_SCRIPT='printf "agent\n" > agent.txt
git -C "'"$RUN_DIR"'" checkout -q -b other-branch'
                ;;
            dirty)
                STUB_MAKI_SCRIPT='printf "agent\n" > agent.txt
printf "dirty\n" >> "'"$RUN_DIR"'/tracked.txt"'
                ;;
        esac
        run_maki maki
        assert_rc 0
        assert_err_has "not fast-forwarded"
        assert_err_has "branch:"
        assert_err_has "worktree:"
        assert_err_has "patch:"
        git_trace_missing "merge --ff-only"
        [ -n "$(git -C "$RUN_DIR" branch --list 'maki-oss/*')" ] || bad "$moved_case: result branch was not kept"
        worktree_count=$(git -C "$RUN_DIR" worktree list | wc -l | tr -d ' ')
        [ "$worktree_count" -ge 2 ] || bad "$moved_case: review worktree was not kept"
        [ ! -e "$RUN_DIR/agent.txt" ] || bad "$moved_case: the result was applied without consent"
    done
}

test_git_dirty_baseline_cherry_pick() {
    begin "dirty baseline commits the result on a synthetic parent and never fast-forwards"
    new_case git-dirty
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    printf 'local edit\n' >>"$RUN_DIR/tracked.txt"
    printf 'untracked\n' >"$RUN_DIR/untracked.txt"
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub
    commit_before=$(git -C "$RUN_DIR" rev-parse HEAD)
    GIT_TRACE_LOG=$CASE/git.trace
    STUB_MAKI_SCRIPT='printf "agent edited\n" > tracked.txt
printf "agent untracked\n" > untracked.txt
printf "agent new\n" > new.txt'

    run_maki maki
    assert_rc 0
    assert_err_has "Uncommitted host work was not committed"
    assert_err_has "git cherry-pick"
    git_trace_has "worktree add"
    git_trace_missing "merge --ff-only"
    branch_name=$(git -C "$RUN_DIR" for-each-ref --format='%(refname:short)' 'refs/heads/maki-oss/*' | head -n 1)
    [ -n "$branch_name" ] || bad "result branch was not kept"
    if [ -n "$branch_name" ]; then
        result=$(git -C "$RUN_DIR" rev-parse "$branch_name")
        synthetic=$(git -C "$RUN_DIR" rev-parse "$result^")
        [ "$(git -C "$RUN_DIR" rev-parse "$synthetic^")" = "$commit_before" ] \
            || bad "synthetic base is not a child of HEAD"
        synthetic_subject=$(git -C "$RUN_DIR" log -1 --format=%s "$synthetic")
        case $synthetic_subject in
            "maki-oss baseline"*) ;;
            *) bad "synthetic base has the wrong subject: $synthetic_subject" ;;
        esac
        assert_err_has "git cherry-pick $result"
    fi
    grep -Fq 'local edit' "$RUN_DIR/tracked.txt" || bad "local edit was lost"
    grep -Fq 'agent edited' "$RUN_DIR/tracked.txt" && bad "agent change was applied to the dirty host"
    grep -Fq 'untracked' "$RUN_DIR/untracked.txt" || bad "untracked host file was lost"
    [ -f "$(session_dir maki-repo)/pending" ] || bad "cherry-pick case did not write a pending marker"
}

test_git_worktree_conflict_keeps_host() {
    begin "a worktree conflict keeps the review surface and leaves the host unchanged"
    new_case git-conflict
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub
    run_maki upload .
    reset_log
    real_git=$(command -v git)
    mkdir -p "$CASE/fake-git"
    cat >"$CASE/fake-git/git" <<EOF
#!/bin/sh
case " \$* " in
    *" apply --check "*) exit 1 ;;
    *" apply --3way "*) exit 1 ;;
esac
exec "$real_git" "\$@"
EOF
    chmod +x "$CASE/fake-git/git"
    PATH_OVERRIDE="$CASE/fake-git:$STUB_DIR:$PATH"
    STUB_MAKI_SCRIPT='printf "agent\n" > tracked.txt'

    run_maki maki
    assert_rc 0
    assert_err_has "conflicts with the host"
    assert_err_has "worktree:"
    assert_err_has "patch:"
    [ "$(cat "$RUN_DIR/tracked.txt")" = base ] || bad "conflict changed the host file"
    [ -n "$(git -C "$RUN_DIR" branch --list 'maki-oss/*')" ] || bad "review branch was not kept"
    worktree_count=$(git -C "$RUN_DIR" worktree list | wc -l | tr -d ' ')
    [ "$worktree_count" -ge 2 ] || bad "review worktree was not kept"
    [ -f "$(session_dir maki-repo)/pending" ] || bad "conflict did not write a pending marker"
}

test_no_git_ignore_uses_patch_check() {
    begin "--no-git-ignore disables the worktree and uses the project patch check"
    new_case no-git-ignore
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    seed_remembered_provider maki-stub
    GIT_TRACE_LOG=$CASE/git.trace
    STUB_MAKI_SCRIPT='printf "agent\n" > tracked.txt'

    run_maki --no-git-ignore maki
    assert_rc 0
    assert_err_has "Automatic worktree apply is off for --no-git-ignore"
    git_trace_missing "worktree add"
    git_trace_has "apply --check"
    assert_trace_check_before_apply
    [ "$(cat "$RUN_DIR/tracked.txt")" = agent ] || bad "the patch was not applied in the project"
    [ "$(git -C "$RUN_DIR" status --porcelain tracked.txt)" = " M tracked.txt" ] \
        || bad "the host file was not left modified for review"
}

test_no_git_text_apply() {
    begin "without git, a text patch applies with patch and preserves unrelated files"
    new_case no-git-text
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'v1\n' >"$RUN_DIR/file.txt"
    printf 'keep\n' >"$RUN_DIR/unrelated.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    PATH_OVERRIDE=$(no_git_path with_patch)
    STUB_MAKI_SCRIPT='printf "v2\n" > file.txt'

    run_maki maki
    assert_rc 0
    [ "$(cat "$RUN_DIR/file.txt")" = v2 ] || bad "text patch did not apply without git"
    [ "$(cat "$RUN_DIR/unrelated.txt")" = keep ] || bad "unrelated file was touched"
    assert_err_has "Applied sandbox changes"
}

test_no_git_text_conflict_keeps_project() {
    begin "without git, a conflicting text patch leaves every file unchanged"
    new_case no-git-conflict
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    PATH_OVERRIDE=$(no_git_path with_patch)
    STUB_MAKI_SCRIPT='printf "agent\n" > file.txt
printf "host\n" > "'"$RUN_DIR"'/file.txt"'

    run_maki maki
    assert_rc 0
    [ "$(cat "$RUN_DIR/file.txt")" = host ] || bad "conflict changed the host file"
    assert_err_has "does not apply cleanly"
    [ -f "$(session_dir maki-myproject)/pending" ] || bad "conflict did not write a pending marker"
}

test_no_git_binary_export() {
    begin "without git, binary changes export only affected files for review"
    new_case no-git-binary
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'keep\n' >"$RUN_DIR/unrelated.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    PATH_OVERRIDE=$(no_git_path with_patch)
    STUB_MAKI_SCRIPT='printf "\000\001binary" > binary.bin
printf "text\n" > note.txt'

    run_maki maki
    assert_rc 0
    assert_err_has "exported for review"
    review_dir=$(find "$(session_dir maki-myproject)" -maxdepth 1 -name 'review-*' -type d 2>/dev/null | head -n 1)
    [ -n "$review_dir" ] || bad "review directory was not created"
    [ ! -e "$RUN_DIR/binary.bin" ] || bad "binary file was written into the project"
    [ "$(cat "$RUN_DIR/unrelated.txt")" = keep ] || bad "unrelated host file changed"
    if [ -n "$review_dir" ]; then
        [ -f "$review_dir/files/binary.bin" ] || bad "binary file was not exported"
        grep -Fq 'binary.bin' "$review_dir/manifest" || bad "manifest does not name the binary file"
    fi
    [ -f "$(session_dir maki-myproject)/pending" ] || bad "binary export did not write a pending marker"
}

test_no_git_no_patch_fails_closed() {
    begin "without git or patch, a text change fails closed and writes nothing"
    new_case no-git-no-patch
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'v1\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    PATH_OVERRIDE=$(no_git_path)
    STUB_MAKI_SCRIPT='printf "v2\n" > file.txt'

    run_maki maki
    assert_rc 0
    assert_err_has "neither git nor patch"
    assert_err_has "sandbox:   maki-myproject"
    assert_err_has "workspace: $SANDBOX_WORKDIR"
    assert_err_has "openshell sandbox connect maki-myproject"
    assert_err_has "maki-oss download"
    [ "$(cat "$RUN_DIR/file.txt")" = v1 ] || bad "the project was written despite failing closed"
    assert_log_missing "download"
    [ -f "$(session_dir maki-myproject)/pending" ] || bad "failure did not write a pending marker"
}

test_pending_marker_blocks_second_session() {
    begin "a pending patch blocks automatic apply in a later session"
    new_case pending-block
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    STUB_MAKI_SCRIPT='printf "agent\n" > file.txt'
    # Force the first apply to fail closed by removing the apply tool and git.
    PATH_OVERRIDE=$(no_git_path)
    run_maki maki
    assert_rc 0
    [ -f "$(session_dir maki-myproject)/pending" ] || bad "first session did not leave a pending patch"
    first_patch=$(baseline_value_pending patch)
    [ -n "$first_patch" ] || bad "pending marker has no patch path"

    reset_log
    PATH_OVERRIDE=
    GIT_TRACE_LOG=$CASE/git.trace
    STUB_MAKI_SCRIPT='printf "agent2\n" > second.txt'
    run_maki maki
    assert_rc 0
    assert_err_has "Pending sandbox changes from an earlier session"
    assert_err_has "$first_patch"
    assert_err_has "Automatic apply is off"
    assert_log_missing "upload"
    git_trace_missing "worktree add"
    git_trace_missing "git apply"
    [ ! -e "$RUN_DIR/second.txt" ] || bad "a new patch was applied despite the pending marker"
    [ "$(cat "$RUN_DIR/file.txt")" = base ] || bad "the host project was modified"
}

baseline_value_pending() { # KEY
    sed -n "s/^$1=//p" "$(session_dir maki-myproject)/pending" 2>/dev/null | head -n 1
}

test_run_stdout_is_maki_only() {
    begin "run stdout is exactly Maki's output and sync failures keep its code"
    new_case run-stdout
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    EXEC_STDOUT='{"result":"exact"}'
    STUB_MAKI_SCRIPT='printf "agent\n" > file.txt'

    run_maki run "hi"
    assert_rc 0
    [ "$(cat "$OUT")" = '{"result":"exact"}' ] || bad "stdout contains helper output"
}


# ---------------------------------------------------------------------------

run_test test_help
run_test test_usage_errors
run_test test_config_precedence
run_test test_config_unknown_key
run_test test_up_creates
run_test test_up_idempotent
run_test test_run_passthrough
run_test test_maki_attach
run_test test_upload_no_mount
run_test test_download
run_test test_env_refusal
run_test test_env_refusal_session_path
run_test test_env_allow_override
run_test test_env_lookalike
run_test test_env_from_refusal
run_test test_env_from_laundered_source
run_test test_env_from_benign
run_test test_env_from_allow_override
run_test test_rm_confirmation
run_test test_doctor_missing_cli
run_test test_doctor_gateway_down
run_test test_doctor_all_pass
run_test test_mcp_status_all_gates_satisfied
run_test test_mcp_status_failing_gate_names_fix
run_test test_mcp_status_host_only_server
run_test test_mcp_status_zero_mcp_base
run_test test_mcp_status_stdio_all_gates_satisfied
run_test test_mcp_status_stdio_missing_runtime_names_build_fix
run_test test_mcp_status_no_sandbox
run_test test_mcp_status_none_configured
run_test test_doctor_mcp_section_informational
run_test test_doctor_mcp_none_configured
run_test test_image_build_argv
run_test test_asset_environment_split
run_test test_status_list_logs
run_test test_start_stop
run_test test_policy_wrappers
run_test test_provider_wrappers
run_test test_provider_inline_secret_rejected
run_test test_provider_setup_curated
run_test test_provider_memory
run_test test_provider_setup_catalog_alias
run_test test_provider_setup_scanner_and_picker
run_test test_provider_setup_oauth_refused
run_test test_provider_setup_oauth_interactive
run_test test_provider_setup_non_tty_refusal
run_test test_provider_setup_update
run_test test_provider_setup_attach
run_test test_provider_setup_file_source
run_test test_provider_setup_env_source
run_test test_provider_setup_hidden_prompt
run_test test_provider_setup_custom_generation
run_test test_provider_setup_custom_preserved
run_test test_provider_setup_lint_failure
run_test test_provider_setup_credential_non_exposure
run_test test_provider_setup_usage_errors
run_test test_provider_setup_sigint
run_test test_provider_setup_custom_validation
run_test test_provider_setup_no_jq
run_test test_run_model_flag
run_test test_run_timeout_flag
run_test test_maki_resume
run_test test_run_resume_flags
run_test test_session_flag_conflicts
run_test test_tui_config_key
run_test test_tui_resume_flags_refused
run_test test_opencode_tui_session
run_test test_doctor_tui_checks
run_test test_session_creates_uploads_and_syncs
run_test test_session_reuses_without_upload
run_test test_session_reuse_announces_overwrite
run_test test_session_create_race_reuses
run_test test_session_starts_stopped_sandbox
run_test test_session_attaches_missing_provider
run_test test_session_inline_bootstrap
run_test test_session_no_provider_non_tty
run_test test_session_unknown_gateway_provider
run_test test_run_bootstraps_from_scratch
run_test test_session_model_precedence
run_test test_session_no_sync
run_test test_session_sync_failure_preserves_code
run_test test_session_plain_apply
run_test test_session_plain_conflict_keeps_project
run_test test_baseline_capture_clean_git
run_test test_baseline_capture_dirty_git
run_test test_sandbox_baseline_after_upload
run_test test_existing_sandbox_baseline_migration
run_test test_stale_sandbox_keeps_patch
run_test test_session_state_permissions_and_second_session
run_test test_interrupt_still_collects_patch
run_test test_patch_content_and_git_isolation
run_test test_large_patch_uses_a_file
run_test test_git_clean_fast_forward
run_test test_git_crlf_attributes
run_test test_git_host_moved_or_dirty
run_test test_git_dirty_baseline_cherry_pick
run_test test_git_worktree_conflict_keeps_host
run_test test_no_git_ignore_uses_patch_check
run_test test_no_git_text_apply
run_test test_no_git_text_conflict_keeps_project
run_test test_no_git_binary_export
run_test test_no_git_no_patch_fails_closed
run_test test_pending_marker_blocks_second_session
run_test test_run_stdout_is_maki_only
run_test test_policy_advisor_enabled_on_session
run_test test_policy_advisor_enabled_on_fresh_create
run_test test_policy_advisor_failure_is_soft
run_test test_policy_advisor_not_set_by_up
run_test test_exit_surfaces_pending_proposals
run_test test_exit_silent_when_no_proposals
run_test test_exit_surfaces_proposals_on_interrupt
run_test test_exit_rule_failure_keeps_exit_code
run_test test_policy_review_empty
run_test test_policy_review_lists_chunks
run_test test_policy_approve_non_tty_requires_yes
run_test test_policy_approve_with_yes_targets_one_chunk
run_test test_policy_reject_requires_reason
run_test test_policy_reject_passes_reason
run_test test_no_jq_fallback
run_test test_no_jq_attached_providers
run_test test_missing_policy_dependency
run_test test_fish_plugin
run_test test_fish_fisher_layout
run_test test_fish_completions
run_test test_example_config
run_test test_idle_stop_setting
run_test test_idle_stop_after_idle
run_test test_idle_stop_after_sighup
run_test test_idle_stop_newer_session_cancels
run_test test_idle_stop_busy_sandbox
run_test test_idle_stop_failure_is_silent
run_test test_no_placeholder_spelling

printf '\n%d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -ne 0 ]; then
    exit 1
fi
