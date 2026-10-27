#!/bin/sh
# Stub-backed test suite for bin/maki-oss, bin/opencode-oss, bin/claude-oss,
# bin/codex-oss, the fish plugin, and the safety rules in specs/helper-cli,
# specs/opencode-oss-helper, specs/claude-oss-helper, specs/codex-oss-helper,
# and specs/fish-integration.
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
# State lives under each case's $HOME/.local/state, never the caller's.
unset XDG_STATE_HOME

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

# RUN_ONLY=<glob> runs only the test functions whose name matches it.
run_test() {
    # shellcheck disable=SC2254  # RUN_ONLY is a glob on purpose
    case $1 in
        ${RUN_ONLY:-*}) ;;
        *) return 0 ;;
    esac
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
    # Existing cases keep the pre-hash names (maki-<dir>, oc-<dir>) through an
    # explicit template; the naming cases clear these to test the defaults.
    NAME_PIN='maki-{project}'
    OC_NAME_PIN='oc-{project}'
    ENV_TIMEOUT=
    unset ENV_IDLE_STOP
    # Caller-owned workspace cases set these; unset ENV_WORKDIR keeps the
    # case's sandbox/project, an empty one passes no workdir.
    ENV_WORKSPACE=
    unset ENV_WORKDIR
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
    ATTACH_FAIL=
    IMAGE_INSPECT=
    BUILD_MODE=
    BUILD_PID_FILE=
    BUILD_SIGNAL_LOG=
    ENGINE_EXIT=
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
        STUB_ATTACH_FAIL="${ATTACH_FAIL:-0}" \
        STUB_IMAGE_INSPECT="${IMAGE_INSPECT:-}" \
        STUB_BUILD_MODE="${BUILD_MODE:-}" \
        STUB_BUILD_PID_FILE="${BUILD_PID_FILE:-}" \
        STUB_BUILD_SIGNAL_LOG="${BUILD_SIGNAL_LOG:-}" \
        MAKI_OSS_SANDBOX_NAME="${ENV_NAME:-$NAME_PIN}" \
        MAKI_OSS_TUI="${ENV_TUI:-}" \
        MAKI_OSS_TIMEOUT="${ENV_TIMEOUT:-}" \
        MAKI_OSS_IDLE_STOP="${ENV_IDLE_STOP-0}" \
        MAKI_OSS_RUN_TAG="${ENV_RUN_TAG:-}" \
        MAKI_OSS_WORKDIR="${ENV_WORKDIR-$CASE/sandbox/project}" \
        MAKI_OSS_WORKSPACE="${ENV_WORKSPACE:-}" \
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
        unset MAKI_OSS_BIN OPENCODE_OSS_BIN
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
    mkdir -p "$STUB_STATE_DIR/sandboxes" "$STUB_STATE_DIR/providers" "$STUB_STATE_DIR/ids"
    printf '%s\n' "${2:-Ready}" >"$STUB_STATE_DIR/sandboxes/$1"
    printf 'id-%s\n' "$1" >"$STUB_STATE_DIR/ids/$1"
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
    for no_jq_tool in awk basename cat cksum cut date dirname grep head mkdir mktemp mv paste printenv rm sed tr; do
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
    for no_tui_tool in awk basename cat cksum cut date dirname grep head mkdir mktemp mv paste printenv rm sed sleep tr; do
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
    for no_git_tool in awk basename cat chmod cksum cp cut date dirname grep head mkdir mktemp mv paste printenv rm sed sh sleep tr; do
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

sandbox_name_from_log() {
    awk 'previous == "--name" { print; exit } { previous = $0 }' "$LOG"
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
    printf '%s/.local/state/osa/sessions/%s' "$HOME" "$1"
}

baseline_value() { # SANDBOX KEY
    sed -n "s/^$2=//p" "$(session_dir "$1")/baseline" 2>/dev/null | head -n 1
}

pending_value() { # SANDBOX KEY
    flat_get "$(session_dir "$1")/pending" "$2"
}

synced_value() { # SANDBOX KEY
    sed -n "s/^$2=//p" "$(session_dir "$1")/synced" 2>/dev/null | head -n 1
}

# The shared osa state root and its published contract files (flat TOML).
state_root() { printf '%s/.local/state/osa' "$HOME"; }

registry_entry() { # SANDBOX
    printf '%s/projects/%s.toml' "$(state_root)" "$1"
}

# Reads one `key = "value"` line of a flat TOML file as data, undoing the
# \" and \\ escapes. Prints nothing when the file or key is absent.
flat_get() { # FILE KEY
    [ -f "$1" ] || return 0
    awk -v k="$2" '
        {
            eq = index($0, "=")
            if (eq == 0) next
            key = substr($0, 1, eq - 1)
            gsub(/^[ \t]+|[ \t]+$/, "", key)
            if (key != k) next
            v = substr($0, eq + 1)
            sub(/^[ \t]+/, "", v)
            sub(/^"/, "", v)
            sub(/"[ \t]*$/, "", v)
            out = ""
            for (i = 1; i <= length(v); i++) {
                c = substr(v, i, 1)
                if (c == "\\") { i++; c = substr(v, i, 1) }
                out = out c
            }
            print out
            exit
        }' "$1"
}

registry_value() { # SANDBOX KEY
    flat_get "$(registry_entry "$1")" "$2"
}

# A project folder whose path needs quoting in every format.
odd_project_dir() { printf '%s/project/my "app" dir' "$CASE"; }

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
    NAME_PIN=
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

test_sandbox_name_fit() {
    begin "sandbox names are sanitized and fit OpenShell's 19-character limit"
    new_case name-fit
    RUN_DIR=$CASE/project/My_App.Test
    mkdir -p "$RUN_DIR"
    run_maki up
    assert_rc 0
    [ "$(sandbox_name_from_log)" = "maki-my-app-test" ] \
        || bad "the project name was not sanitized: $(sandbox_name_from_log)"

    reset_state
    reset_log
    RUN_DIR=$CASE/project/this-project-name-is-way-too-long
    mkdir -p "$RUN_DIR"
    run_maki up
    assert_rc 0
    long_name=$(sandbox_name_from_log)
    [ -n "$long_name" ] || bad "the long project did not create a sandbox"
    [ "${#long_name}" -le 19 ] \
        || bad "sandbox name is ${#long_name} characters: $long_name"
    case $long_name in
        *[!a-z0-9-]*|'') bad "invalid sandbox name: $long_name" ;;
    esac

    # The same project resolves to the same fitted name on later commands.
    run_maki status
    assert_rc 0
    assert_out_has "Sandbox:   $long_name"

    # Names that share their readable prefix must not share a sandbox.
    reset_state
    reset_log
    RUN_DIR=$CASE/project/this-project-name-is-way-too-long-other
    mkdir -p "$RUN_DIR"
    run_maki up
    assert_rc 0
    other_name=$(sandbox_name_from_log)
    [ "$other_name" != "$long_name" ] \
        || bad "two long project names shared the sandbox name: $other_name"
}

test_sandbox_name_validation() {
    begin "invalid explicit sandbox names fail before contacting the gateway"
    new_case name-validation
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"

    for bad_name in "My_Project" "abcdefghijklmnopqrst" "-leading" "trailing-" "a.b"; do
        reset_log
        run_maki up --name "$bad_name"
        assert_rc 1
        if [ -s "$LOG" ]; then
            bad "gateway was contacted for the invalid name '$bad_name'"
        fi
        assert_err_has "sandbox name"
    done

    reset_log
    run_maki up --name "My_Project"
    assert_rc 1
    assert_err_has "lowercase"

    reset_log
    run_maki up --name "abcdefghijklmnopqrst"
    assert_rc 1
    assert_err_has "19"

    reset_log
    run_maki up --name "{project}-abcdefghijklm"
    assert_rc 1
    assert_err_has "leaves only"
    if [ -s "$LOG" ]; then
        bad "gateway was contacted for a pattern with no room for {project}"
    fi
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
    assert_log_missing "upload"
    assert_log_line_missing "maki"
    assert_out_has "the session refreshes the workspace"
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
    assert_log_missing "upload"
    assert_log_line_missing "maki"

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

test_image_build_ignores_configured_image() {
    begin "image build tags the base, not the configured environment image"
    new_case image-build-env
    mkdir -p "$XDG_CONFIG_HOME/maki-oss"
    printf 'image = "maki-agent:personal"\n' >"$XDG_CONFIG_HOME/maki-oss/config.toml"
    run_maki image build
    assert_rc 0
    assert_log_line "maki-agent:local"
    assert_log_line_missing "maki-agent:personal"
}

test_asset_environment_split() {
    begin "assets: base is zero-MCP with YOLO; reference store carries the environment"
    new_case assets-environment-split
    if grep -Eq 'BUN_VERSION|bun add|synthetic-search-mcp' \
        "$ROOT/examples/maki-image/Dockerfile"; then
        bad "base Dockerfile still installs Bun or synthetic-search-mcp"
    fi
    if grep -Eq '^\[mcp\.' "$ROOT/examples/maki-image/config/mcp.toml"; then
        bad "base mcp.toml declares an MCP server"
    fi
    grep -q 'always_yolo = true' "$ROOT/examples/maki-image/config/init.lua" \
        || bad "base init.lua does not start sessions in YOLO mode"
    grep -q 'BUN_VERSION' "$ROOT/examples/environments/reference/Dockerfile" \
        || bad "reference Dockerfile does not pin Bun"
    grep -q 'synthetic-search-mcp' "$ROOT/examples/environments/reference/Dockerfile" \
        || bad "reference Dockerfile does not install synthetic-search-mcp"
    grep -q '^\[mcp.context7\]' "$ROOT/examples/environments/reference/config/mcp.toml" \
        || bad "reference mcp.toml does not declare context7"
    grep -q '^\[mcp.synthetic\]' "$ROOT/examples/environments/reference/config/mcp.toml" \
        || bad "reference mcp.toml does not declare synthetic"
    grep -q 'always_yolo = true' "$ROOT/examples/environments/reference/config/init.lua" \
        || bad "reference init.lua does not keep the base YOLO and trust settings"
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
    assert_log_line_missing "maki"
    assert_log_missing "--tty"
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
    [ "$(pending_value maki-myproject kind)" = parked ] \
        || bad "--no-sync did not park the workspace"
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
    if [ ! -f "$HOME/.local/state/osa/sessions/maki-myproject/pending" ]; then
        bad "collection failure did not write the pending marker"
    fi
    [ "$(pending_value maki-myproject kind)" = parked ] \
        || bad "collection failure did not park the workspace"

    reset_log
    STUB_EXEC_SCRIPT_FAIL=
    EXEC_EXIT=0
    run_maki maki
    assert_rc 1
    assert_err_has "is parked"
    assert_log_line_missing "maki"
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
    patch_file=$(find "$HOME/.local/state/osa/sessions/maki-myproject" -maxdepth 1 -name 'patch-*.patch' -type f 2>/dev/null | head -n 1)
    if [ -z "$patch_file" ] || [ ! -s "$patch_file" ]; then
        bad "the conflicting patch was not retained"
    fi
    if [ ! -f "$HOME/.local/state/osa/sessions/maki-myproject/pending" ]; then
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

    # Hold the agent open until signaled, so the interrupt cannot race the
    # session and the exit hook runs while Maki is attached. The helper runs
    # in the foreground because background jobs ignore SIGINT.
    STUB_MAKI_SCRIPT='touch '"$CASE"'/maki-started
while [ ! -f '"$CASE"'/maki-stop ]; do sleep 0.1; done'
    (
        tries=0
        while [ ! -f "$CASE/maki-started" ] && [ "$tries" -lt 100 ]; do
            sleep 0.1
            tries=$((tries + 1))
        done
        pkill -INT -f "$MAKI maki" 2>/dev/null || true
        sleep 1
        touch "$CASE/maki-stop"
        sleep 5
        pkill -KILL -f "$MAKI maki" 2>/dev/null || true
    ) &
    RC=0
    (
        cd "$RUN_DIR"
        PATH="$STUB_DIR:$PATH" \
        HOME="$HOME" \
        XDG_CONFIG_HOME="$XDG_CONFIG_HOME" \
        STUB_LOG="$STUB_LOG" \
        STUB_STATE_DIR="$STUB_STATE_DIR" \
        STUB_RULE_PENDING="$RULE_PENDING" \
        STUB_EXEC_STDOUT='interrupted' \
        STUB_SANDBOX_ROOT="$CASE/sandbox" \
        STUB_SANDBOX_TOOLS="$CASE/sandbox-tools" \
        STUB_MAKI_SCRIPT="$STUB_MAKI_SCRIPT" \
        MAKI_OSS_WORKDIR="$SANDBOX_WORKDIR" \
            "$MAKI" maki >"$OUT" 2>"$ERR" </dev/null
    ) || RC=$?
    wait || true
    [ "$RC" -eq 130 ] || bad "interrupted session exited $RC instead of 130"
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
    if [ ! -L "$XDG_CONFIG_HOME/fish/functions/__oss_run.fish" ]; then
        bad "the shared resolver symlink was not created"
    fi

    run_maki fish install
    assert_rc 0
    assert_out_has "already installed"
    assert_out_has "Fish plugin already installed."

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
    if [ -e "$XDG_CONFIG_HOME/fish/functions/__oss_run.fish" ]; then
        bad "the shared resolver outlived the last front-end"
    fi
}

test_fish_install_both_front_ends() {
    begin "both front-ends install twice and share one resolver"
    new_case fish-both
    if ! command -v fish >/dev/null 2>&1; then
        skipped "fish is not installed"
        return 0
    fi
    fish_functions=$XDG_CONFIG_HOME/fish/functions

    run_maki fish install
    assert_rc 0
    run_oc fish install
    assert_rc 0
    assert_out_has "linked:"
    assert_out_has "already installed: $fish_functions/__oss_run.fish"
    for fish_front in maki-oss opencode-oss; do
        if [ ! -L "$fish_functions/$fish_front.fish" ] \
            || [ ! -L "$XDG_CONFIG_HOME/fish/completions/$fish_front.fish" ]; then
            bad "$fish_front was not linked"
        fi
    done
    run_oc fish install
    assert_rc 0
    assert_out_has "Fish plugin already installed."
    run_maki fish install
    assert_rc 0
    assert_out_has "Fish plugin already installed."
    fish_link_count=$(find "$XDG_CONFIG_HOME/fish" -type l | wc -l | tr -d ' ')
    [ "$fish_link_count" = 5 ] || bad "expected 5 links, found $fish_link_count"
    if find "$XDG_CONFIG_HOME/fish" -type l ! -exec test -e {} \; -print | grep -q .; then
        bad "a broken link was left behind"
    fi

    run_fish "maki-oss help; opencode-oss help"
    assert_rc 0
    assert_fish_out_has "maki-oss: run Maki"
    assert_fish_out_has "opencode-oss: run OpenCode"

    # The resolver stays while another front-end still uses it.
    run_maki fish uninstall
    assert_rc 0
    assert_out_has "kept (still used by another front-end)"
    [ -L "$fish_functions/__oss_run.fish" ] || bad "the shared resolver was removed too early"
    run_fish "opencode-oss help"
    assert_rc 0
    assert_fish_out_has "Usage:"
    run_oc fish uninstall
    assert_rc 0
    [ ! -e "$fish_functions/__oss_run.fish" ] || bad "the shared resolver was not removed"
    fish_link_count=$(find "$XDG_CONFIG_HOME/fish" -type l | wc -l | tr -d ' ')
    [ "$fish_link_count" = 0 ] || bad "uninstall left $fish_link_count links"
}

test_fish_uninstall_skips_foreign() {
    begin "fish uninstall leaves a foreign file at a managed path untouched"
    new_case fish-foreign
    fish_functions=$XDG_CONFIG_HOME/fish/functions
    mkdir -p "$fish_functions"
    printf 'mine\n' >"$fish_functions/maki-oss.fish"
    printf 'mine\n' >"$fish_functions/opencode-oss.fish"
    ln -s /nonexistent/elsewhere.fish "$fish_functions/__oss_run.fish"

    run_maki fish uninstall
    assert_rc 0
    assert_out_has "skipped (not a symlink from this repository): $fish_functions/maki-oss.fish"
    assert_out_has "skipped (not installed by maki-oss): $fish_functions/__oss_run.fish"
    run_oc fish uninstall
    assert_rc 0
    assert_out_has "skipped (not a symlink from this repository): $fish_functions/opencode-oss.fish"
    [ "$(cat "$fish_functions/maki-oss.fish")" = mine ] || bad "a foreign maki-oss.fish was changed"
    [ "$(cat "$fish_functions/opencode-oss.fish")" = mine ] || bad "a foreign opencode-oss.fish was changed"
    [ -L "$fish_functions/__oss_run.fish" ] || bad "a foreign link was removed"

    run_maki fish install
    assert_rc 1
    assert_err_has "file exists and was not installed by maki-oss"
}

test_fish_fisher_layout() {
    begin "fisher-style copy (not symlink) resolves via PATH"
    new_case fish-fisher
    if ! command -v fish >/dev/null 2>&1; then
        skipped "fish is not installed"
        return 0
    fi

    # fisher expands plugins into the fish config directory (copies, not
    # symlinks); the wrappers then find their helper on PATH.
    mkdir -p "$XDG_CONFIG_HOME/fish/functions" "$XDG_CONFIG_HOME/fish/completions"
    cp "$ROOT"/fish/functions/*.fish "$XDG_CONFIG_HOME/fish/functions/"
    cp "$ROOT"/fish/completions/*.fish "$XDG_CONFIG_HOME/fish/completions/"
    FISH_PATH="$STUB_DIR:$ROOT/bin:$PATH"

    run_fish "type -q maki-oss; and maki-oss help"
    assert_rc 0
    assert_fish_out_has "Usage:"
    run_fish "type -q opencode-oss; and opencode-oss help"
    assert_rc 0
    assert_fish_out_has "Usage:"
    for fish_file in "$XDG_CONFIG_HOME"/fish/functions/*.fish "$XDG_CONFIG_HOME"/fish/completions/*.fish; do
        run_fish "fish -n '$fish_file'"
        assert_rc 0
    done

    # An override that is not executable is an error, not a silent fallback.
    run_fish "MAKI_OSS_BIN=/nonexistent/maki-oss maki-oss help"
    assert_rc 127
    assert_fish_out_has "set MAKI_OSS_BIN"
    run_fish "OPENCODE_OSS_BIN=/nonexistent/opencode-oss opencode-oss help"
    assert_rc 127
    assert_fish_out_has "set OPENCODE_OSS_BIN"
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
    run_oc fish install
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

    # Every flag the helper accepts is completed in both front-ends.
    for fish_front in maki-oss opencode-oss; do
        for fish_verb in run upload; do
            run_fish "complete -C '$fish_front $fish_verb --'"
            assert_rc 0
            for fish_flag in --name --image --policy --provider --env --env-from \
                --allow-env --model --continue --resume --session-id --timeout \
                --no-sync --discard --no-git-ignore --idle-stop --yes --help; do
                if ! grep -Fq -- "$fish_flag" "$FISH_OUT"; then
                    bad "$fish_front $fish_verb -- does not complete $fish_flag"
                fi
            done
        done
    done
    run_fish "complete -C 'opencode-oss run --opencode-'"
    assert_rc 0
    assert_fish_out_has "--opencode-version"
    run_fish "complete -C 'maki-oss run --maki-'"
    assert_rc 0
    assert_fish_out_has "--maki-version"
}

# ---------------------------------------------------------------------------
# Session idle stop
# ---------------------------------------------------------------------------

idle_dir() {
    printf '%s' "$HOME/.local/state/osa/sessions/maki-myproject"
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

test_asset_agent_onboarding() {
    begin "assets: onboarding router covers all agents and config classes"
    new_case assets-onboarding
    guide=$ROOT/docs/ai/onboarding.md
    if [ ! -f "$guide" ]; then
        bad "missing docs/ai/onboarding.md"
        return
    fi
    grep -Fq 'same coding agent' "$guide" || bad "onboarding guide lacks the same-agent rule"
    grep -q '^## Copy this prompt' "$guide" || bad "onboarding guide lacks the copy-paste prompt"
    for agent in Maki OpenCode Claude; do
        grep -Fq "$agent" "$guide" || bad "onboarding guide does not name $agent"
    done
    for item in Credentials MCP Settings Skills Commands Plugins 'Project-local configuration'; do
        grep -Fq "| $item |" "$guide" || bad "onboarding matrix lacks the $item row"
    done
    for phase in P0 P1 P2 P3 P4 P5 P6 P7 P8; do
        grep -Fq "| $phase " "$guide" || bad "onboarding phase map lacks $phase"
    done
    grep -Fq 'docs/ai/onboarding.md' "$ROOT/AGENTS.md" \
        || bad "AGENTS.md does not link docs/ai/onboarding.md"
    grep -Fq 'docs/ai/onboarding.md' "$ROOT/README.md" \
        || bad "README.md does not link docs/ai/onboarding.md"
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
        "$ROOT/docs"/*.md "$ROOT/docs/ai"/*.md "$ROOT/docs/ai"/*/*.md \
        "$ROOT/examples"/*.toml \
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

test_filtered_baseline_is_not_stale_after_upload() {
    begin "a filtered host tree and its raw uploaded tree are not stale after upload"
    new_case filter-baseline
    RUN_DIR=$CASE/project/repo
    mkdir -p "$RUN_DIR"
    (
        cd "$RUN_DIR" || exit 1
        git init -q
        git config user.name "Test User"
        git config user.email test@example.com
        git config filter.pointer.clean "sed 's/^/pointer:/'"
        printf '*.dat filter=pointer\n' >.gitattributes
        printf 'payload\n' >data.dat
        git add .gitattributes data.dat
        git commit -q -m initial
    )
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub
    run_maki upload .
    assert_rc 0
    reset_log
    run_maki maki
    assert_rc 0
    assert_err_missing "is stale"
    assert_err_has "No sandbox changes to sync."
}

test_existing_sandbox_baseline_migration() {
    begin "a reused sandbox without a baseline adopts a matching workspace and warns once"
    new_case sandbox-migration
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub

    run_maki run "hi"
    assert_rc 0
    assert_err_has "Adopting the sandbox workspace as the baseline"
    assert_err_has "Workspace is already current"
    assert_log_missing "upload"
    init_count=$(grep -c 'git init -q' "$LOG" 2>/dev/null || true)
    [ "$init_count" = 1 ] || bad "expected exactly one baseline initialization, got ${init_count:-0}"
}

test_host_change_refreshes_before_session() {
    begin "a host change refreshes a reused workspace before Maki runs"
    new_case host-refresh
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub
    run_maki upload .
    printf 'host-change\n' >>"$RUN_DIR/tracked.txt"
    git -C "$RUN_DIR" add tracked.txt
    git -C "$RUN_DIR" commit -q -m "host change"
    reset_log
    STUB_MAKI_SCRIPT='printf "sandbox-change\n" >> tracked.txt'

    run_maki maki
    assert_rc 0
    assert_err_has "Refreshing the workspace from the host"
    assert_log_has "upload"
    grep -Fq 'host-change' "$RUN_DIR/tracked.txt" \
        || bad "the refreshed host change was lost"
    grep -Fq 'sandbox-change' "$RUN_DIR/tracked.txt" \
        || bad "the agent change did not apply after the refresh"
    [ ! -f "$(session_dir maki-repo)/pending" ] \
        || bad "a clean host left a pending marker"

    # The refresh recorded a new pair, so the next unchanged session skips
    # the upload.
    reset_log
    STUB_MAKI_SCRIPT=
    run_maki maki
    assert_rc 0
    assert_err_has "already current"
    assert_log_missing "upload"
    [ "$(synced_value maki-repo host_tree)" = "$(baseline_value maki-repo tree)" ] \
        || bad "the synced host tree does not match the recorded baseline"
    [ "$(synced_value maki-repo sandbox_tree)" = "$(baseline_value maki-repo sandbox_tree)" ] \
        || bad "the synced sandbox tree does not match the recorded baseline"
}

test_parked_workspace_refuses_session() {
    begin "a parked workspace refuses to launch Maki"
    new_case parked-session
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'host\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    # The sandbox has a file the host does not: no durable patch covers it.
    printf 'sandbox-only\n' >"$SANDBOX_WORKDIR/extra.txt"

    STUB_MAKI_SCRIPT='printf "ran\n" > ran.txt'
    run_maki maki
    assert_rc 1
    assert_err_has "is parked"
    assert_err_has "sandbox changes are not in the host project"
    assert_log_line_missing "maki"
    assert_log_missing "upload"
    [ "$(pending_value maki-myproject kind)" = parked ] \
        || bad "the parked workspace has no parked marker"
    [ ! -e "$RUN_DIR/ran.txt" ] || bad "Maki ran in a parked workspace"
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

test_parked_workspace_blocks_second_session() {
    begin "a parked workspace blocks a later session until it is discarded"
    new_case parked-block
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    STUB_MAKI_SCRIPT='printf "agent\n" > file.txt'
    run_maki maki --no-sync
    assert_rc 0
    [ "$(pending_value maki-myproject kind)" = parked ] \
        || bad "first session did not park the workspace"
    [ "$(cat "$RUN_DIR/file.txt")" = base ] \
        || bad "no-sync wrote the host project"
    [ -z "$(pending_value maki-myproject patch)" ] \
        || bad "no-sync wrote a patch path"

    reset_log
    STUB_MAKI_SCRIPT='printf "agent2\n" > second.txt'
    run_maki maki
    assert_rc 1
    assert_err_has "is parked"
    assert_err_has "sandbox changes are not in the host project"
    assert_log_missing "upload"
    assert_log_line_missing "maki"
    [ ! -e "$RUN_DIR/second.txt" ] || bad "a session ran in a parked workspace"
    [ "$(cat "$RUN_DIR/file.txt")" = base ] || bad "the host project was modified"
}

test_retained_patch_does_not_block_second_session() {
    begin "a retained patch does not block a later session"
    new_case retained-block
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    STUB_MAKI_SCRIPT='printf "agent\n" > file.txt'
    # No git and no patch on the host: the patch is collected but cannot apply.
    PATH_OVERRIDE=$(no_git_path)
    run_maki maki
    assert_rc 0
    [ "$(pending_value maki-myproject kind)" = retained ] \
        || bad "a collected patch was not retained"
    first_patch=$(pending_value maki-myproject patch)
    [ -n "$first_patch" ] && [ -f "$first_patch" ] \
        || bad "the retained patch file is missing"
    [ "$(pending_value maki-myproject sandbox_id)" = "$(cat "$STUB_STATE_DIR/ids/maki-myproject")" ] \
        || bad "the retained marker has no matching sandbox ID"
    [ -n "$(pending_value maki-myproject result_tree)" ] \
        || bad "the retained marker has no result tree"
    [ "$(pending_value maki-myproject version)" = 1 ] \
        || bad "the marker is not versioned flat TOML"
    [ "$(cat "$RUN_DIR/file.txt")" = base ] \
        || bad "the host was changed despite the retained patch"

    reset_log
    PATH_OVERRIDE=
    STUB_MAKI_SCRIPT='printf "second\n" > second.txt'
    run_maki maki
    assert_rc 0
    assert_err_has "Retained patch for review"
    assert_log_has "upload"
    assert_log_line_before "upload" "maki"
    [ "$(cat "$RUN_DIR/second.txt")" = second ] \
        || bad "the later session did not apply its own patch"
    [ "$(cat "$RUN_DIR/file.txt")" = base ] \
        || bad "the retained agent change was applied without review"
    [ -f "$first_patch" ] || bad "the retained patch file was deleted"
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

# ---------------------------------------------------------------------------
# opencode-oss: the OpenCode front-end over the same core and stubs
# (specs/opencode-oss-helper). The runner reuses run_maki_with_input with the
# binary swapped and the OPENCODE_OSS_* settings exported; the MAKI_OSS_*
# values that runner always passes must have no effect on opencode-oss.
# ---------------------------------------------------------------------------

OC=$ROOT/bin/opencode-oss

oc_case() { # NAME
    new_case "$1"
    ENV_OC_MODEL=
    ENV_OC_IMAGE=
    EXEC_STDIN_LOG=
    ENGINE_EXIT=
    OC_SEED_FILES=
}

run_oc_with_input() { # STDIN_FILE ARGS...
    oc_rc=0
    (
        MAKI=$OC
        OPENCODE_OSS_SANDBOX_NAME=${ENV_NAME:-$OC_NAME_PIN}
        OPENCODE_OSS_TIMEOUT=${ENV_TIMEOUT:-}
        OPENCODE_OSS_IDLE_STOP=${ENV_IDLE_STOP-0}
        OPENCODE_OSS_RUN_TAG=${ENV_RUN_TAG:-}
        OPENCODE_OSS_WORKDIR=$CASE/sandbox/project
        OPENCODE_OSS_IMAGE=${ENV_OC_IMAGE:-}
        OPENCODE_OSS_MODEL=${ENV_OC_MODEL:-}
        OPENCODE_OSS_INTERACTIVE=${INTERACTIVE:-}
        STUB_EXEC_STDIN_LOG=${EXEC_STDIN_LOG:-}
        STUB_ENGINE_EXIT=${ENGINE_EXIT:-0}
        export OPENCODE_OSS_SANDBOX_NAME OPENCODE_OSS_TIMEOUT OPENCODE_OSS_IDLE_STOP \
            OPENCODE_OSS_RUN_TAG OPENCODE_OSS_WORKDIR OPENCODE_OSS_IMAGE \
            OPENCODE_OSS_MODEL OPENCODE_OSS_INTERACTIVE STUB_EXEC_STDIN_LOG \
            STUB_ENGINE_EXIT
        run_maki_with_input "$@"
        exit "$RC"
    ) || oc_rc=$?
    RC=$oc_rc
}

run_oc() {
    run_oc_with_input /dev/null "$@"
}

run_oc_stdin() {
    oc_stdin_input=$1
    shift
    printf '%b\n' "$oc_stdin_input" >"$CASE/stdin.txt"
    INTERACTIVE=1
    run_oc_with_input "$CASE/stdin.txt" "$@"
}

oc_config() { # LINE
    mkdir -p "$XDG_CONFIG_HOME/opencode-oss"
    printf '%s\n' "$1" >>"$XDG_CONFIG_HOME/opencode-oss/config.toml"
}

seed_oc_provider() { # NAME
    oc_config "providers = \"$1\""
    mkdir -p "$STUB_STATE_DIR"
    printf '%s\n' "$1" >>"$STUB_STATE_DIR/providers.list"
}

oc_session_dir() { # SANDBOX
    printf '%s/.local/state/osa/sessions/%s' "$HOME" "$1"
}

# A project directory with its Ready sandbox and a remembered, attached
# provider: the state every session test starts from.
# Host files the test needs in the sandbox go in OC_SEED_FILES (NAME=CONTENT
# lines) so they exist before the sandbox mirrors the project.
oc_ready_project() { # [DIR-NAME]
    RUN_DIR=$CASE/project/${1:-myproject}
    mkdir -p "$RUN_DIR"
    while IFS= read -r oc_seed; do
        [ -n "$oc_seed" ] || continue
        printf '%s\n' "${oc_seed#*=}" >"$RUN_DIR/${oc_seed%%=*}"
    done <<OC_SEED
${OC_SEED_FILES:-}
OC_SEED
    seed_sandbox "oc-${1:-myproject}" Ready
    seed_oc_provider opencode-stub
    attach_stub_provider "oc-${1:-myproject}" opencode-stub
}

assert_stdin_closed() {
    if [ ! -f "$EXEC_STDIN_LOG" ]; then
        bad "the agent exec stdin was not recorded"
    elif [ -s "$EXEC_STDIN_LOG" ]; then
        bad "the agent exec read the helper's stdin: $(head -n 1 "$EXEC_STDIN_LOG")"
    fi
}

test_oc_help() {
    begin "opencode-oss help lists the shared commands and no Maki-only ones"
    oc_case oc-help
    run_oc help
    assert_rc 0
    for oc_cmd in doctor 'image build' 'init, up' opencode 'run "<prompt>"' upload download \
        status list logs 'start, stop' rm 'policy show|edit|apply' 'policy review' \
        'policy approve' 'policy reject' 'provider add|attach|list' 'provider setup' \
        'mcp status' 'fish install|uninstall' help; do
        if ! grep -Eq "^  $(printf '%s' "$oc_cmd" | sed 's/[|.]/\\&/g')( |$)" "$OUT"; then
            bad "help does not list: $oc_cmd"
        fi
    done
    if grep -Eq '^  maki( |$)' "$OUT"; then
        bad "help lists a Maki-only command"
    fi
    assert_out_has "OPENCODE_OSS_<KEY>"
    assert_out_has "opencode-oss/config.toml"

    run_oc maki
    assert_rc 1
    assert_err_has "unknown command: maki"
}

test_oc_run_argv() {
    begin "opencode-oss run launches opencode run --standalone --auto with stdin closed"
    oc_case oc-run
    oc_ready_project
    EXEC_STDOUT='{"type":"text","part":{"text":"OK"}}'
    EXEC_STDIN_LOG=$CASE/exec-stdin
    printf 'LEAKED-STDIN\n' >"$CASE/stdin.txt"

    run_oc_with_input "$CASE/stdin.txt" run "reply OK"
    assert_rc 0
    assert_out_has '{"type":"text","part":{"text":"OK"}}'
    assert_stdin_closed
    assert_log_line "opencode"
    assert_log_line "run"
    assert_log_line "--standalone"
    assert_log_line "--auto"
    assert_log_line "--format"
    assert_log_line "json"
    assert_log_line "reply OK"
    assert_log_before "--standalone" "reply OK"
    assert_log_line "OPENCODE_DISABLE_MODELS_FETCH=1"
    assert_log_missing "OPENCODE_CONFIG_CONTENT"
    assert_log_line_missing "--model"
    assert_log_line_missing "--print"

    # A resolved model goes in as --model, never as the overlay.
    reset_log
    ENV_OC_MODEL=synthetic/hf:zai-org/GLM-5.3
    run_oc run "reply OK"
    assert_rc 0
    assert_log_line "--model"
    assert_log_line "synthetic/hf:zai-org/GLM-5.3"
    assert_log_before "--model" "reply OK"
    assert_log_missing "OPENCODE_CONFIG_CONTENT"

    # OpenCode's exit code is the helper's.
    reset_log
    EXEC_EXIT=1
    EXEC_STDOUT='partial'
    run_oc run "fail please"
    assert_rc 1
    assert_out_has "partial"
}

test_oc_tui_argv() {
    begin "bare opencode-oss attaches opencode --standalone with the model overlay"
    oc_case oc-tui
    oc_ready_project
    oc_config 'model = "synthetic/hf:zai-org/GLM-5.3"'

    run_oc
    assert_rc 0
    assert_log_line "--tty"
    assert_log_line "opencode"
    assert_log_line "--standalone"
    assert_log_line_missing "--auto"
    assert_log_line_missing "run"
    assert_log_line_missing "--model"
    assert_log_line "OPENCODE_DISABLE_MODELS_FETCH=1"
    assert_log_line 'OPENCODE_CONFIG_CONTENT={"model":"synthetic/hf:zai-org/GLM-5.3"}'
    assert_log_before "OPENCODE_CONFIG_CONTENT" "--standalone"
    # Nothing is written into the project for the model.
    if [ -e "$SANDBOX_WORKDIR/opencode.json" ] || [ -e "$RUN_DIR/opencode.json" ]; then
        bad "the helper wrote an opencode.json into the project"
    fi
    # The session exit still collects a patch and checks for proposals.
    assert_log_has "refs/opencode-oss/base"
    assert_log_line_before "--standalone" "rule"

    # `opencode-oss opencode` is the same session; arguments are refused.
    reset_log
    run_oc opencode
    assert_rc 0
    assert_log_line "--tty"
    assert_log_line "--standalone"
    run_oc opencode extra
    assert_rc 1
    assert_err_has "opencode takes no arguments"

    # Without a model there is no overlay.
    : >"$XDG_CONFIG_HOME/opencode-oss/config.toml"
    seed_oc_provider opencode-stub
    reset_log
    run_oc
    assert_rc 0
    assert_log_missing "OPENCODE_CONFIG_CONTENT"
    assert_log_line "OPENCODE_DISABLE_MODELS_FETCH=1"
}

test_oc_session_mapping() {
    begin "opencode-oss maps --resume and --session-id to --session"
    oc_case oc-session-map
    oc_ready_project

    run_oc run --resume ses_123 "next"
    assert_rc 0
    assert_log_line "--session"
    assert_log_line "ses_123"
    assert_log_line_missing "--resume"
    assert_log_before "--session" "next"

    reset_log
    run_oc run --session-id ses_new "start"
    assert_rc 0
    assert_log_line "--session"
    assert_log_line "ses_new"
    assert_log_line_missing "--session-id"

    reset_log
    run_oc run --continue "and now"
    assert_rc 0
    assert_log_line "--continue"
    assert_log_line_missing "--session"

    reset_log
    run_oc -r ses_tui
    assert_rc 0
    assert_log_line "--tty"
    assert_log_line "--session"
    assert_log_line "ses_tui"
    assert_log_line_missing "--resume"
}

test_oc_session_conflicts() {
    begin "conflicting opencode-oss session flags fail before any sandbox work"
    oc_case oc-session-conflicts
    oc_ready_project
    for oc_flags in "--continue --resume ses_123" "--continue --session-id ses_123" \
        "--resume ses_1 --session-id ses_2"; do
        reset_log
        # shellcheck disable=SC2086  # the flag list splits on purpose
        run_oc run $oc_flags "x"
        assert_rc 1
        if [ -s "$LOG" ]; then
            bad "gateway was contacted for '$oc_flags': $(head -n 3 "$LOG" | tr '\n' ' ')"
        fi
        reset_log
        # shellcheck disable=SC2086
        run_oc $oc_flags
        assert_rc 1
        if [ -s "$LOG" ]; then
            bad "gateway was contacted for the session with '$oc_flags'"
        fi
    done
    assert_err_has "cannot be combined with --session-id"
}

test_oc_image_build() {
    begin "opencode-oss image build builds opencode-oss/image as opencode-agent:local"
    oc_case oc-image
    oc_config 'image = "my-env:latest"'
    run_oc image build
    assert_rc 0
    assert_log_line "build"
    assert_log_line "-t"
    assert_log_line "opencode-agent:local"
    assert_log_line "$ROOT/opencode-oss/image"
    assert_log_line_missing "--build-arg"
    assert_log_line_missing "my-env:latest"

    reset_log
    run_oc image build --opencode-version 9.9.9
    assert_rc 0
    assert_log_line "--build-arg"
    assert_log_line "OPENCODE_VERSION=9.9.9"

    # A version without matching checksums fails the build; the helper says why.
    reset_log
    ENGINE_EXIT=1
    run_oc image build --opencode-version 9.9.9
    assert_rc 2
    assert_err_has "OPENCODE_SHA512_ARM64/AMD64"
    assert_err_has "image build failed"

    run_oc image build --maki-version 1
    assert_rc 1
    assert_err_has "unknown option: --maki-version"
}

test_oc_stores_catalog() {
    begin "stores.tsv rows resolve to opencode-* profiles and every profile is reachable"
    oc_case oc-stores
    oc_dir=$ROOT/opencode-oss/providers
    while IFS=$(printf '\t') read -r oc_store oc_slug oc_id _; do
        case $oc_store in
            ''|'#'*) continue ;;
        esac
        case $oc_store in
            maki|opencode) ;;
            *) bad "stores.tsv has an unknown store: $oc_store" ;;
        esac
        case $oc_id in
            opencode-*) ;;
            *) bad "stores.tsv maps $oc_store:$oc_slug to a non-OpenCode profile: $oc_id" ;;
        esac
        [ -f "$oc_dir/$oc_id.yaml" ] || bad "stores.tsv names a missing profile: $oc_id"
    done <"$oc_dir/stores.tsv"
    for oc_profile in "$oc_dir"/opencode-*.yaml; do
        oc_id=$(basename -- "$oc_profile" .yaml)
        grep -q "	$oc_id	" "$oc_dir/stores.tsv" || bad "no store slug reaches $oc_id"
        grep -q "^$oc_id	" "$oc_dir/catalog.tsv" || bad "catalog.tsv has no example model for $oc_id"
    done
    grep -Fxq '  - /usr/local/bin/opencode' "$oc_dir/template.yaml" \
        || bad "the custom-profile template does not bind /usr/local/bin/opencode"
}

test_oc_provider_setup() {
    begin "opencode-oss provider setup maps an OpenCode store key to its opencode-* profile"
    oc_case oc-setup
    oc_value='fixture-oc-synthetic-key-7c1e'
    seed_opencode_auth "{\"synthetic\": {\"type\": \"api\", \"key\": \"$oc_value\"}}"
    CREDENTIAL_ENV=SYNTHETIC_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_oc provider setup --from opencode --credential synthetic --yes
    assert_rc 0
    assert_log_line "lint"
    assert_log_line "$ROOT/opencode-oss/providers/opencode-synthetic.yaml"
    assert_log_line "import"
    assert_log_before "lint" "import"
    assert_log_line "create"
    assert_log_line "opencode-synthetic"
    assert_log_line "--from-existing"
    assert_out_has "Provider 'opencode-synthetic' created."
    assert_out_has "example model: synthetic/hf:zai-org/GLM-5.3"
    assert_out_has "model = \"synthetic/hf:zai-org/GLM-5.3\" in $XDG_CONFIG_HOME/opencode-oss/config.toml"
    grep -Fxq 'providers = "opencode-synthetic"' "$XDG_CONFIG_HOME/opencode-oss/config.toml" 2>/dev/null \
        || bad "the provider was not recorded in the opencode-oss config"
    [ ! -e "$XDG_CONFIG_HOME/maki-oss/config.toml" ] || bad "the maki-oss config was written"
    assert_credential_env "$oc_value"
    assert_secret_absent "$oc_value"
    if grep -rFq -- "$oc_value" "$XDG_CONFIG_HOME" 2>/dev/null; then
        bad "a config or profile file contains the credential value"
    fi

    # A Maki store key reaches the same profile.
    reset_log
    seed_maki_store deepseek "fixture-oc-deepseek-key"
    CREDENTIAL_ENV=DEEPSEEK_API_KEY
    run_oc provider setup --from maki --credential deepseek --yes
    assert_rc 0
    assert_log_line "$ROOT/opencode-oss/providers/opencode-deepseek.yaml"
    assert_out_has "example model: deepseek/deepseek-v4-pro"
}

test_oc_provider_setup_custom() {
    begin "opencode-oss custom profiles use the opencode- prefix and bind opencode"
    oc_case oc-setup-custom
    oc_value='fixture-oc-custom-9d2b'
    seed_maki_store acme-router "$oc_value"
    CREDENTIAL_ENV=ACME_ROUTER_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_oc_stdin "1\n\n\napi.acme-router.test\n/v1\n" provider setup --yes
    assert_rc 0
    oc_generated=$XDG_CONFIG_HOME/opencode-oss/profiles/opencode-acme-router.yaml
    [ -f "$oc_generated" ] || bad "no opencode-acme-router profile was generated"
    grep -Fxq '  - /usr/local/bin/opencode' "$oc_generated" 2>/dev/null \
        || bad "the generated profile does not bind /usr/local/bin/opencode"
    grep -Fq 'OpenCode coding agent' "$oc_generated" 2>/dev/null \
        || bad "the generated profile does not describe OpenCode"
    assert_credential_env "$oc_value"
    assert_secret_absent "$oc_value"
    if grep -Fq -- "$oc_value" "$oc_generated" 2>/dev/null; then
        bad "the generated profile contains the credential value"
    fi
}

seed_oc_host_mcp() { # JSON
    mkdir -p "$HOME/.config/opencode"
    printf '%s\n' "$1" >"$HOME/.config/opencode/opencode.json"
}

OC_HOST_MCP='{"mcp": {"context7": {"type": "remote", "url": "https://mcp.context7.com/mcp", "headers": {"CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}"}}, "off": {"type": "local", "command": ["bunx", "off-mcp"], "enabled": false}}}'

test_oc_mcp_status_missing_in_sandbox() {
    begin "opencode-oss mcp status reports a server missing from the base image"
    oc_case oc-mcp-missing
    oc_ready_project
    seed_oc_host_mcp "$OC_HOST_MCP"
    EXEC_STDOUT=$(cat "$ROOT/opencode-oss/image/config/opencode.json")

    run_oc mcp status
    assert_rc 3
    assert_out_has "context7: sandbox=missing"
    assert_out_has "fix: build and select an environment image built FROM opencode-agent:local that declares 'context7' (see docs/ai/reference/opencode.md)"
    assert_out_has "fix: opencode-oss provider attach opencode-mcp-context7"
    assert_out_missing "off:"
    assert_log_line "/sandbox/.config/opencode/opencode.json"
    assert_log_missing "create"
    assert_log_missing "attach"
}

test_oc_mcp_status_present() {
    begin "opencode-oss mcp status passes a server present on both sides"
    oc_case oc-mcp-present
    oc_ready_project
    attach_stub_provider oc-myproject opencode-mcp-context7
    seed_oc_host_mcp "$OC_HOST_MCP"
    EXEC_STDOUT=$OC_HOST_MCP
    POLICY_FULL='host: mcp.context7.com'

    run_oc mcp status
    assert_rc 0
    assert_out_has "context7: sandbox=ok provider=ok endpoint=ok transport=http"
    assert_out_missing "off:"
    assert_out_missing "fix:"
}

test_oc_mcp_status_unreadable() {
    begin "opencode-oss mcp status reports a JSONC file as unreadable"
    oc_case oc-mcp-jsonc
    oc_ready_project
    seed_oc_host_mcp '{
  // a comment makes this JSONC, which jq cannot parse
  "mcp": {}
}'
    EXEC_STDOUT=$(cat "$ROOT/opencode-oss/image/config/opencode.json")

    run_oc mcp status
    assert_rc 3
    assert_out_has "unreadable: host config $HOME/.config/opencode/opencode.json"
    assert_out_missing "sandbox=missing"
}

test_oc_mcp_no_jq_and_doctor() {
    begin "opencode-oss mcp status needs jq; doctor shows the table or skips it"
    oc_case oc-mcp-nojq
    oc_ready_project
    seed_oc_host_mcp "$OC_HOST_MCP"
    EXEC_STDOUT=$(cat "$ROOT/opencode-oss/image/config/opencode.json")

    run_oc doctor
    assert_out_has "MCP readiness (informational):"
    assert_out_has "context7: sandbox=missing"
    assert_out_has "warn  model: none set"

    oc_config 'model = "synthetic/hf:zai-org/GLM-5.3"'
    run_oc doctor
    assert_out_has "ok    model: synthetic/hf:zai-org/GLM-5.3"

    PATH_OVERRIDE=$(no_jq_path)
    run_oc mcp status
    assert_rc 2
    assert_err_has "needs jq"
    run_oc doctor
    assert_out_has "skipped: jq not found"
    assert_out_missing "context7:"
}

test_oc_isolation() {
    begin "opencode-oss and maki-oss keep separate sandboxes, config, env, and state"
    oc_case oc-isolation
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    ENV_IMAGE=maki-only:tag

    run_oc up
    assert_rc 0
    assert_log_line "oc-myproject"
    assert_log_line "opencode-agent:local"
    assert_log_line "$ROOT/opencode-oss/policies/minimal.yaml"
    assert_log_line_missing "maki-only:tag"

    reset_log
    reset_state
    ENV_OC_IMAGE=custom:tag
    run_oc up
    assert_rc 0
    assert_log_line "custom:tag"

    reset_log
    run_maki status
    assert_out_has "Sandbox:   maki-myproject"
    run_oc status
    assert_out_has "Sandbox:   oc-myproject"

    # A session keeps its sync state in its own session directory under the
    # shared osa root, never in a per-tool root.
    reset_state
    oc_ready_project
    run_oc run "touch nothing"
    assert_rc 0
    [ -d "$(oc_session_dir oc-myproject)" ] || bad "no opencode-oss session state"
    [ ! -e "$(session_dir maki-myproject)" ] || bad "opencode-oss wrote the Maki session state"
    [ ! -e "$HOME/.local/state/maki-oss" ] || bad "opencode-oss wrote a maki-oss state root"
    [ ! -e "$HOME/.local/state/opencode-oss" ] || bad "opencode-oss wrote a per-tool state root"
    [ -d "$CASE/sandbox/.opencode-oss/git" ] || bad "the sandbox baseline is not under .opencode-oss"
    [ ! -e "$CASE/sandbox/.maki-oss" ] || bad "the sandbox has .maki-oss state"
    assert_log_has "refs/opencode-oss/base"
    [ ! -e "$XDG_CONFIG_HOME/maki-oss" ] || bad "opencode-oss wrote the maki-oss config"
}

test_oc_lifecycle_and_guard() {
    begin "opencode-oss up/status/rm, the --env guard, and the no-provider refusal"
    oc_case oc-lifecycle
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"

    run_oc up --env OPENAI_API_KEY=x
    assert_rc 1
    assert_err_has "OPENAI_API_KEY"
    assert_log_missing "create"
    run_oc up --env OPENAI_API_KEY=x --allow-env OPENAI_API_KEY
    assert_rc 0
    assert_log_line "OPENAI_API_KEY=x"

    run_oc status
    assert_rc 0
    assert_out_has "Exists:    yes"
    assert_out_has "opencode-agent:local (configured)"

    reset_log
    run_oc rm
    assert_rc 1
    assert_log_missing "delete"
    run_oc rm --yes
    assert_rc 0
    assert_log_line "delete"
    [ ! -e "$STUB_STATE_DIR/sandboxes/oc-myproject" ] || bad "rm --yes kept the sandbox"

    reset_log
    run_oc
    assert_rc 1
    assert_err_has "opencode-oss provider setup"
    if [ -s "$LOG" ]; then
        bad "gateway was contacted without a provider"
    fi
}

test_oc_run_timeout_and_proposals() {
    begin "opencode-oss run --timeout wraps opencode; sessions enable and surface proposals"
    oc_case oc-timeout
    oc_ready_project
    EXEC_STDIN_LOG=$CASE/exec-stdin
    printf 'LEAKED-STDIN\n' >"$CASE/stdin.txt"

    run_oc_with_input "$CASE/stdin.txt" run --timeout 30 "check"
    assert_rc 0
    assert_log_line "opencode-oss-run"
    assert_log_has "OPENCODE_OSS_RUN_TAG"
    assert_log_has "/tmp/opencode-oss-stop/"
    assert_log_line "30"
    assert_log_before "opencode-oss-run" "--standalone"
    assert_stdin_closed

    reset_log
    RULE_PENDING='Network Rules:  (version 3, 1 chunks)

  Chunk: 2258b82a-8253-4094-bf5f-3e309b2b9c11
  Status: pending'
    run_oc run "check"
    assert_rc 0
    assert_log_line "agent_policy_proposals_enabled"
    assert_log_before "settings" "--standalone"
    assert_err_has "1 pending network-rule proposal(s) for 'oc-myproject'. Review: opencode-oss policy review"
}

test_oc_sync_clean_git() {
    begin "opencode-oss applies a clean git session by fast-forward"
    oc_case oc-sync-git
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    seed_sandbox oc-repo Ready
    seed_oc_provider opencode-stub
    attach_stub_provider oc-repo opencode-stub
    run_oc upload .
    commit_before=$(git -C "$RUN_DIR" rev-parse HEAD)
    STUB_MAKI_SCRIPT='printf "agent\n" > agent.txt; printf "modified\n" > tracked.txt'

    run_oc run "edit"
    assert_rc 0
    [ "$(cat "$RUN_DIR/tracked.txt")" = modified ] || bad "agent change is not on the host"
    [ "$(cat "$RUN_DIR/agent.txt" 2>/dev/null)" = agent ] || bad "agent file is not on the host"
    [ "$(git -C "$RUN_DIR" rev-parse HEAD^)" = "$commit_before" ] || bad "result commit parent is not the baseline"
    [ "$(git -C "$RUN_DIR" log -1 --format=%s)" = "opencode-oss: apply sandbox changes" ] \
        || bad "result commit has the wrong subject"
    [ -z "$(git -C "$RUN_DIR" branch --list 'opencode-oss/*')" ] || bad "temporary branch was not deleted"
    [ ! -f "$(oc_session_dir oc-repo)/pending" ] || bad "a clean apply left a pending marker"
}

test_oc_sync_dirty_host() {
    begin "opencode-oss keeps a dirty host and commits the result on a review branch"
    oc_case oc-sync-dirty
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    printf 'local edit\n' >>"$RUN_DIR/tracked.txt"
    seed_sandbox oc-repo Ready
    seed_oc_provider opencode-stub
    attach_stub_provider oc-repo opencode-stub
    STUB_MAKI_SCRIPT='printf "agent edited\n" > tracked.txt'

    run_oc
    assert_rc 0
    assert_err_has "Uncommitted host work was not committed"
    oc_branch=$(git -C "$RUN_DIR" for-each-ref --format='%(refname:short)' 'refs/heads/opencode-oss/*' | head -n 1)
    [ -n "$oc_branch" ] || bad "result branch was not kept"
    grep -Fq 'local edit' "$RUN_DIR/tracked.txt" || bad "local edit was lost"
    [ -f "$(oc_session_dir oc-repo)/pending" ] || bad "no pending marker for the dirty host"
}

test_oc_sync_plain_directory() {
    begin "opencode-oss applies a clean patch to a plain directory"
    oc_case oc-sync-plain
    OC_SEED_FILES='readme.txt=host-version
hostonly.txt=host-only'
    oc_ready_project
    STUB_MAKI_SCRIPT='printf "sandbox-version\n" > readme.txt'

    run_oc run "edit"
    assert_rc 0
    grep -Fq 'sandbox-version' "$RUN_DIR/readme.txt" || bad "the patch did not update the file"
    grep -Fq 'host-only' "$RUN_DIR/hostonly.txt" || bad "a host-only file was removed"
    assert_log_missing "download"
}

test_oc_sync_no_git() {
    begin "opencode-oss applies a text patch with patch when the host has no git"
    oc_case oc-sync-nogit
    OC_SEED_FILES='file.txt=v1'
    oc_ready_project
    PATH_OVERRIDE=$(no_git_path with_patch)
    STUB_MAKI_SCRIPT='printf "v2\n" > file.txt'

    run_oc run "edit"
    assert_rc 0
    [ "$(cat "$RUN_DIR/file.txt")" = v2 ] || bad "text patch did not apply without git"
    assert_err_has "Applied sandbox changes"
}

# ---------------------------------------------------------------------------
# claude-oss: the Claude Code front-end over the same core and stubs
# (specs/claude-oss-helper). Same runner pattern as opencode-oss: the
# CLAUDE_OSS_* settings are exported, and the MAKI_OSS_* values the shared
# runner always passes must have no effect.
# ---------------------------------------------------------------------------

CC=$ROOT/bin/claude-oss
CC_UUID=123e4567-e89b-12d3-a456-426614174000

cc_case() { # NAME
    new_case "$1"
    ENV_CC_MODEL=
    ENV_CC_IMAGE=
    EXEC_STDIN_LOG=
    ENGINE_EXIT=
    CC_SEED_FILES=
    CC_TOKEN_ENV=
    CC_NAME_PIN='cc-{project}'
}

run_cc_with_input() { # STDIN_FILE ARGS...
    cc_rc=0
    (
        MAKI=$CC
        CLAUDE_OSS_SANDBOX_NAME=${ENV_NAME:-$CC_NAME_PIN}
        CLAUDE_OSS_TIMEOUT=${ENV_TIMEOUT:-}
        CLAUDE_OSS_IDLE_STOP=${ENV_IDLE_STOP-0}
        CLAUDE_OSS_RUN_TAG=${ENV_RUN_TAG:-}
        CLAUDE_OSS_WORKDIR=$CASE/sandbox/project
        CLAUDE_OSS_IMAGE=${ENV_CC_IMAGE:-}
        CLAUDE_OSS_MODEL=${ENV_CC_MODEL:-}
        CLAUDE_OSS_INTERACTIVE=${INTERACTIVE:-}
        STUB_EXEC_STDIN_LOG=${EXEC_STDIN_LOG:-}
        STUB_ENGINE_EXIT=${ENGINE_EXIT:-0}
        export CLAUDE_OSS_SANDBOX_NAME CLAUDE_OSS_TIMEOUT CLAUDE_OSS_IDLE_STOP \
            CLAUDE_OSS_RUN_TAG CLAUDE_OSS_WORKDIR CLAUDE_OSS_IMAGE \
            CLAUDE_OSS_MODEL CLAUDE_OSS_INTERACTIVE STUB_EXEC_STDIN_LOG \
            STUB_ENGINE_EXIT
        unset CLAUDE_CONFIG_DIR CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY
        if [ -n "${CC_TOKEN_ENV:-}" ]; then
            CLAUDE_CODE_OAUTH_TOKEN=$CC_TOKEN_ENV
            export CLAUDE_CODE_OAUTH_TOKEN
        fi
        if [ -n "${CC_CONFIG_DIR:-}" ]; then
            CLAUDE_CONFIG_DIR=$CC_CONFIG_DIR
            export CLAUDE_CONFIG_DIR
        fi
        run_maki_with_input "$@"
        exit "$RC"
    ) || cc_rc=$?
    RC=$cc_rc
}

run_cc() {
    run_cc_with_input /dev/null "$@"
}

run_cc_stdin() {
    cc_stdin_input=$1
    shift
    printf '%b\n' "$cc_stdin_input" >"$CASE/stdin.txt"
    INTERACTIVE=1
    run_cc_with_input "$CASE/stdin.txt" "$@"
}

cc_config() { # LINE
    mkdir -p "$XDG_CONFIG_HOME/claude-oss"
    printf '%s\n' "$1" >>"$XDG_CONFIG_HOME/claude-oss/config.toml"
}

seed_cc_provider() { # NAME
    cc_config "providers = \"$1\""
    mkdir -p "$STUB_STATE_DIR"
    printf '%s\n' "$1" >>"$STUB_STATE_DIR/providers.list"
}

cc_session_dir() { # SANDBOX
    printf '%s/.local/state/osa/sessions/%s' "$HOME" "$1"
}

# A project directory with its Ready sandbox and a remembered, attached
# provider. Host files the test needs go in CC_SEED_FILES (NAME=CONTENT).
cc_ready_project() { # [DIR-NAME]
    RUN_DIR=$CASE/project/${1:-myproject}
    mkdir -p "$RUN_DIR"
    while IFS= read -r cc_seed; do
        [ -n "$cc_seed" ] || continue
        printf '%s\n' "${cc_seed#*=}" >"$RUN_DIR/${cc_seed%%=*}"
    done <<CC_SEED
${CC_SEED_FILES:-}
CC_SEED
    seed_sandbox "cc-${1:-myproject}" Ready
    seed_cc_provider claude-anthropic
    attach_stub_provider "cc-${1:-myproject}" claude-anthropic
}

test_cc_help() {
    begin "claude-oss help lists the shared commands and no Maki, OpenCode, or fish ones"
    cc_case cc-help
    run_cc help
    assert_rc 0
    for cc_cmd in doctor 'image build' 'init, up' claude 'run "<prompt>"' upload download \
        status list logs 'start, stop' rm 'policy show|edit|apply' 'policy review' \
        'policy approve' 'policy reject' 'provider add|attach|list' 'provider setup' \
        'mcp status' help; do
        if ! grep -Eq "^  $(printf '%s' "$cc_cmd" | sed 's/[|.]/\\&/g')( |$)" "$OUT"; then
            bad "help does not list: $cc_cmd"
        fi
    done
    for cc_cmd in maki opencode fish; do
        if grep -Eq "^  $cc_cmd( |$)" "$OUT"; then
            bad "help lists $cc_cmd"
        fi
    done
    assert_out_has "CLAUDE_OSS_<KEY>"
    assert_out_has "claude-oss/config.toml"

    for cc_cmd in maki opencode fish; do
        run_cc "$cc_cmd"
        assert_rc 1
        assert_err_has "unknown command: $cc_cmd"
    done
}

test_cc_run_argv() {
    begin "claude-oss run launches claude -p stream-json with bypass and stdin closed"
    cc_case cc-run
    cc_ready_project
    EXEC_STDOUT='{"type":"result","result":"OK"}'
    EXEC_STDIN_LOG=$CASE/exec-stdin
    printf 'LEAKED-STDIN\n' >"$CASE/stdin.txt"

    run_cc_with_input "$CASE/stdin.txt" run "reply OK"
    assert_rc 0
    assert_out_has '{"type":"result","result":"OK"}'
    assert_stdin_closed
    for cc_word in claude -p --output-format stream-json --verbose \
        --dangerously-skip-permissions "reply OK"; do
        assert_log_line "$cc_word"
    done
    assert_log_before "--dangerously-skip-permissions" "reply OK"
    assert_log_line_missing "--model"
    assert_log_line_missing "--bare"
    assert_log_line_missing "--settings"
    assert_log_missing "approve-api-key"

    reset_log
    ENV_CC_MODEL=claude-sonnet-5-5
    run_cc run "reply OK"
    assert_rc 0
    assert_log_line "--model"
    assert_log_line "claude-sonnet-5-5"
    assert_log_before "--model" "reply OK"

    reset_log
    EXEC_EXIT=3
    EXEC_STDOUT='partial'
    run_cc run "fail please"
    assert_rc 3
    assert_out_has "partial"
}

test_cc_tui_argv() {
    begin "bare claude-oss runs the key approval step, then claude with the model"
    cc_case cc-tui
    cc_ready_project
    cc_config 'model = "claude-opus-5-5"'

    run_cc --continue
    assert_rc 0
    assert_log_line "--tty"
    assert_log_line "sh"
    assert_log_line "-c"
    assert_log_line '/usr/local/libexec/claude-oss/approve-api-key; exec "$@"'
    assert_log_line "claude"
    assert_log_line "--dangerously-skip-permissions"
    assert_log_line "--continue"
    assert_log_line "--model"
    assert_log_line "claude-opus-5-5"
    assert_log_before "approve-api-key" "--dangerously-skip-permissions"
    assert_log_line_missing "-p"
    assert_log_line_missing "stream-json"
    # The helper writes the model nowhere.
    if grep -rqs 'claude-opus-5-5' "$RUN_DIR" "$SANDBOX_WORKDIR"; then
        bad "the helper wrote the model into the project"
    fi
    assert_log_has "refs/claude-oss/base"

    reset_log
    run_cc claude
    assert_rc 0
    assert_log_line "--tty"
    assert_log_line "--dangerously-skip-permissions"
    run_cc claude extra
    assert_rc 1
    assert_err_has "claude takes no arguments"
}

test_cc_session_flags() {
    begin "claude-oss passes session flags through and requires a UUID session ID"
    cc_case cc-session
    cc_ready_project

    run_cc run --resume abc-123 "next"
    assert_rc 0
    assert_log_line "--resume"
    assert_log_line "abc-123"
    assert_log_before "--resume" "next"

    reset_log
    run_cc run --session-id "$CC_UUID" "start"
    assert_rc 0
    assert_log_line "--session-id"
    assert_log_line "$CC_UUID"

    reset_log
    run_cc -r abc-tui
    assert_rc 0
    assert_log_line "--tty"
    assert_log_line "--resume"
    assert_log_line "abc-tui"

    for cc_flags in "--session-id abc" "--continue --resume x" "--continue --session-id $CC_UUID" \
        "--resume x --session-id $CC_UUID"; do
        reset_log
        # shellcheck disable=SC2086  # the flag list splits on purpose
        run_cc run $cc_flags "x"
        assert_rc 1
        if [ -s "$LOG" ]; then
            bad "gateway was contacted for '$cc_flags'"
        fi
        reset_log
        # shellcheck disable=SC2086
        run_cc $cc_flags
        assert_rc 1
        if [ -s "$LOG" ]; then
            bad "gateway was contacted for the session with '$cc_flags'"
        fi
    done
    run_cc run --session-id abc "x"
    assert_err_has "--session-id must be a UUID"
}

test_cc_image_build() {
    begin "claude-oss image build builds claude-oss/image as claude-agent:local"
    cc_case cc-image
    cc_config 'image = "my-env:latest"'
    run_cc image build
    assert_rc 0
    assert_log_line "build"
    assert_log_line "claude-agent:local"
    assert_log_line "$ROOT/claude-oss/image"
    assert_log_line_missing "--build-arg"
    assert_log_line_missing "my-env:latest"

    reset_log
    run_cc image build --claude-version 9.9.9
    assert_rc 0
    assert_log_line "--build-arg"
    assert_log_line "CLAUDE_VERSION=9.9.9"

    reset_log
    ENGINE_EXIT=1
    run_cc image build --claude-version 9.9.9
    assert_rc 2
    assert_err_has "CLAUDE_SHA256_ARM64/AMD64"
    assert_err_has "image build failed"

    run_cc image build --opencode-version 1
    assert_rc 1
    assert_err_has "unknown option: --opencode-version"
}

test_cc_profiles_and_catalogs() {
    begin "claude-oss profiles bind claude, and the catalogs name existing profiles"
    cc_case cc-catalogs
    cc_dir=$ROOT/claude-oss/providers
    for cc_profile in "$cc_dir"/claude-*.yaml "$cc_dir/template.yaml"; do
        cc_bins=$(awk '/^binaries:/{b=1;next} b&&/^  - /{print $2;next} {b=0}' "$cc_profile")
        [ "$cc_bins" = /usr/local/bin/claude ] || bad "$(basename -- "$cc_profile") binds: $cc_bins"
    done
    grep -q 'header_name: x-api-key' "$cc_dir/claude-anthropic.yaml" || bad "the API key profile does not use x-api-key"
    grep -q 'auth_style: bearer' "$cc_dir/claude-anthropic-oauth.yaml" || bad "the token profile is not bearer"
    grep -q 'env_vars: \[CLAUDE_CODE_OAUTH_TOKEN\]' "$cc_dir/claude-anthropic-oauth.yaml" \
        || bad "the token profile does not bind CLAUDE_CODE_OAUTH_TOKEN"
    while IFS=$(printf '\t') read -r cc_store _ cc_id _; do
        case $cc_store in ''|'#'*) continue ;; esac
        [ -f "$cc_dir/$cc_id.yaml" ] || bad "stores.tsv names a missing profile: $cc_id"
    done <"$cc_dir/stores.tsv"
    for cc_profile in "$cc_dir"/claude-*.yaml; do
        cc_id=$(basename -- "$cc_profile" .yaml)
        grep -q "^$cc_id	" "$cc_dir/catalog.tsv" || bad "catalog.tsv has no row for $cc_id"
    done
    while IFS=$(printf '\t') read -r cc_id _; do
        case $cc_id in ''|'#'*) continue ;; esac
        [ -f "$cc_dir/$cc_id.yaml" ] || bad "catalog.tsv names a missing profile: $cc_id"
    done <"$cc_dir/catalog.tsv"
    # No file under claude-oss/ or its docs spells the placeholder prefix.
    cc_needle=$(printf 'openshell:resolve'':env:')
    if cc_hits=$(grep -rlF -- "$cc_needle" "$ROOT/claude-oss" "$ROOT/docs/ai/reference/claude.md" 2>/dev/null); then
        bad "placeholder prefix spelled in: $cc_hits"
    fi
}

test_cc_provider_setup_store() {
    begin "claude-oss provider setup maps a stored Anthropic key to claude-anthropic"
    cc_case cc-setup-store
    cc_value='fixture-cc-anthropic-key-31aa'
    seed_maki_store anthropic "$cc_value"
    CREDENTIAL_ENV=ANTHROPIC_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_cc provider setup --from maki --credential anthropic --yes
    assert_rc 0
    assert_log_line "$ROOT/claude-oss/providers/claude-anthropic.yaml"
    assert_log_line "create"
    assert_log_line "claude-anthropic"
    assert_out_has "example model: sonnet"
    assert_out_has "model = \"sonnet\" in $XDG_CONFIG_HOME/claude-oss/config.toml"
    grep -Fxq 'providers = "claude-anthropic"' "$XDG_CONFIG_HOME/claude-oss/config.toml" 2>/dev/null \
        || bad "the provider was not recorded in the claude-oss config"
    assert_credential_env "$cc_value"
    assert_secret_absent "$cc_value"
}

test_cc_provider_setup_token() {
    begin "claude-oss provider setup takes a setup-token from the host env, never the host login"
    cc_case cc-setup-token
    cc_value='fixture-cc-oauth-token-5e7f'
    # A host Claude Code login that must never be read.
    mkdir -p "$HOME/.claude" "$HOME/.config/anthropic"
    printf '{"claudeAiOauth":{"accessToken":"fixture-host-login-access"}}\n' >"$HOME/.claude/.credentials.json"
    printf 'fixture-host-login-profile\n' >"$HOME/.config/anthropic/profile"
    CREDENTIAL_ENV=CLAUDE_CODE_OAUTH_TOKEN
    CREDENTIAL_LOG=$CASE/credential-env.log
    CC_TOKEN_ENV=$cc_value

    run_cc provider setup --env CLAUDE_CODE_OAUTH_TOKEN --yes
    assert_rc 0
    assert_out_has "Using curated profile 'claude-anthropic-oauth'."
    assert_log_line "$ROOT/claude-oss/providers/claude-anthropic-oauth.yaml"
    assert_log_line "claude-anthropic-oauth"
    assert_out_has "claude setup-token"
    assert_credential_env "$cc_value"
    assert_secret_absent "$cc_value"
    for cc_host in fixture-host-login-access fixture-host-login-profile; do
        assert_secret_absent "$cc_host"
        if [ -f "$CREDENTIAL_LOG" ] && grep -Fq -- "$cc_host" "$CREDENTIAL_LOG"; then
            bad "the host Claude Code login reached the provider flow"
        fi
    done

    # No token in the environment: the error says where a token comes from.
    reset_log
    CC_TOKEN_ENV=
    run_cc provider setup --env CLAUDE_CODE_OAUTH_TOKEN --yes
    assert_rc 1
    assert_err_has "claude setup-token"
    assert_log_missing "create"

    # The hidden prompt asks which credential it is.
    reset_log
    CC_TOKEN_ENV=
    run_cc_stdin "g\n3\n$cc_value\n2\n" provider setup --yes
    assert_rc 0
    assert_out_has "Claude subscription token"
    assert_log_line "claude-anthropic-oauth"
    assert_credential_env "$cc_value"
    assert_secret_absent "$cc_value"
}

test_cc_doctor() {
    begin "claude-oss doctor reports the model and warns when both credentials are attached"
    cc_case cc-doctor
    cc_ready_project

    run_cc doctor
    assert_out_has "ok    model: Claude Code's default"
    assert_out_missing "warn  credentials:"
    cc_doctor_rc=$RC

    attach_stub_provider cc-myproject claude-anthropic-oauth
    run_cc doctor
    assert_out_has "warn  credentials: claude-anthropic and claude-anthropic-oauth are both attached"
    assert_out_has "Claude Code uses the API key (claude-anthropic)"
    [ "$RC" = "$cc_doctor_rc" ] || bad "the warning changed the doctor exit code ($cc_doctor_rc -> $RC)"

    cc_config 'model = "sonnet"'
    run_cc doctor
    assert_out_has "ok    model: sonnet"
}

seed_cc_host_mcp() { # JSON [DIR]
    cc_mcp_dir=${2:-$HOME}
    mkdir -p "$cc_mcp_dir"
    printf '%s\n' "$1" >"$cc_mcp_dir/.claude.json"
}

CC_HOST_MCP='{"mcpServers": {"context7": {"type": "http", "url": "https://mcp.context7.com/mcp"}, "local": {"command": "/usr/local/bin/local-mcp", "args": []}}}'

test_cc_mcp_status() {
    begin "claude-oss mcp status compares mcpServers in the host and sandbox .claude.json"
    cc_case cc-mcp
    cc_ready_project
    seed_cc_host_mcp "$CC_HOST_MCP"
    EXEC_STDOUT=$(cat "$ROOT/claude-oss/image/claude.json")

    run_cc mcp status
    assert_rc 3
    assert_out_has "context7: sandbox=missing"
    assert_out_has "fix: claude-oss provider attach claude-mcp-context7"
    assert_out_has "an environment image built FROM claude-agent:local"
    assert_out_has "local: sandbox=missing"
    assert_log_line "/sandbox/.claude.json"

    reset_log
    attach_stub_provider cc-myproject claude-mcp-context7
    EXEC_STDOUT='{"mcpServers": {"context7": {"type": "http", "url": "https://mcp.context7.com/mcp"}}}'
    seed_cc_host_mcp '{"mcpServers": {"context7": {"type": "http", "url": "https://mcp.context7.com/mcp"}}}'
    POLICY_FULL='host: mcp.context7.com'
    run_cc mcp status
    assert_rc 0
    assert_out_has "context7: sandbox=ok provider=ok endpoint=ok transport=http"

    # CLAUDE_CONFIG_DIR selects the host file.
    seed_cc_host_mcp '{"mcpServers": {"other": {"type": "http", "url": "https://other.test/mcp"}}}' "$CASE/cfgdir"
    CC_CONFIG_DIR=$CASE/cfgdir
    run_cc mcp status
    assert_out_has "other: sandbox=missing"
    CC_CONFIG_DIR=

    seed_cc_host_mcp '{ not json'
    run_cc mcp status
    assert_rc 3
    assert_out_has "unreadable: host config $HOME/.claude.json"

    seed_cc_host_mcp "$CC_HOST_MCP"
    PATH_OVERRIDE=$(no_jq_path)
    run_cc mcp status
    assert_rc 2
    assert_err_has "needs jq"
    run_cc doctor
    assert_out_has "skipped: jq not found"
}

test_cc_isolation_and_registry() {
    begin "claude-oss keeps its own sandbox, config, and state, and registers as cc"
    cc_case cc-isolation
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    ENV_IMAGE=maki-only:tag

    run_cc up
    assert_rc 0
    assert_log_line "cc-myproject"
    assert_log_line "claude-agent:local"
    assert_log_line "$ROOT/claude-oss/policies/minimal.yaml"
    assert_log_line_missing "maki-only:tag"
    [ "$(registry_value cc-myproject agent)" = cc ] || bad "the registry entry is not agent cc"

    reset_log
    reset_state
    ENV_CC_IMAGE=custom:tag
    run_cc up
    assert_rc 0
    assert_log_line "custom:tag"

    reset_state
    cc_ready_project
    run_cc run "touch nothing"
    assert_rc 0
    [ -d "$(cc_session_dir cc-myproject)" ] || bad "no claude-oss session state"
    [ ! -e "$HOME/.local/state/claude-oss" ] || bad "claude-oss wrote a per-tool state root"
    [ ! -e "$HOME/.local/state/maki-oss" ] || bad "claude-oss wrote a maki-oss state root"
    [ -d "$CASE/sandbox/.claude-oss/git" ] || bad "the sandbox baseline is not under .claude-oss"
    [ ! -e "$XDG_CONFIG_HOME/maki-oss" ] || bad "claude-oss wrote the maki-oss config"
    [ ! -e "$XDG_CONFIG_HOME/opencode-oss" ] || bad "claude-oss wrote the opencode-oss config"

    run_osa projects --json
    assert_rc 0
    assert_out_has '"agent":"cc"'
    run_cc status
    cc_sync=$(sed -n 's/^Sync: *//p' "$OUT" | awk '{print $1}')
    # osa runs the front-end itself, so it needs the case's sandbox workdir.
    (
        CLAUDE_OSS_WORKDIR=$CASE/sandbox/project
        export CLAUDE_OSS_WORKDIR
        run_osa status --json
        exit "$RC"
    ) || RC=$?
    assert_rc 0
    assert_out_has "\"sync\":\"$cc_sync\""
}

test_cc_lifecycle_and_guard() {
    begin "claude-oss up/status/rm, the --env guard, and the no-provider refusal"
    cc_case cc-lifecycle
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"

    run_cc up --env CLAUDE_CODE_OAUTH_TOKEN=x
    assert_rc 1
    assert_err_has "CLAUDE_CODE_OAUTH_TOKEN"
    assert_log_missing "create"
    run_cc up --env CLAUDE_CODE_OAUTH_TOKEN=x --allow-env CLAUDE_CODE_OAUTH_TOKEN
    assert_rc 0
    assert_log_line "CLAUDE_CODE_OAUTH_TOKEN=x"

    run_cc status
    assert_rc 0
    assert_out_has "Exists:    yes"
    assert_out_has "claude-agent:local (configured)"

    reset_log
    run_cc rm
    assert_rc 1
    assert_log_missing "delete"
    run_cc rm --yes
    assert_rc 0
    assert_log_line "delete"

    reset_log
    run_cc
    assert_rc 1
    assert_err_has "claude-oss provider setup"
    if [ -s "$LOG" ]; then
        bad "gateway was contacted without a provider"
    fi
}

test_cc_timeout_proposals_idle() {
    begin "claude-oss run --timeout wraps claude; proposals surface; idle stop waits on claude"
    cc_case cc-timeout
    cc_ready_project
    EXEC_STDIN_LOG=$CASE/exec-stdin
    printf 'LEAKED-STDIN\n' >"$CASE/stdin.txt"

    run_cc_with_input "$CASE/stdin.txt" run --timeout 30 "check"
    assert_rc 0
    assert_log_line "claude-oss-run"
    assert_log_has "/tmp/claude-oss-stop/"
    assert_log_before "claude-oss-run" "--dangerously-skip-permissions"
    assert_stdin_closed

    reset_log
    RULE_PENDING='Network Rules:  (version 3, 1 chunks)

  Chunk: 2258b82a-8253-4094-bf5f-3e309b2b9c11
  Status: pending'
    run_cc run "check"
    assert_rc 0
    assert_log_line "agent_policy_proposals_enabled"
    assert_err_has "1 pending network-rule proposal(s) for 'cc-myproject'. Review: claude-oss policy review"

    reset_log
    RULE_PENDING=
    printf 'idle\n' >"$CASE/scan-answer"
    printf 'claude-oss-idle|0|%s\n' "$CASE/scan-answer" >"$CASE/exec-cases"
    EXEC_CASES=$CASE/exec-cases
    ENV_IDLE_STOP=2s
    run_cc run "check"
    assert_rc 0
    if ! wait_for_match "$LOG" '^stop$' 15; then
        bad "no sandbox stop after the idle period"
    fi
    assert_log_has '= claude ]'
    sed -n 's/.*watcher=\([0-9][0-9]*\).*/\1/p' "$(cc_session_dir cc-myproject)/idle.log" 2>/dev/null |
        while read -r cc_pid; do
            pkill -P "$cc_pid" 2>/dev/null || true
            kill "$cc_pid" 2>/dev/null || true
        done
}

test_cc_sync_clean_git() {
    begin "claude-oss applies a clean git session by fast-forward"
    cc_case cc-sync-git
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    seed_sandbox cc-repo Ready
    seed_cc_provider claude-anthropic
    attach_stub_provider cc-repo claude-anthropic
    run_cc upload .
    commit_before=$(git -C "$RUN_DIR" rev-parse HEAD)
    STUB_MAKI_SCRIPT='printf "agent\n" > agent.txt; printf "modified\n" > tracked.txt'

    run_cc run "edit"
    assert_rc 0
    [ "$(cat "$RUN_DIR/tracked.txt")" = modified ] || bad "agent change is not on the host"
    [ "$(cat "$RUN_DIR/agent.txt" 2>/dev/null)" = agent ] || bad "agent file is not on the host"
    [ "$(git -C "$RUN_DIR" rev-parse HEAD^)" = "$commit_before" ] || bad "result commit parent is not the baseline"
    [ "$(git -C "$RUN_DIR" log -1 --format=%s)" = "claude-oss: apply sandbox changes" ] \
        || bad "result commit has the wrong subject"
}

test_cc_sync_dirty_host() {
    begin "claude-oss keeps a dirty host and commits the result on a review branch"
    cc_case cc-sync-dirty
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    printf 'local edit\n' >>"$RUN_DIR/tracked.txt"
    seed_sandbox cc-repo Ready
    seed_cc_provider claude-anthropic
    attach_stub_provider cc-repo claude-anthropic
    STUB_MAKI_SCRIPT='printf "agent edited\n" > tracked.txt'

    run_cc run "edit"
    assert_rc 0
    assert_err_has "Uncommitted host work was not committed"
    cc_branch=$(git -C "$RUN_DIR" for-each-ref --format='%(refname:short)' 'refs/heads/claude-oss/*' | head -n 1)
    [ -n "$cc_branch" ] || bad "result branch was not kept"
    grep -Fq 'local edit' "$RUN_DIR/tracked.txt" || bad "local edit was lost"
    [ -f "$(cc_session_dir cc-repo)/pending" ] || bad "no pending marker for the dirty host"
}

test_cc_sync_plain_directory() {
    begin "claude-oss applies a clean patch to a plain directory"
    cc_case cc-sync-plain
    CC_SEED_FILES='readme.txt=host-version
hostonly.txt=host-only'
    cc_ready_project
    STUB_MAKI_SCRIPT='printf "sandbox-version\n" > readme.txt'

    run_cc run "edit"
    assert_rc 0
    grep -Fq 'sandbox-version' "$RUN_DIR/readme.txt" || bad "the patch did not update the file"
    grep -Fq 'host-only' "$RUN_DIR/hostonly.txt" || bad "a host-only file was removed"
}

test_cc_sync_no_git() {
    begin "claude-oss applies a text patch with patch when the host has no git"
    cc_case cc-sync-nogit
    CC_SEED_FILES='file.txt=v1'
    cc_ready_project
    PATH_OVERRIDE=$(no_git_path with_patch)
    STUB_MAKI_SCRIPT='printf "v2\n" > file.txt'

    run_cc run "edit"
    assert_rc 0
    [ "$(cat "$RUN_DIR/file.txt")" = v2 ] || bad "text patch did not apply without git"
}

# ---------------------------------------------------------------------------
# codex-oss: the Codex front-end over the same core and stubs
# (specs/codex-oss-helper). Same runner pattern as claude-oss: the
# CODEX_OSS_* settings are exported, and the MAKI_OSS_* values the shared
# runner always passes must have no effect.
# ---------------------------------------------------------------------------

CX=$ROOT/bin/codex-oss
CX_ACCOUNT=acct-fixture-4417
CX_THREAD=0199aa00-0000-7000-8000-000000000001

cx_case() { # NAME
    new_case "$1"
    ENV_CX_MODEL=
    ENV_CX_IMAGE=
    ENV_CX_ACCOUNT=
    EXEC_STDIN_LOG=
    ENGINE_EXIT=
    CX_SEED_FILES=
    CX_LOGIN=
    CX_CODEX_LOG=$CASE/codex.log
    REFRESH_STATUS=
    CX_HOME_ENV=
    CX_NAME_PIN='cx-{project}'
}

run_cx_with_input() { # STDIN_FILE ARGS...
    cx_rc=0
    (
        MAKI=$CX
        CODEX_OSS_SANDBOX_NAME=${ENV_NAME:-$CX_NAME_PIN}
        CODEX_OSS_TIMEOUT=${ENV_TIMEOUT:-}
        CODEX_OSS_IDLE_STOP=${ENV_IDLE_STOP-0}
        CODEX_OSS_RUN_TAG=${ENV_RUN_TAG:-}
        CODEX_OSS_WORKDIR=$CASE/sandbox/project
        CODEX_OSS_IMAGE=${ENV_CX_IMAGE:-}
        CODEX_OSS_MODEL=${ENV_CX_MODEL:-}
        CODEX_OSS_ACCOUNT_ID=${ENV_CX_ACCOUNT:-}
        CODEX_OSS_INTERACTIVE=${INTERACTIVE:-}
        STUB_EXEC_STDIN_LOG=${EXEC_STDIN_LOG:-}
        STUB_ENGINE_EXIT=${ENGINE_EXIT:-0}
        STUB_CODEX_LOG=$CX_CODEX_LOG
        STUB_CODEX_LOGIN=${CX_LOGIN:-ok}
        STUB_REFRESH_STATUS=${REFRESH_STATUS:-}
        export CODEX_OSS_SANDBOX_NAME CODEX_OSS_TIMEOUT CODEX_OSS_IDLE_STOP \
            CODEX_OSS_RUN_TAG CODEX_OSS_WORKDIR CODEX_OSS_IMAGE \
            CODEX_OSS_MODEL CODEX_OSS_ACCOUNT_ID CODEX_OSS_INTERACTIVE \
            STUB_EXEC_STDIN_LOG STUB_ENGINE_EXIT STUB_CODEX_LOG \
            STUB_CODEX_LOGIN STUB_REFRESH_STATUS
        unset CODEX_HOME CODEX_CHATGPT_TOKEN CODEX_CHATGPT_ACCOUNT_ID
        if [ -n "${CX_HOME_ENV:-}" ]; then
            CODEX_HOME=$CX_HOME_ENV
            export CODEX_HOME
        fi
        run_maki_with_input "$@"
        exit "$RC"
    ) || cx_rc=$?
    RC=$cx_rc
}

run_cx() {
    run_cx_with_input /dev/null "$@"
}

cx_config() { # LINE
    mkdir -p "$XDG_CONFIG_HOME/codex-oss"
    printf '%s\n' "$1" >>"$XDG_CONFIG_HOME/codex-oss/config.toml"
}

seed_cx_provider() { # NAME
    cx_config "providers = \"$1\""
    mkdir -p "$STUB_STATE_DIR"
    printf '%s\n' "$1" >>"$STUB_STATE_DIR/providers.list"
}

cx_session_dir() { # SANDBOX
    printf '%s/.local/state/osa/sessions/%s' "$HOME" "$1"
}

# A project directory with its Ready sandbox, a remembered and attached
# codex-chatgpt provider, and the account ID provider setup would store.
cx_ready_project() { # [DIR-NAME]
    RUN_DIR=$CASE/project/${1:-myproject}
    mkdir -p "$RUN_DIR"
    while IFS= read -r cx_seed; do
        [ -n "$cx_seed" ] || continue
        printf '%s\n' "${cx_seed#*=}" >"$RUN_DIR/${cx_seed%%=*}"
    done <<CX_SEED
${CX_SEED_FILES:-}
CX_SEED
    seed_sandbox "cx-${1:-myproject}" Ready
    seed_cx_provider codex-chatgpt
    cx_config "account_id = \"$CX_ACCOUNT\""
    attach_stub_provider "cx-${1:-myproject}" codex-chatgpt
}

test_cx_help() {
    begin "codex-oss help lists the shared commands and no Maki, OpenCode, Claude, or fish ones"
    cx_case cx-help
    run_cx help
    assert_rc 0
    for cx_cmd in doctor 'image build' 'init, up' codex 'run "<prompt>"' upload download \
        status list logs 'start, stop' rm 'policy show|edit|apply' 'policy review' \
        'policy approve' 'policy reject' 'provider add|attach|list' 'provider setup' \
        'mcp status' help; do
        if ! grep -Eq "^  $(printf '%s' "$cx_cmd" | sed 's/[|.]/\\&/g')( |$)" "$OUT"; then
            bad "help does not list: $cx_cmd"
        fi
    done
    for cx_cmd in maki opencode claude fish; do
        if grep -Eq "^  $cx_cmd( |$)" "$OUT"; then
            bad "help lists $cx_cmd"
        fi
    done
    assert_out_has "CODEX_OSS_<KEY>"
    assert_out_has "codex-oss/config.toml"

    for cx_cmd in maki opencode claude fish; do
        run_cx "$cx_cmd"
        assert_rc 1
        assert_err_has "unknown command: $cx_cmd"
    done
}

test_cx_run_argv() {
    begin "codex-oss run launches codex exec --json with bypass, the account ID, and stdin closed"
    cx_case cx-run
    cx_ready_project
    EXEC_STDOUT='{"type":"turn.completed"}'
    EXEC_STDIN_LOG=$CASE/exec-stdin
    printf 'LEAKED-STDIN\n' >"$CASE/stdin.txt"

    run_cx_with_input "$CASE/stdin.txt" run "reply OK"
    assert_rc 0
    assert_out_has '{"type":"turn.completed"}'
    assert_stdin_closed
    for cx_word in codex exec --json --skip-git-repo-check \
        --dangerously-bypass-approvals-and-sandbox "reply OK" \
        "CODEX_CHATGPT_ACCOUNT_ID=$CX_ACCOUNT"; do
        assert_log_line "$cx_word"
    done
    assert_log_before "exec" "--json"
    assert_log_before "--dangerously-bypass-approvals-and-sandbox" "reply OK"
    # (-c and exec also name the core's own sh -c and sandbox exec calls.)
    for cx_word in -m resume --config --profile --ignore-rules --dangerously-bypass-hook-trust --oss; do
        assert_log_line_missing "$cx_word"
    done

    reset_log
    ENV_CX_MODEL=gpt-5.6-terra
    run_cx run "reply OK"
    assert_rc 0
    assert_log_line "-m"
    assert_log_line "gpt-5.6-terra"
    assert_log_before "-m" "reply OK"

    reset_log
    EXEC_EXIT=3
    EXEC_STDOUT='partial'
    run_cx run "fail please"
    assert_rc 3
    assert_out_has "partial"
}

test_cx_tui_argv() {
    begin "bare codex-oss attaches codex with bypass and the configured model"
    cx_case cx-tui
    cx_ready_project
    cx_config 'model = "gpt-6-astra"'

    run_cx
    assert_rc 0
    assert_log_line "--tty"
    assert_log_line "codex"
    assert_log_line "--dangerously-bypass-approvals-and-sandbox"
    assert_log_line "-m"
    assert_log_line "gpt-6-astra"
    assert_log_line "CODEX_CHATGPT_ACCOUNT_ID=$CX_ACCOUNT"
    assert_log_line_missing "--json"
    assert_log_line_missing "--skip-git-repo-check"
    # The helper writes the model nowhere.
    if grep -rqs 'gpt-6-astra' "$RUN_DIR" "$SANDBOX_WORKDIR"; then
        bad "the helper wrote the model into the project"
    fi

    reset_log
    run_cx codex
    assert_rc 0
    assert_log_line "--tty"
    run_cx codex extra
    assert_rc 1
    assert_err_has "codex takes no arguments"
}

test_cx_session_flags() {
    begin "codex-oss maps --continue and --resume to codex resume and refuses --session-id"
    cx_case cx-session
    cx_ready_project

    run_cx run --continue "next"
    assert_rc 0
    assert_log_line "resume"
    assert_log_line "--last"
    assert_log_before "exec" "resume"
    assert_log_before "--last" "--json"
    assert_log_before "--json" "next"
    assert_log_line_missing "--include-non-interactive"

    reset_log
    run_cx --continue
    assert_rc 0
    assert_log_line "--tty"
    assert_log_line "resume"
    assert_log_line "--last"
    assert_log_line "--include-non-interactive"

    reset_log
    run_cx run --resume "$CX_THREAD" "next"
    assert_rc 0
    assert_log_line "resume"
    assert_log_line "$CX_THREAD"
    assert_log_before "--dangerously-bypass-approvals-and-sandbox" "$CX_THREAD"
    assert_log_before "$CX_THREAD" "next"
    assert_log_line_missing "--last"

    reset_log
    run_cx -r "$CX_THREAD"
    assert_rc 0
    assert_log_line "--tty"
    assert_log_line "$CX_THREAD"

    for cx_flags in "--session-id abc" "--continue --resume x"; do
        reset_log
        # shellcheck disable=SC2086  # the flag list splits on purpose
        run_cx run $cx_flags "x"
        assert_rc 1
        if [ -s "$LOG" ]; then
            bad "gateway was contacted for '$cx_flags'"
        fi
        reset_log
        # shellcheck disable=SC2086
        run_cx $cx_flags
        assert_rc 1
        if [ -s "$LOG" ]; then
            bad "gateway was contacted for the session with '$cx_flags'"
        fi
    done
    run_cx run --session-id abc "x"
    assert_err_has "--session-id is not supported"
    assert_err_has "--resume"

    # No account ID configured: refused before any sandbox work.
    cx_case cx-session-noaccount
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox cx-myproject Ready
    seed_cx_provider codex-chatgpt
    attach_stub_provider cx-myproject codex-chatgpt
    run_cx run "hi"
    assert_rc 1
    assert_err_has "codex-oss provider setup"
    if [ -s "$LOG" ]; then
        bad "gateway was contacted without an account ID"
    fi
    reset_log
    ENV_CX_ACCOUNT=acct-from-env
    run_cx run "hi"
    assert_rc 0
    assert_log_line "CODEX_CHATGPT_ACCOUNT_ID=acct-from-env"
}

test_cx_image_build() {
    begin "codex-oss image build builds codex-oss/image as codex-agent:local"
    cx_case cx-image
    cx_config 'image = "my-env:latest"'
    run_cx image build
    assert_rc 0
    assert_log_line "build"
    assert_log_line "codex-agent:local"
    assert_log_line "$ROOT/codex-oss/image"
    assert_log_line_missing "--build-arg"
    assert_log_line_missing "my-env:latest"

    reset_log
    run_cx image build --codex-version 9.9.9
    assert_rc 0
    assert_log_line "--build-arg"
    assert_log_line "CODEX_VERSION=9.9.9"

    reset_log
    ENGINE_EXIT=1
    run_cx image build --codex-version 9.9.9
    assert_rc 2
    assert_err_has "CODEX_SHA256_ARM64/AMD64"
    assert_err_has "CODEX_HOST_SHA256_ARM64/AMD64"
    assert_err_has "image build failed"

    run_cx image build --claude-version 1
    assert_rc 1
    assert_err_has "unknown option: --claude-version"
}

test_cx_profiles_and_catalogs() {
    begin "codex-oss profiles bind codex, refresh on the gateway, and the catalogs match"
    cx_case cx-catalogs
    cx_dir=$ROOT/codex-oss/providers
    for cx_profile in "$cx_dir"/codex-*.yaml "$cx_dir/template.yaml"; do
        cx_bins=$(awk '/^binaries:/{b=1;next} b&&/^  - /{print $2;next} {b=0}' "$cx_profile")
        [ "$cx_bins" = /usr/local/bin/codex ] || bad "$(basename -- "$cx_profile") binds: $cx_bins"
    done
    cx_p=$cx_dir/codex-chatgpt.yaml
    grep -q 'env_vars: \[CODEX_CHATGPT_TOKEN\]' "$cx_p" || bad "the profile does not bind CODEX_CHATGPT_TOKEN"
    grep -q 'auth_style: bearer' "$cx_p" || bad "the profile is not bearer"
    grep -q 'strategy: oauth2_refresh_token' "$cx_p" || bad "the profile has no gateway refresh"
    grep -q 'token_url: https://auth.openai.com/oauth/token' "$cx_p" || bad "the refresh token_url is wrong"
    grep -q 'max_lifetime: "864000s"' "$cx_p" || bad "the refresh has no 240 h max_lifetime"
    grep -q 'path: /backend-api/codex/\*\*' "$cx_p" || bad "the endpoint is not scoped to the Codex backend"
    grep -q 'host: chatgpt.com' "$cx_p" || bad "the endpoint host is not chatgpt.com"
    while IFS=$(printf '\t') read -r cx_store _ cx_id _; do
        case $cx_store in ''|'#'*) continue ;; esac
        bad "stores.tsv has a row ($cx_id): no store holds a ChatGPT login"
    done <"$cx_dir/stores.tsv"
    for cx_profile in "$cx_dir"/codex-*.yaml; do
        cx_id=$(basename -- "$cx_profile" .yaml)
        grep -q "^$cx_id	" "$cx_dir/catalog.tsv" || bad "catalog.tsv has no row for $cx_id"
    done
    while IFS=$(printf '\t') read -r cx_id _; do
        case $cx_id in ''|'#'*) continue ;; esac
        [ -f "$cx_dir/$cx_id.yaml" ] || bad "catalog.tsv names a missing profile: $cx_id"
    done <"$cx_dir/catalog.tsv"
    # The image carries no credential, account ID, or login state.
    if grep -vE '^[[:space:]]*#' "$ROOT/codex-oss/image/managed_config.toml" \
        | grep -qE '^[[:space:]]*(account_id|access_token|refresh_token|api_key)[[:space:]]*=|acct-|eyJ'; then
        bad "managed_config.toml names a credential or login state"
    fi
    # No file under codex-oss/ or its docs spells the placeholder prefix.
    cx_needle=$(printf 'openshell:resolve'':env:')
    if cx_hits=$(grep -rlF -- "$cx_needle" "$ROOT/codex-oss" "$ROOT/docs/codex-oss.md" 2>/dev/null); then
        bad "placeholder prefix spelled in: $cx_hits"
    fi
}

test_cx_codex_stub() {
    begin "the codex login stub writes a ChatGPT login, fails, or interrupts its caller"
    cx_case cx-codex-stub
    cx_stub_home=$CASE/stub-home
    mkdir -p "$cx_stub_home"
    CODEX_HOME=$cx_stub_home STUB_CODEX_LOG=$CX_CODEX_LOG "$STUB_DIR/codex" login >/dev/null 2>&1 \
        || bad "the ok mode failed"
    [ "$(jq -r .tokens.refresh_token "$cx_stub_home/auth.json")" = fixture-codex-refresh-7c1d ] \
        || bad "the ok mode wrote no refresh token"
    grep -Fqx "CODEX_HOME=$cx_stub_home" "$CX_CODEX_LOG" || bad "the stub did not log CODEX_HOME"
    rm -f "$cx_stub_home/auth.json"
    if CODEX_HOME=$cx_stub_home STUB_CODEX_LOGIN=fail "$STUB_DIR/codex" login >/dev/null 2>&1; then
        bad "the fail mode succeeded"
    fi
    [ ! -e "$cx_stub_home/auth.json" ] || bad "the fail mode wrote auth.json"
    if CODEX_HOME=$CASE/missing "$STUB_DIR/codex" login >/dev/null 2>&1; then
        bad "the stub accepted a missing CODEX_HOME"
    fi
    cx_int_rc=0
    sh -c 'trap "exit 130" INT; CODEX_HOME=$1 STUB_CODEX_LOGIN=interrupt "$2/codex" login >/dev/null 2>&1; exit 0' \
        sh "$cx_stub_home" "$STUB_DIR" || cx_int_rc=$?
    [ "$cx_int_rc" = 130 ] || bad "the interrupt mode did not interrupt its caller (rc $cx_int_rc)"
}

test_cx_provider_setup() {
    begin "codex-oss provider setup logs in on the host and configures gateway refresh"
    cx_case cx-setup
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    # A host Codex login that must never be read or changed.
    mkdir -p "$HOME/.codex"
    printf '{"tokens":{"access_token":"fixture-host-codex-access","refresh_token":"fixture-host-codex-refresh"}}\n' \
        >"$HOME/.codex/auth.json"
    cx_host_sum=$(cksum <"$HOME/.codex/auth.json")
    CREDENTIAL_ENV='CODEX_CHATGPT_TOKEN CODEX_OSS_REFRESH_TOKEN'
    CREDENTIAL_LOG=$CASE/credential-env.log

    run_cx provider setup --yes
    assert_rc 0
    assert_log_line "$ROOT/codex-oss/providers/codex-chatgpt.yaml"
    assert_log_line "create"
    assert_log_line "codex-chatgpt"
    assert_log_line "--credential"
    assert_log_line "CODEX_CHATGPT_TOKEN"
    assert_log_line "refresh"
    assert_log_line "configure"
    assert_log_line "client_id=app_fixtureclient"
    assert_log_line "1793885131000"
    assert_log_line "refresh_token=CODEX_OSS_REFRESH_TOKEN"
    assert_log_before "create" "configure"
    grep -Fxq "account_id = \"$CX_ACCOUNT\"" "$XDG_CONFIG_HOME/codex-oss/config.toml" 2>/dev/null \
        || bad "account_id was not written to the codex-oss config"
    grep -Fxq 'providers = "codex-chatgpt"' "$XDG_CONFIG_HOME/codex-oss/config.toml" 2>/dev/null \
        || bad "the provider was not recorded in the codex-oss config"
    assert_out_has "example model: gpt-6-astra"
    # The login ran in a throwaway home that is gone now.
    cx_login_home=$(sed -n 's/^CODEX_HOME=//p' "$CX_CODEX_LOG" | head -n 1)
    case $cx_login_home in
        ''|"$HOME/.codex") bad "the login did not use a throwaway CODEX_HOME ($cx_login_home)" ;;
    esac
    [ ! -e "$cx_login_home" ] || bad "the throwaway CODEX_HOME was not removed"
    grep -Fqx 'cli_auth_credentials_store="file"' "$CX_CODEX_LOG" || bad "the login did not use file storage"
    # Token values travel only in the child environment.
    grep -Fq 'fixture-codex-refresh-7c1d' "$CREDENTIAL_LOG" 2>/dev/null \
        || bad "the refresh token did not reach refresh configure"
    cx_access=$(grep -vx 'fixture-codex-refresh-7c1d' "$CREDENTIAL_LOG" 2>/dev/null | head -n 1)
    case $cx_access in
        *.*.*) ;;
        *) bad "the access token did not reach provider create"; cx_access=fixture-codex-refresh-7c1d ;;
    esac
    assert_secret_absent fixture-codex-refresh-7c1d
    assert_secret_absent "$cx_access"
    if grep -rqsF -e fixture-codex-refresh-7c1d -e "$cx_access" "$XDG_CONFIG_HOME" "$RUN_DIR"; then
        bad "a token was written to a file"
    fi
    # The host login was neither read nor changed.
    for cx_host in fixture-host-codex-access fixture-host-codex-refresh; do
        assert_secret_absent "$cx_host"
        if grep -Fq -- "$cx_host" "$CREDENTIAL_LOG" 2>/dev/null; then
            bad "the host Codex login reached the provider flow"
        fi
    done
    [ "$(cksum <"$HOME/.codex/auth.json")" = "$cx_host_sum" ] || bad "the host ~/.codex/auth.json changed"
}

test_cx_provider_setup_rerun_and_errors() {
    begin "codex-oss provider setup re-runs, device auth, interrupts, and refuses other sources"
    cx_case cx-setup-rerun
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    run_cx provider setup --yes
    assert_rc 0

    # A second run replaces the login: update, then a fresh refresh configure.
    reset_log
    : >"$CX_CODEX_LOG"
    run_cx provider setup --yes --device-auth
    assert_rc 0
    assert_log_line "update"
    assert_log_line_missing "create"
    assert_log_before "delete" "configure"
    assert_out_has "ChatGPT > Settings > Security"
    grep -Fqx -- '--device-auth' "$CX_CODEX_LOG" || bad "--device-auth did not reach codex login"
    if [ "$(grep -c '^account_id' "$XDG_CONFIG_HOME/codex-oss/config.toml")" -ne 1 ]; then
        bad "account_id was written more than once"
    fi

    # Without --yes and without a terminal, an existing provider is kept.
    reset_log
    run_cx provider setup
    assert_rc 1
    assert_err_has "pass --yes"

    # An interrupted login leaves no throwaway home and no provider change.
    cx_case cx-setup-interrupt
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    CX_LOGIN=interrupt
    run_cx provider setup --yes
    [ "$RC" = 130 ] || bad "an interrupted login exited $RC, not 130"
    cx_login_home=$(sed -n 's/^CODEX_HOME=//p' "$CX_CODEX_LOG" | head -n 1)
    [ -n "$cx_login_home" ] && [ ! -e "$cx_login_home" ] || bad "the throwaway CODEX_HOME was left behind"
    assert_log_missing "create"
    assert_log_missing "configure"

    # A failed login changes nothing.
    reset_log
    CX_LOGIN=fail
    run_cx provider setup --yes
    assert_rc 2
    assert_err_has "codex login failed"
    assert_log_missing "create"

    # An API-key login has no ChatGPT tokens.
    reset_log
    CX_LOGIN=apikey
    run_cx provider setup --yes
    assert_rc 2
    assert_err_has "no ChatGPT tokens"
    assert_log_missing "create"
    assert_secret_absent fixture-codex-apikey

    # Credential sources of the other front-ends are refused.
    CX_LOGIN=
    for cx_source in "--from maki --credential openai" "--file $CASE/x.json" "--env OPENAI_API_KEY"; do
        reset_log
        # shellcheck disable=SC2086  # the source splits on purpose
        run_cx provider setup $cx_source --yes
        assert_rc 1
        assert_err_has "logs in to ChatGPT on the host"
        assert_log_missing "create"
    done

    # No host codex binary.
    reset_log
    cx_bin=$CASE/no-codex-bin
    mkdir -p "$cx_bin"
    for cx_tool in openshell jq; do
        ln -sf "$(PATH=$STUB_DIR:$PATH command -v "$cx_tool")" "$cx_bin/$cx_tool"
    done
    PATH_OVERRIDE=$cx_bin:/usr/bin:/bin
    run_cx provider setup --yes
    assert_rc 2
    assert_err_has "codex not found on PATH"
}

test_cx_doctor() {
    begin "codex-oss doctor reports the model, the account, and the gateway refresh health"
    cx_case cx-doctor
    cx_ready_project
    printf 'codex-chatgpt\n' >>"$STUB_STATE_DIR/providers.list"
    cx_head='PROVIDER                  CREDENTIAL_KEY                STRATEGY                      STATUS                    RECOVERY            EXPIRES_AT            NEXT_REFRESH          LAST_REFRESH          FAILURE_CODE                                  LAST_ERROR'
    cx_row() { # STATUS EXPIRES LAST FAILURE
        printf '%s\ncodex-chatgpt             CODEX_CHATGPT_TOKEN           oauth2_refresh_token          %s                 -                   %s   2099-01-01 00:00:00   %s   %s                                   -' \
            "$cx_head" "$1" "$2" "$3" "$4"
    }

    REFRESH_STATUS=$(cx_row refreshed '2099-01-10 00:00:00' '2099-01-01 00:00:00' -)
    run_cx doctor
    assert_out_has "ok    model: Codex's default"
    assert_out_has "ok    account: ChatGPT account ID configured"
    assert_out_has "ok    refresh: codex-chatgpt refreshed, expires 2099-01-10 00:00:00 UTC"
    cx_doctor_rc=$RC

    # The gateway's 1 h assumption with a 300 s lead time: hourly, healthy.
    REFRESH_STATUS=$(cx_row refreshed '2099-01-01 01:00:00' '2099-01-01 00:00:00' -)
    run_cx doctor
    assert_out_has "ok    refresh: codex-chatgpt refreshed"
    assert_out_missing "refreshes continuously"
    REFRESH_STATUS=$(cx_row refreshed '2099-01-01 00:04:00' '2099-01-01 00:00:00' -)
    run_cx doctor
    assert_out_has "refreshes continuously"
    [ "$RC" = "$cx_doctor_rc" ] || bad "the warning changed the doctor exit code ($cx_doctor_rc -> $RC)"

    REFRESH_STATUS=$(cx_row failed '2099-01-10 00:00:00' '2099-01-01 00:00:00' invalid_grant)
    run_cx doctor
    assert_out_has "warn  refresh: codex-chatgpt last refresh failed"

    cx_soon=$(date -u -d '@'"$(( $(date -u +%s) + 3600 ))" '+%Y-%m-%d %H:%M:%S' 2>/dev/null \
        || date -u -r "$(( $(date -u +%s) + 3600 ))" '+%Y-%m-%d %H:%M:%S')
    REFRESH_STATUS=$(cx_row configured "$cx_soon" - -)
    run_cx doctor
    assert_out_has "in under 24 hours"

    REFRESH_STATUS="No refresh configurations found for provider 'codex-chatgpt'."
    run_cx doctor
    assert_out_has "warn  refresh: codex-chatgpt has no gateway refresh"
    [ "$RC" = "$cx_doctor_rc" ] || bad "the warning changed the doctor exit code ($cx_doctor_rc -> $RC)"

    cx_config 'model = "gpt-6-astra"'
    run_cx doctor
    assert_out_has "ok    model: gpt-6-astra"

    # Without the provider, the refresh check is skipped.
    cx_case cx-doctor-noprovider
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    run_cx doctor
    assert_out_missing "refresh:"
    assert_out_has "warn  account: no ChatGPT account ID"
}

seed_cx_host_mcp() { # TOML [DIR]
    cx_mcp_dir=${2:-$HOME/.codex}
    mkdir -p "$cx_mcp_dir"
    printf '%s\n' "$1" >"$cx_mcp_dir/config.toml"
}

CX_HOST_MCP='model = "gpt-6-astra"

[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"

[mcp_servers.local]
command = "/usr/local/bin/local-mcp"
args = []

[mcp_servers."off"]
command = "off-mcp"
enabled = false'

test_cx_mcp_status() {
    begin "codex-oss mcp status compares [mcp_servers.<name>] in the host and sandbox config.toml"
    cx_case cx-mcp
    cx_ready_project
    seed_cx_host_mcp "$CX_HOST_MCP"
    EXEC_STDOUT='model = "x"'

    run_cx mcp status
    assert_rc 3
    assert_out_has "context7: sandbox=missing"
    assert_out_has "fix: codex-oss provider attach codex-mcp-context7"
    assert_out_has "an environment image built FROM codex-agent:local"
    assert_out_has "local: sandbox=missing"
    assert_out_missing "off: sandbox=missing"
    assert_log_line "/sandbox/.codex/config.toml"

    reset_log
    attach_stub_provider cx-myproject codex-mcp-context7
    EXEC_STDOUT='[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"'
    seed_cx_host_mcp "$EXEC_STDOUT"
    POLICY_FULL='host: mcp.context7.com'
    run_cx mcp status
    assert_rc 0
    assert_out_has "context7: sandbox=ok provider=ok endpoint=ok transport=http"

    # CODEX_HOME selects the host file.
    seed_cx_host_mcp '[mcp_servers.other]
url = "https://other.test/mcp"' "$CASE/codexhome"
    CX_HOME_ENV=$CASE/codexhome
    run_cx mcp status
    assert_out_has "other: sandbox=missing"
    CX_HOME_ENV=

    # Inline tables are not read: the file is reported as unreadable.
    seed_cx_host_mcp 'mcp_servers = { docs = { url = "https://docs.test/mcp" } }'
    run_cx mcp status
    assert_rc 3
    assert_out_has "unreadable: host config $HOME/.codex/config.toml"
}

test_cx_isolation_and_registry() {
    begin "codex-oss keeps its own sandbox, config, and state, and registers as cx"
    cx_case cx-isolation
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    ENV_IMAGE=maki-only:tag

    run_cx up
    assert_rc 0
    assert_log_line "cx-myproject"
    assert_log_line "codex-agent:local"
    assert_log_line "$ROOT/codex-oss/policies/minimal.yaml"
    assert_log_line_missing "maki-only:tag"
    [ "$(registry_value cx-myproject agent)" = cx ] || bad "the registry entry is not agent cx"

    reset_log
    reset_state
    ENV_CX_IMAGE=custom:tag
    run_cx up
    assert_rc 0
    assert_log_line "custom:tag"

    reset_state
    cx_ready_project
    run_cx run "touch nothing"
    assert_rc 0
    [ -d "$(cx_session_dir cx-myproject)" ] || bad "no codex-oss session state"
    [ ! -e "$HOME/.local/state/codex-oss" ] || bad "codex-oss wrote a per-tool state root"
    [ ! -e "$HOME/.local/state/maki-oss" ] || bad "codex-oss wrote a maki-oss state root"
    [ -d "$CASE/sandbox/.codex-oss/git" ] || bad "the sandbox baseline is not under .codex-oss"
    for cx_other in maki-oss opencode-oss claude-oss; do
        [ ! -e "$XDG_CONFIG_HOME/$cx_other" ] || bad "codex-oss wrote the $cx_other config"
    done

    run_osa projects --json
    assert_rc 0
    assert_out_has '"agent":"cx"'
    run_cx status
    cx_sync=$(sed -n 's/^Sync: *//p' "$OUT" | awk '{print $1}')
    (
        CODEX_OSS_WORKDIR=$CASE/sandbox/project
        export CODEX_OSS_WORKDIR
        run_osa status --json
        exit "$RC"
    ) || RC=$?
    assert_rc 0
    assert_out_has "\"sync\":\"$cx_sync\""
}

test_cx_lifecycle_and_guard() {
    begin "codex-oss up/status/rm, the --env guard, and the no-provider refusal"
    cx_case cx-lifecycle
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"

    run_cx up --env CODEX_CHATGPT_TOKEN=x
    assert_rc 1
    assert_err_has "CODEX_CHATGPT_TOKEN"
    assert_log_missing "create"
    run_cx up --env CODEX_CHATGPT_TOKEN=x --allow-env CODEX_CHATGPT_TOKEN
    assert_rc 0
    assert_log_line "CODEX_CHATGPT_TOKEN=x"

    run_cx status
    assert_rc 0
    assert_out_has "Exists:    yes"
    assert_out_has "codex-agent:local (configured)"

    reset_log
    run_cx rm
    assert_rc 1
    assert_log_missing "delete"
    run_cx rm --yes
    assert_rc 0
    assert_log_line "delete"

    reset_log
    cx_config "account_id = \"$CX_ACCOUNT\""
    run_cx
    assert_rc 1
    assert_err_has "codex-oss provider setup"
    if [ -s "$LOG" ]; then
        bad "gateway was contacted without a provider"
    fi
}

test_cx_timeout_proposals_idle() {
    begin "codex-oss run --timeout wraps codex; proposals surface; idle stop waits on codex"
    cx_case cx-timeout
    cx_ready_project
    EXEC_STDIN_LOG=$CASE/exec-stdin
    printf 'LEAKED-STDIN\n' >"$CASE/stdin.txt"

    run_cx_with_input "$CASE/stdin.txt" run --timeout 30 "check"
    assert_rc 0
    assert_log_line "codex-oss-run"
    assert_log_has "/tmp/codex-oss-stop/"
    assert_log_before "codex-oss-run" "--dangerously-bypass-approvals-and-sandbox"
    assert_stdin_closed

    reset_log
    RULE_PENDING='Network Rules:  (version 3, 1 chunks)

  Chunk: 2258b82a-8253-4094-bf5f-3e309b2b9c11
  Status: pending'
    run_cx run "check"
    assert_rc 0
    assert_log_line "agent_policy_proposals_enabled"
    assert_err_has "1 pending network-rule proposal(s) for 'cx-myproject'. Review: codex-oss policy review"

    reset_log
    RULE_PENDING=
    printf 'idle\n' >"$CASE/scan-answer"
    printf 'codex-oss-idle|0|%s\n' "$CASE/scan-answer" >"$CASE/exec-cases"
    EXEC_CASES=$CASE/exec-cases
    ENV_IDLE_STOP=2s
    run_cx run "check"
    assert_rc 0
    if ! wait_for_match "$LOG" '^stop$' 15; then
        bad "no sandbox stop after the idle period"
    fi
    assert_log_has '= codex ]'
    sed -n 's/.*watcher=\([0-9][0-9]*\).*/\1/p' "$(cx_session_dir cx-myproject)/idle.log" 2>/dev/null |
        while read -r cx_pid; do
            pkill -P "$cx_pid" 2>/dev/null || true
            kill "$cx_pid" 2>/dev/null || true
        done
}

test_cx_sync_clean_git() {
    begin "codex-oss applies a clean git session by fast-forward"
    cx_case cx-sync-git
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    seed_sandbox cx-repo Ready
    seed_cx_provider codex-chatgpt
    cx_config "account_id = \"$CX_ACCOUNT\""
    attach_stub_provider cx-repo codex-chatgpt
    run_cx upload .
    commit_before=$(git -C "$RUN_DIR" rev-parse HEAD)
    STUB_MAKI_SCRIPT='printf "agent\n" > agent.txt; printf "modified\n" > tracked.txt'

    run_cx run "edit"
    assert_rc 0
    [ "$(cat "$RUN_DIR/tracked.txt")" = modified ] || bad "agent change is not on the host"
    [ "$(cat "$RUN_DIR/agent.txt" 2>/dev/null)" = agent ] || bad "agent file is not on the host"
    [ "$(git -C "$RUN_DIR" rev-parse HEAD^)" = "$commit_before" ] || bad "result commit parent is not the baseline"
    [ "$(git -C "$RUN_DIR" log -1 --format=%s)" = "codex-oss: apply sandbox changes" ] \
        || bad "result commit has the wrong subject"
}

test_cx_sync_dirty_host() {
    begin "codex-oss keeps a dirty host and commits the result on a review branch"
    cx_case cx-sync-dirty
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    printf 'local edit\n' >>"$RUN_DIR/tracked.txt"
    seed_sandbox cx-repo Ready
    seed_cx_provider codex-chatgpt
    cx_config "account_id = \"$CX_ACCOUNT\""
    attach_stub_provider cx-repo codex-chatgpt
    STUB_MAKI_SCRIPT='printf "agent edited\n" > tracked.txt'

    run_cx run "edit"
    assert_rc 0
    assert_err_has "Uncommitted host work was not committed"
    cx_branch=$(git -C "$RUN_DIR" for-each-ref --format='%(refname:short)' 'refs/heads/codex-oss/*' | head -n 1)
    [ -n "$cx_branch" ] || bad "result branch was not kept"
    grep -Fq 'local edit' "$RUN_DIR/tracked.txt" || bad "local edit was lost"
    [ -f "$(cx_session_dir cx-repo)/pending" ] || bad "no pending marker for the dirty host"
}

test_cx_sync_plain_directory() {
    begin "codex-oss applies a clean patch to a plain directory"
    cx_case cx-sync-plain
    CX_SEED_FILES='readme.txt=host-version
hostonly.txt=host-only'
    cx_ready_project
    STUB_MAKI_SCRIPT='printf "sandbox-version\n" > readme.txt'

    run_cx run "edit"
    assert_rc 0
    grep -Fq 'sandbox-version' "$RUN_DIR/readme.txt" || bad "the patch did not update the file"
    grep -Fq 'host-only' "$RUN_DIR/hostonly.txt" || bad "a host-only file was removed"
}

test_cx_sync_no_git() {
    begin "codex-oss applies a text patch with patch when the host has no git"
    cx_case cx-sync-nogit
    CX_SEED_FILES='file.txt=v1'
    cx_ready_project
    PATH_OVERRIDE=$(no_git_path with_patch)
    STUB_MAKI_SCRIPT='printf "v2\n" > file.txt'

    run_cx run "edit"
    assert_rc 0
    [ "$(cat "$RUN_DIR/file.txt")" = v2 ] || bad "text patch did not apply without git"
}

test_sandbox_id_recorded() {
    begin "a session records the sandbox ID and status reads it back"
    new_case sandbox-id
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub
    id_before=$(cat "$STUB_STATE_DIR/ids/maki-repo")

    run_maki run "hi"
    assert_rc 0
    [ "$(baseline_value maki-repo sandbox_id)" = "$id_before" ] \
        || bad "the baseline did not record the sandbox ID"
    [ "$(synced_value maki-repo sandbox_id)" = "$id_before" ] \
        || bad "the synced marker did not record the sandbox ID"

    reset_log
    run_maki status
    assert_rc 0
    assert_out_has "Sync:      clean"
    assert_log_has "get"
}

test_legacy_retained_marker() {
    begin "a pending marker with a patch and no kind becomes retained and non-blocking"
    new_case legacy-retained
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    run_maki upload .
    assert_rc 0
    state=$(session_dir maki-myproject)
    legacy_patch=$state/patch-legacy.patch
    printf 'legacy patch\n' >"$legacy_patch"
    printf 'version = "1"\npatch = "%s"\nsandbox = "maki-myproject"\ncreated = "2026-01-01T00:00:00Z"\nreason = "apply failed"\n' \
        "$legacy_patch" >"$state/pending"

    reset_log
    run_maki maki
    assert_rc 0
    assert_err_missing "is parked"
    assert_err_has "Retained patch for review"
    assert_log_missing "upload"
    assert_log_line "maki"
    [ "$(cat "$RUN_DIR/file.txt")" = base ] || bad "the legacy patch was applied"
}

test_legacy_parked_marker() {
    begin "a pending marker without a patch or kind stays parked"
    new_case legacy-parked
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    run_maki upload .
    assert_rc 0
    state=$(session_dir maki-myproject)
    printf 'version = "1"\npatch = ""\nsandbox = "maki-myproject"\ncreated = "2026-01-01T00:00:00Z"\nreason = "collection failed"\n' \
        >"$state/pending"

    reset_log
    STUB_MAKI_SCRIPT='printf "ran\n" > ran.txt'
    run_maki maki
    assert_rc 1
    assert_err_has "is parked"
    assert_log_line_missing "maki"
    [ ! -e "$RUN_DIR/ran.txt" ] || bad "Maki ran in a parked workspace"
}

test_status_clean_and_behind() {
    begin "status reports clean and behind as the host moves"
    new_case status-clean-behind
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub
    run_maki upload .
    assert_rc 0

    reset_log
    run_maki status
    assert_rc 0
    assert_out_has "Sync:      clean"
    assert_out_has "Next:      maki-oss"

    printf 'host-change\n' >>"$RUN_DIR/tracked.txt"
    run_maki status
    assert_rc 0
    assert_out_has "Sync:      behind"
    assert_out_has "refreshes the workspace"
}

test_status_retained() {
    begin "status reports a retained patch path"
    new_case status-retained
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    PATH_OVERRIDE=$(no_git_path)
    STUB_MAKI_SCRIPT='printf "agent\n" > file.txt'
    run_maki maki
    assert_rc 0
    retained_patch=$(pending_value maki-myproject patch)
    [ -n "$retained_patch" ] || bad "the retained patch path is missing"

    PATH_OVERRIDE=
    reset_log
    run_maki status
    assert_rc 0
    assert_out_has "Sync:      retained"
    assert_out_has "Patch:     $retained_patch"
    assert_out_has "refreshes before the next session"
}

test_status_parked() {
    begin "status reports a parked workspace and the discard command"
    new_case status-parked
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    STUB_MAKI_SCRIPT='printf "agent\n" > file.txt'
    run_maki maki --no-sync
    assert_rc 0

    reset_log
    run_maki status
    assert_rc 0
    assert_out_has "Sync:      parked"
    assert_out_has "Discard:   maki-oss upload --discard"
    assert_out_has "Next:      maki-oss download"
}

test_sandbox_id_mismatch_archives_state() {
    begin "a changed sandbox ID archives the previous instance state"
    new_case id-mismatch
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    STUB_MAKI_SCRIPT='printf "agent\n" > file.txt'
    run_maki maki --no-sync
    assert_rc 0
    [ "$(pending_value maki-myproject kind)" = parked ] \
        || bad "the workspace was not parked"

    # The same name now stands for a new, empty sandbox instance.
    printf 'id-recreated\n' >"$STUB_STATE_DIR/ids/maki-myproject"
    rm -rf "$CASE/sandbox"
    reset_log
    STUB_MAKI_SCRIPT=
    run_maki maki
    assert_rc 0
    assert_err_has "Archived the previous sandbox state"
    assert_err_missing "is parked"
    assert_log_has "upload"
    assert_log_line "maki"
    archive=$(find "$(dirname "$(session_dir maki-myproject)")" \
        -maxdepth 1 -name 'maki-myproject.archive-*' -type d 2>/dev/null | head -n 1)
    [ -n "$archive" ] || bad "the previous instance state was not archived"
}

test_rm_parked_guard_and_recreate() {
    begin "rm refuses a parked workspace and a recreated sandbox starts clean"
    new_case rm-recreate
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    STUB_MAKI_SCRIPT='printf "agent\n" > file.txt'
    PATH_OVERRIDE=$(no_git_path)
    run_maki maki
    assert_rc 0
    [ "$(pending_value maki-myproject kind)" = retained ] \
        || bad "the patch was not retained"
    retained_patch=$(pending_value maki-myproject patch)
    [ -f "$retained_patch" ] || bad "the retained patch file is missing"
    PATH_OVERRIDE=
    STUB_MAKI_SCRIPT='printf "agent\n" > file.txt'
    run_maki maki --no-sync
    assert_rc 0
    [ "$(pending_value maki-myproject kind)" = parked ] \
        || bad "the workspace was not parked"

    reset_log
    run_maki rm --yes
    assert_rc 1
    assert_err_has "the workspace is parked"
    assert_err_has "--discard"
    assert_log_missing "delete"
    [ -f "$STUB_STATE_DIR/sandboxes/maki-myproject" ] \
        || bad "the sandbox was deleted despite the parked guard"

    run_maki rm --yes --discard
    assert_rc 0
    assert_log_line "delete"
    [ ! -f "$STUB_STATE_DIR/sandboxes/maki-myproject" ] \
        || bad "the sandbox was not deleted"
    archive=$(find "$(dirname "$(session_dir maki-myproject)")" \
        -maxdepth 1 -name 'maki-myproject.archive-*' -type d 2>/dev/null | head -n 1)
    [ -n "$archive" ] || bad "rm did not archive the state directory"
    [ -f "$archive/$(basename -- "$retained_patch")" ] \
        || bad "rm deleted the retained patch file"

    reset_log
    STUB_MAKI_SCRIPT=
    run_maki run "hi"
    assert_rc 0
    assert_err_missing "is parked"
    assert_log_has "upload"
    new_id=$(cat "$STUB_STATE_DIR/ids/maki-myproject")
    [ "$(baseline_value maki-myproject sandbox_id)" = "$new_id" ] \
        || bad "the recreated sandbox ID was not recorded"
}

test_upload_prunes_tracked_deletion() {
    begin "upload removes a tracked deletion and keeps gitignored artifacts"
    new_case prune-repo
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    printf 'node_modules/\n' >"$RUN_DIR/.gitignore"
    printf 'extra\n' >"$RUN_DIR/extra.txt"
    git -C "$RUN_DIR" add .gitignore extra.txt
    git -C "$RUN_DIR" commit -q -m extra
    mkdir -p "$RUN_DIR/node_modules/dep"
    printf 'dep\n' >"$RUN_DIR/node_modules/dep/index.js"
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub

    run_maki upload .
    assert_rc 0
    [ -f "$SANDBOX_WORKDIR/extra.txt" ] || bad "the tracked file was not uploaded"
    mkdir -p "$SANDBOX_WORKDIR/node_modules/dep"
    printf 'sandbox-dep\n' >"$SANDBOX_WORKDIR/node_modules/dep/index.js"

    rm "$RUN_DIR/extra.txt"
    reset_log
    run_maki upload .
    assert_rc 0
    [ ! -e "$SANDBOX_WORKDIR/extra.txt" ] || bad "the tracked deletion was not pruned"
    [ -f "$SANDBOX_WORKDIR/node_modules/dep/index.js" ] \
        || bad "the gitignored artifact was pruned"
}

test_upload_prunes_plain_deletion() {
    begin "upload prunes a deleted file without a repository"
    new_case prune-plain
    RUN_DIR=$CASE/project/plain
    mkdir -p "$RUN_DIR"
    printf 'one\n' >"$RUN_DIR/one.txt"
    seed_sandbox maki-plain Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-plain maki-stub

    run_maki upload .
    assert_rc 0
    rm "$RUN_DIR/one.txt"
    reset_log
    run_maki upload .
    assert_rc 0
    [ ! -e "$SANDBOX_WORKDIR/one.txt" ] || bad "the plain deletion was not pruned"
}

test_upload_discards_parked_workspace() {
    begin "upload refuses a parked workspace and --discard replaces it"
    new_case upload-discard
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    PATH_OVERRIDE=$(no_git_path)
    STUB_MAKI_SCRIPT='printf "agent\n" > file.txt'
    run_maki maki
    assert_rc 0
    retained_patch=$(pending_value maki-myproject patch)
    PATH_OVERRIDE=
    STUB_MAKI_SCRIPT='printf "agent\n" > file.txt'
    run_maki maki --no-sync
    assert_rc 0
    [ "$(pending_value maki-myproject kind)" = parked ] \
        || bad "the workspace was not parked"

    reset_log
    run_maki upload .
    assert_rc 1
    assert_err_has "the workspace is parked"
    assert_err_has "--discard"
    assert_err_has "download"
    assert_log_missing "upload"
    [ "$(cat "$RUN_DIR/file.txt")" = base ] || bad "the parked host was overwritten"

    run_maki upload --discard .
    assert_rc 0
    assert_log_has "upload"
    [ ! -f "$(session_dir maki-myproject)/pending" ] \
        || bad "discard left the parked marker"
    [ -f "$retained_patch" ] || bad "discard deleted an earlier patch file"
    [ "$(cat "$SANDBOX_WORKDIR/file.txt")" = base ] \
        || bad "discard did not refresh the workspace from the host"
}

test_upload_subpath_keeps_copy_in_semantics() {
    begin "a subpath upload copies only that path and does not prune"
    new_case upload-subpath
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR/dist"
    printf 'built\n' >"$RUN_DIR/dist/app.js"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    run_maki upload .
    assert_rc 0
    printf 'keep\n' >"$SANDBOX_WORKDIR/keep.txt"
    printf 'new\n' >"$RUN_DIR/dist/new.js"

    reset_log
    run_maki upload "$RUN_DIR/dist" "$SANDBOX_WORKDIR/dist"
    assert_rc 0
    assert_log_has "upload"
    [ -f "$SANDBOX_WORKDIR/dist/new.js" ] || bad "the subpath was not copied"
    [ -f "$SANDBOX_WORKDIR/keep.txt" ] || bad "a subpath upload pruned the workspace"
}

test_upload_explicit_path_copies_only_that_path() {
    begin "upload NOTES at the default destination copies only that file and records no sync state"
    new_case upload-plain-copy
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    printf 'notes\n' >"$RUN_DIR/notes.txt"
    printf 'other\n' >"$RUN_DIR/other.txt"

    run_maki upload notes.txt
    assert_rc 0
    assert_log_has "upload"
    assert_log_line "notes.txt"
    assert_out_has "Copied 'notes.txt'"
    assert_err_missing "baseline"
    assert_out_missing "Refreshed"
    [ -f "$SANDBOX_WORKDIR/notes.txt" ] || bad "the named file was not copied"
    [ ! -e "$SANDBOX_WORKDIR/other.txt" ] || bad "another file in the directory was uploaded"
    [ ! -e "$(session_dir maki-myproject)/synced" ] || bad "a plain copy recorded a synced pair"
    [ ! -e "$(session_dir maki-myproject)/baseline" ] || bad "a plain copy recorded a baseline"
    [ ! -e "$(session_dir maki-myproject)/host_manifest" ] || bad "a plain copy recorded a host manifest"
    [ -z "$(registry_value maki-myproject fingerprint)" ] \
        || bad "a plain copy wrote a project fingerprint"

    # A destination other than the workdir is a plain copy even for `.`.
    reset_log
    run_maki upload . "$SANDBOX_WORKDIR/elsewhere"
    assert_rc 0
    assert_out_has "Copied '.'"
    [ ! -e "$(session_dir maki-myproject)/synced" ] || bad "a copy elsewhere recorded a synced pair"
    [ -z "$(registry_value maki-myproject fingerprint)" ] \
        || bad "a copy elsewhere wrote a project fingerprint"
}

test_upload_partial_copy_keeps_workspace_behind() {
    begin "a partial copy after a recorded refresh leaves the workspace not clean"
    new_case upload-partial-behind
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    printf 'notes\n' >"$RUN_DIR/notes.txt"
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub
    run_maki upload .
    assert_rc 0
    assert_out_has "Refreshed"
    run_maki status
    assert_out_has "Sync:      clean"
    synced_before=$(cat "$(session_dir maki-repo)/synced")
    fp_before=$(registry_value maki-repo fingerprint)
    [ -n "$fp_before" ] || bad "the full refresh recorded no fingerprint"

    printf 'host-change\n' >>"$RUN_DIR/tracked.txt"
    run_maki upload notes.txt
    assert_rc 0
    [ "$(cat "$(session_dir maki-repo)/synced")" = "$synced_before" ] \
        || bad "a partial copy changed the synced pair"
    [ "$(registry_value maki-repo fingerprint)" = "$fp_before" ] \
        || bad "a partial copy changed the project fingerprint"
    run_maki status
    assert_rc 0
    assert_out_has "Sync:      behind"
    assert_out_missing "Sync:      clean"
}

test_upload_partial_copy_refused_when_parked() {
    begin "a partial copy into a parked workspace is refused even with --discard"
    new_case upload-partial-parked
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR/dist"
    printf 'base\n' >"$RUN_DIR/file.txt"
    printf 'built\n' >"$RUN_DIR/dist/app.js"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    PATH_OVERRIDE=$(no_git_path)
    STUB_MAKI_SCRIPT='printf "agent\n" > file.txt'
    run_maki maki --no-sync
    assert_rc 0
    [ "$(pending_value maki-myproject kind)" = parked ] \
        || bad "the workspace was not parked"

    printf 'late\n' >"$RUN_DIR/dist/late.js"
    reset_log
    run_maki upload ./dist
    assert_rc 1
    assert_err_has "the workspace is parked"
    run_maki upload ./dist --discard
    assert_rc 1
    assert_err_has "the workspace is parked"
    assert_err_has "a copy of './dist' cannot use it"
    assert_log_missing "upload"
    [ "$(pending_value maki-myproject kind)" = parked ] \
        || bad "a refused partial copy cleared the parked marker"
    [ ! -e "$SANDBOX_WORKDIR/dist/late.js" ] || bad "a refused partial copy reached the sandbox"

    run_maki upload . --discard
    assert_rc 0
    assert_log_has "upload"
    [ ! -f "$(session_dir maki-myproject)/pending" ] \
        || bad "the full refresh left the parked marker"
}

test_upload_partial_copy_warns_about_retained_patch() {
    begin "a partial copy proceeds with a retained patch and names it"
    new_case upload-partial-retained
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/file.txt"
    printf 'notes\n' >"$RUN_DIR/notes.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    PATH_OVERRIDE=$(no_git_path)
    STUB_MAKI_SCRIPT='printf "agent\n" > file.txt'
    run_maki maki
    assert_rc 0
    retained_patch=$(pending_value maki-myproject patch)
    [ -n "$retained_patch" ] || bad "no retained patch was recorded"

    run_maki upload notes.txt
    assert_rc 0
    assert_err_has "$retained_patch"
    [ -f "$retained_patch" ] || bad "a partial copy removed the retained patch"
    [ "$(pending_value maki-myproject kind)" = retained ] \
        || bad "a partial copy cleared the retained marker"
}

test_applied_retained_patch_clears_notice() {
    begin "an applied retained patch clears the notice without deleting the patch"
    new_case retained-applied
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub
    PATH_OVERRIDE=$(no_git_path)
    STUB_MAKI_SCRIPT='printf "agent\n" > tracked.txt'
    run_maki maki
    assert_rc 0
    [ "$(pending_value maki-repo kind)" = retained ] \
        || bad "the patch was not retained"
    retained_patch=$(pending_value maki-repo patch)
    [ -n "$retained_patch" ] || bad "the retained patch path is missing"

    PATH_OVERRIDE=
    git -C "$RUN_DIR" apply "$retained_patch"
    [ "$(cat "$RUN_DIR/tracked.txt")" = agent ] \
        || bad "the test could not apply the retained patch"

    reset_log
    STUB_MAKI_SCRIPT=
    run_maki maki
    assert_rc 0
    assert_err_has "already applied"
    [ ! -f "$(session_dir maki-repo)/pending" ] \
        || bad "the applied patch notice was not cleared"
    [ -f "$retained_patch" ] || bad "clearing the notice deleted the patch file"
}

test_stale_retained_notice_is_advisory() {
    begin "a retained patch that no longer matches the sandbox is only advisory"
    new_case retained-advisory
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    PATH_OVERRIDE=$(no_git_path)
    STUB_MAKI_SCRIPT='printf "agent\n" > file.txt'
    run_maki maki
    assert_rc 0
    [ "$(pending_value maki-myproject kind)" = retained ] \
        || bad "the patch was not retained"
    retained_patch=$(pending_value maki-myproject patch)

    # The next session refreshes the retained workspace and makes no changes,
    # so the marker remains but no longer covers the sandbox.
    PATH_OVERRIDE=
    STUB_MAKI_SCRIPT=
    reset_log
    run_maki maki
    assert_rc 0
    assert_err_has "Retained patch for review"
    assert_log_has "upload"
    [ -f "$(session_dir maki-myproject)/pending" ] \
        || bad "the advisory marker was removed"
    [ "$(cat "$SANDBOX_WORKDIR/file.txt")" = base ] \
        || bad "the refresh did not restore the host tree"
    [ "$(cat "$RUN_DIR/file.txt")" = base ] \
        || bad "the retained change was applied"

    reset_log
    run_maki status
    assert_rc 0
    assert_out_has "Sync:      clean"
    assert_out_missing "Patch:"
    [ -f "$retained_patch" ] || bad "the advisory patch file was deleted"
}

test_flat_get_helper() {
    begin "test helper reads flat TOML values with quotes and spaces"
    new_case flat-get
    flat_file=$CASE/flat.toml
    printf '%s\n' 'version = "1"' 'host_path = "/a/my \"app\" dir"' 'back = "c:\\x"' >"$flat_file"
    [ "$(flat_get "$flat_file" version)" = 1 ] || bad "version: $(flat_get "$flat_file" version)"
    [ "$(flat_get "$flat_file" host_path)" = '/a/my "app" dir' ] \
        || bad "host_path: $(flat_get "$flat_file" host_path)"
    [ "$(flat_get "$flat_file" back)" = 'c:\x' ] || bad "back: $(flat_get "$flat_file" back)"
    [ -z "$(flat_get "$flat_file" missing)" ] || bad "a missing key printed a value"
    [ -z "$(flat_get "$CASE/none.toml" version)" ] || bad "a missing file printed a value"
}

# ---------------------------------------------------------------------------
# osa project layer (specs/osa-project-layer): shared state root, registry,
# naming, the flat TOML contract, and the host fingerprint.
# ---------------------------------------------------------------------------

# Prints the physical path of DIR, the form the registry records.
physical_dir() { (cd "$1" && pwd -P); }

is_hashed_name() { # NAME PREFIX
    case $1 in
        "$2"[0-9a-f][0-9a-f][0-9a-f][0-9a-f]) return 0 ;;
    esac
    return 1
}

test_shared_state_root() {
    begin "both front-ends register under the one osa state root"
    new_case shared-root
    NAME_PIN=
    OC_NAME_PIN=
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    run_maki up
    assert_rc 0
    mk_name=$(sandbox_name_from_log)
    reset_log
    run_oc up
    assert_rc 0
    oc_name=$(sandbox_name_from_log)
    is_hashed_name "$mk_name" mk-myproject- || bad "unexpected Maki name: $mk_name"
    is_hashed_name "$oc_name" oc-myproject- || bad "unexpected OpenCode name: $oc_name"
    [ "${mk_name#mk-}" = "${oc_name#oc-}" ] || bad "the two agents hashed one folder differently"
    [ "$(registry_value "$mk_name" agent)" = mk ] || bad "no Maki registry entry for $mk_name"
    [ "$(registry_value "$oc_name" agent)" = oc ] || bad "no OpenCode registry entry for $oc_name"
    [ ! -e "$HOME/.local/state/maki-oss" ] || bad "a maki-oss state root was written"
    [ ! -e "$HOME/.local/state/opencode-oss" ] || bad "an opencode-oss state root was written"
}

test_old_state_root_ignored() {
    begin "a marker under the former per-tool root is neither read nor changed"
    new_case old-root
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    old_state=$HOME/.local/state/maki-oss/sessions/maki-myproject
    mkdir -p "$old_state"
    printf 'patch=\nsandbox=maki-myproject\nreason=collection failed\n' >"$old_state/pending"
    cp "$old_state/pending" "$CASE/old-pending.copy"
    run_maki maki
    assert_rc 0
    assert_err_missing "is parked"
    assert_log_line "maki"
    cmp -s "$old_state/pending" "$CASE/old-pending.copy" || bad "the former marker was changed"
}

test_state_toml_round_trip() {
    begin "registry values with quotes and spaces round-trip as flat TOML"
    new_case toml-round-trip
    RUN_DIR=$(odd_project_dir)
    mkdir -p "$RUN_DIR"
    run_maki up
    assert_rc 0
    odd_name=$(sandbox_name_from_log)
    odd_path=$(physical_dir "$RUN_DIR")
    [ "$(registry_value "$odd_name" host_path)" = "$odd_path" ] \
        || bad "host_path did not round-trip: $(registry_value "$odd_name" host_path)"
    [ "$(registry_value "$odd_name" version)" = 1 ] || bad "the entry has no version 1"
    assert_file_mode "$(registry_entry "$odd_name")" 600
    # The helper reads the same value back: a second up is not refused as
    # another folder's name.
    reset_log
    run_maki up
    assert_rc 0
    assert_err_missing "registered to"
    if command -v bun >/dev/null 2>&1; then
        bun_path=$(F=$(registry_entry "$odd_name") bun -e \
            'console.log(Bun.TOML.parse(await Bun.file(process.env.F).text()).host_path)' 2>&1) \
            || bad "bun could not parse the entry: $bun_path"
        [ "$bun_path" = "$odd_path" ] || bad "bun read host_path as: $bun_path"
    fi
}

test_project_name_sources() {
    begin "{project} comes from the origin remote, else the folder name"
    new_case name-sources
    NAME_PIN=
    RUN_DIR=$CASE/project/checkout
    seed_git_project "$RUN_DIR"
    git -C "$RUN_DIR" remote add origin git@github.com:acme/app.git
    run_maki up
    assert_rc 0
    is_hashed_name "$(sandbox_name_from_log)" mk-app- \
        || bad "SSH remote name not used: $(sandbox_name_from_log)"

    reset_log
    RUN_DIR=$CASE/project/web
    seed_git_project "$RUN_DIR"
    git -C "$RUN_DIR" remote add origin https://example.com/acme/Web.Site.git
    run_maki up
    assert_rc 0
    is_hashed_name "$(sandbox_name_from_log)" mk-web-site- \
        || bad "HTTPS remote name not used: $(sandbox_name_from_log)"

    reset_log
    RUN_DIR=$CASE/project/noorigin
    seed_git_project "$RUN_DIR"
    run_maki up
    assert_rc 0
    is_hashed_name "$(sandbox_name_from_log)" mk-noorigin- \
        || bad "a repository without origin did not use its folder: $(sandbox_name_from_log)"

    reset_log
    RUN_DIR="$CASE/project/My App"
    mkdir -p "$RUN_DIR"
    run_maki up
    assert_rc 0
    is_hashed_name "$(sandbox_name_from_log)" mk-my-app- \
        || bad "a plain folder did not use its name: $(sandbox_name_from_log)"
}

test_default_name_hash() {
    begin "default names carry a path hash and fit 19 characters"
    new_case name-hash
    NAME_PIN=
    OC_NAME_PIN=
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    git -C "$RUN_DIR" remote add origin git@github.com:acme/app.git
    git -C "$RUN_DIR" worktree add -q "$CASE/project/repo-wt" -b wt 2>/dev/null
    run_maki up
    assert_rc 0
    main_name=$(sandbox_name_from_log)
    reset_log
    RUN_DIR=$CASE/project/repo-wt
    run_maki up
    assert_rc 0
    wt_name=$(sandbox_name_from_log)
    is_hashed_name "$main_name" mk-app- || bad "unexpected main worktree name: $main_name"
    is_hashed_name "$wt_name" mk-app- || bad "unexpected linked worktree name: $wt_name"
    [ "$main_name" != "$wt_name" ] || bad "two worktrees shared the sandbox $wt_name"

    reset_log
    RUN_DIR=$CASE/project/long
    seed_git_project "$RUN_DIR"
    git -C "$RUN_DIR" remote add origin git@github.com:acme/this-project-name-is-way-too-long.git
    run_maki up
    assert_rc 0
    long_name=$(sandbox_name_from_log)
    [ "${#long_name}" -le 19 ] || bad "sandbox name is ${#long_name} characters: $long_name"
    is_hashed_name "$long_name" mk-this-projec- || bad "the long name was not cut to 11: $long_name"

    reset_log
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    run_oc up
    assert_rc 0
    is_hashed_name "$(sandbox_name_from_log)" oc-myproject- \
        || bad "unexpected OpenCode default: $(sandbox_name_from_log)"
}

# Writes a registry entry by hand, the way a migrated or earlier project has one.
seed_registry_entry() { # SANDBOX AGENT HOST_PATH
    mkdir -p "$(state_root)/projects"
    printf 'version = "1"\nagent = "%s"\nhost_path = "%s"\nproject = "myproject"\nsandbox_name = "%s"\n' \
        "$2" "$3" "$1" >"$(registry_entry "$1")"
}

test_registered_name_and_binding() {
    begin "a registered name wins and a name bound to another folder is refused"
    new_case registry-binding
    NAME_PIN=
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_registry_entry maki-myproject mk "$(physical_dir "$RUN_DIR")"
    run_maki up
    assert_rc 0
    [ "$(sandbox_name_from_log)" = maki-myproject ] \
        || bad "the registered name was not used: $(sandbox_name_from_log)"

    reset_log
    RUN_DIR=$CASE/project/other
    mkdir -p "$RUN_DIR"
    run_maki up --name maki-myproject
    assert_rc 1
    assert_err_has "--name"
    assert_err_has "registered to"
    if [ -s "$LOG" ]; then
        bad "the gateway was contacted for a name bound to another folder"
    fi
}

test_registry_entry_lifecycle() {
    begin "create, session, and rm keep the registry entry current"
    new_case registry-lifecycle
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_remembered_provider maki-stub
    run_maki up --env APP_MODE=registry-probe-value
    assert_rc 0
    [ "$(registry_value maki-myproject agent)" = mk ] || bad "agent is not mk"
    [ "$(registry_value maki-myproject host_path)" = "$(physical_dir "$RUN_DIR")" ] \
        || bad "host_path: $(registry_value maki-myproject host_path)"
    [ "$(registry_value maki-myproject project)" = myproject ] || bad "project is not myproject"
    [ "$(registry_value maki-myproject sandbox_name)" = maki-myproject ] || bad "sandbox_name is wrong"
    [ "$(registry_value maki-myproject sandbox_id)" = "$(cat "$STUB_STATE_DIR/ids/maki-myproject")" ] \
        || bad "sandbox_id: $(registry_value maki-myproject sandbox_id)"
    [ -n "$(registry_value maki-myproject created)" ] || bad "created is empty"
    [ -z "$(registry_value maki-myproject last_session)" ] || bad "up stamped a session"
    if grep -q 'registry-probe-value\|APP_MODE' "$(registry_entry maki-myproject)"; then
        bad "an --env value reached the registry"
    fi

    attach_stub_provider maki-myproject maki-stub
    run_maki maki
    assert_rc 0
    [ -n "$(registry_value maki-myproject last_session)" ] || bad "the session did not stamp last_session"

    run_maki rm --yes
    assert_rc 0
    [ ! -e "$(registry_entry maki-myproject)" ] || bad "rm left the registry entry"

    begin "rm refused for a parked workspace keeps the registry entry"
    new_case registry-parked-rm
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    run_maki up
    assert_rc 0
    mkdir -p "$(session_dir maki-myproject)"
    printf 'version = "1"\nkind = "parked"\npatch = ""\n' >"$(session_dir maki-myproject)/pending"
    run_maki rm --yes
    assert_rc 1
    [ -f "$(registry_entry maki-myproject)" ] || bad "a refused rm removed the registry entry"
}

test_registry_fingerprint() {
    begin "sync points record a host fingerprint for git projects only"
    new_case fingerprint
    RUN_DIR=$CASE/project/myproject
    seed_git_project "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    run_maki maki
    assert_rc 0
    fp_first=$(registry_value maki-myproject fingerprint)
    [ -n "$fp_first" ] || bad "the first sync recorded no fingerprint"

    run_maki maki
    assert_rc 0
    [ "$(registry_value maki-myproject fingerprint)" = "$fp_first" ] \
        || bad "an unchanged project changed its fingerprint"

    printf 'edited\n' >>"$RUN_DIR/tracked.txt"
    run_maki maki
    assert_rc 0
    fp_edit=$(registry_value maki-myproject fingerprint)
    [ -n "$fp_edit" ] && [ "$fp_edit" != "$fp_first" ] \
        || bad "an unstaged edit did not change the fingerprint"

    printf 'committed\n' >>"$RUN_DIR/tracked.txt"
    git -C "$RUN_DIR" commit -qam edit
    run_maki maki
    assert_rc 0
    fp_commit=$(registry_value maki-myproject fingerprint)
    [ -n "$fp_commit" ] && [ "$fp_commit" != "$fp_edit" ] \
        || bad "a commit did not change the fingerprint"

    begin "a plain folder records no fingerprint"
    new_case fingerprint-plain
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    run_maki maki
    assert_rc 0
    [ -f "$(registry_entry maki-myproject)" ] || bad "the session did not register the project"
    if grep -q '^fingerprint' "$(registry_entry maki-myproject)" 2>/dev/null; then
        bad "a plain folder recorded a fingerprint"
    fi
}

OSA=$ROOT/bin/osa

# Runs osa with the same stub environment as the front-ends, which its full
# status calls.
run_osa() { # ARGS...
    osa_rc=0
    (
        MAKI=$OSA
        run_maki_with_input /dev/null "$@"
        exit "$RC"
    ) || osa_rc=$?
    RC=$osa_rc
}

# Checks that stdout is one JSON array (with jq when present) of COUNT items.
assert_json_array() { # COUNT
    if command -v jq >/dev/null 2>&1; then
        jq -e "type == \"array\" and length == $1" "$OUT" >/dev/null 2>&1 \
            || bad "stdout is not a JSON array of $1: $(cat "$OUT")"
    else
        case $(cat "$OUT") in
            '['*']') ;;
            *) bad "stdout is not a JSON array: $(cat "$OUT")" ;;
        esac
    fi
}

test_osa_usage() {
    begin "osa offers its commands and rejects anything else"
    new_case osa-usage
    run_osa help
    assert_rc 0
    assert_out_has "projects"
    assert_out_has "status"
    assert_out_has "health SANDBOX"
    assert_out_has "providers [--agent TAG]"
    assert_out_has "images [--json]"
    assert_out_has "resolve"
    assert_out_has "provider setup TAG --profile ID"
    assert_out_has "image build TAG"
    assert_out_has "dashboard [--port N]"
    run_osa up
    assert_rc 1
    assert_err_has "projects, status, health, providers, images, resolve, provider setup, image build, dashboard, help"
    run_osa projects --quick
    assert_rc 1
}

test_osa_projects() {
    begin "osa projects lists every agent's projects with pending and orphan"
    new_case osa-projects
    mkdir -p "$CASE/project"
    run_osa projects --json
    assert_rc 0
    [ "$(cat "$OUT")" = '[]' ] || bad "an empty registry printed: $(cat "$OUT")"

    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    run_maki up
    assert_rc 0
    run_oc up
    assert_rc 0
    mkdir -p "$(session_dir maki-myproject)"
    printf 'retained patch\n' >"$CASE/retained.patch"
    printf 'version = "1"\nkind = "retained"\npatch = "%s"\n' "$CASE/retained.patch" \
        >"$(session_dir maki-myproject)/pending"
    seed_registry_entry mk-ghost-0000 mk "$CASE/project/gone"

    run_osa projects --json
    assert_rc 0
    assert_json_array 3
    if command -v jq >/dev/null 2>&1; then
        [ "$(jq -r '[.[].agent] | sort | join(",")' "$OUT")" = mk,mk,oc ] \
            || bad "agents: $(jq -r '[.[].agent] | join(",")' "$OUT")"
        [ "$(jq -r '.[] | select(.sandbox_name == "maki-myproject") | .pending' "$OUT")" = retained ] \
            || bad "the retained patch is not listed as pending"
        [ "$(jq -r '.[] | select(.sandbox_name == "mk-ghost-0000") | .orphan' "$OUT")" = true ] \
            || bad "the missing folder is not an orphan"
        [ "$(jq -r '.[] | select(.sandbox_name == "oc-myproject") | .orphan' "$OUT")" = false ] \
            || bad "a present folder is an orphan"
    fi
    [ -f "$(registry_entry mk-ghost-0000)" ] || bad "osa removed the orphan's entry"

    run_osa projects
    assert_rc 0
    assert_out_has "maki-myproject"
    assert_out_has "oc-myproject"
    assert_out_has "orphan"
}

test_osa_status_quick() {
    begin "osa status --quick reports the host fingerprint without the gateway"
    new_case osa-quick
    RUN_DIR=$CASE/project/myproject
    seed_git_project "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    run_maki maki
    assert_rc 0

    reset_log
    run_osa status --quick --json
    assert_rc 0
    assert_json_array 1
    assert_out_has '"fingerprint_result":"unchanged"'
    assert_out_missing '"clean"'
    assert_out_missing '"behind"'

    printf 'committed\n' >>"$RUN_DIR/tracked.txt"
    git -C "$RUN_DIR" commit -qam change
    run_osa status --quick --json
    assert_rc 0
    assert_out_has '"fingerprint_result":"changed"'
    if [ -s "$LOG" ]; then
        bad "--quick contacted the gateway: $(tr '\n' ' ' <"$LOG")"
    fi

    run_osa status --quick --json "$CASE/project/elsewhere"
    assert_rc 0
    [ "$(cat "$OUT")" = '[]' ] || bad "an unregistered path printed: $(cat "$OUT")"

    begin "osa status --quick reports unknown for a plain folder"
    new_case osa-quick-plain
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    run_maki up
    assert_rc 0
    run_osa status --quick --json
    assert_rc 0
    assert_out_has '"fingerprint_result":"unknown"'
}

# Asserts that `osa status --json` and the front-end's text status agree.
assert_osa_matches_status() { # STATE
    run_maki status
    assert_out_has "Sync:      $1"
    run_osa status --json
    assert_rc 0
    assert_json_array 1
    assert_out_has "\"sync\":\"$1\""
}

test_osa_status_full() {
    begin "osa status matches the front-end's clean, behind, retained, and parked"
    new_case osa-full
    RUN_DIR=$CASE/project/repo
    seed_git_project "$RUN_DIR"
    seed_sandbox maki-repo Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-repo maki-stub
    run_maki upload .
    assert_rc 0
    assert_osa_matches_status clean
    printf 'host-change\n' >>"$RUN_DIR/tracked.txt"
    assert_osa_matches_status behind

    new_case osa-full-retained
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    STUB_MAKI_SCRIPT='printf "agent\n" > file.txt'
    PATH_OVERRIDE=$(no_git_path)
    run_maki maki
    assert_rc 0
    assert_osa_matches_status retained
    PATH_OVERRIDE=

    new_case osa-full-parked
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    printf 'base\n' >"$RUN_DIR/file.txt"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    STUB_MAKI_SCRIPT='printf "agent\n" > new.txt'
    run_maki maki --no-sync
    assert_rc 0
    assert_osa_matches_status parked

    run_osa status --json "$CASE/project/elsewhere"
    assert_rc 0
    [ "$(cat "$OUT")" = '[]' ] || bad "an unregistered path printed: $(cat "$OUT")"
}

# Prints a listing of every file under the state root with its checksum.
state_snapshot() {
    (cd "$(state_root)" && find . -type f | sort | while IFS= read -r f; do
        printf '%s %s\n' "$f" "$(cksum <"$f")"
    done)
}

test_osa_read_only() {
    begin "osa changes no sandbox and no state file"
    new_case osa-read-only
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    run_maki maki
    assert_rc 0
    state_snapshot >"$CASE/before.txt"

    reset_log
    run_osa projects
    assert_rc 0
    run_osa projects --json
    assert_rc 0
    run_osa status --quick
    assert_rc 0
    if [ -s "$LOG" ]; then
        bad "projects or --quick contacted the gateway: $(tr '\n' ' ' <"$LOG")"
    fi
    run_osa status
    assert_rc 0
    run_osa status --json
    assert_rc 0
    run_osa health maki-myproject
    assert_rc 0
    run_osa health maki-myproject --json
    assert_rc 0
    run_osa providers --json
    assert_rc 0
    run_osa images --json
    assert_rc 0
    for osa_verb in create start stop delete upload download maki update attach import build tag rmi; do
        assert_log_line_missing "$osa_verb"
    done
    state_snapshot >"$CASE/after.txt"
    cmp -s "$CASE/before.txt" "$CASE/after.txt" || bad "osa changed a file under the state root"
}

# ---------------------------------------------------------------------------
# Non-interactive provider setup (specs/helper-cli: "Generic credential
# sources", "Profile resolution and generation"; specs/osa-project-layer: "osa
# lists providers and setup profiles", "osa sets up a provider from stdin").
# ---------------------------------------------------------------------------

# Writes TEXT (printf %b: `\n` is a newline) to the case's stdin file and
# prints its path.
stdin_file() { # TEXT
    printf '%b' "$1" >"$CASE/stdin.txt"
    printf '%s' "$CASE/stdin.txt"
}

# Asserts that no gateway mutation was recorded.
assert_no_mutation() {
    for anm_verb in import create update attach; do
        assert_log_line_missing "$anm_verb"
    done
}

assert_log_empty() { # WHY
    if [ -s "$LOG" ]; then
        bad "$1: $(tr '\n' ' ' <"$LOG")"
    fi
}

# Prints each recorded invocation as one space-joined line.
log_invocations() {
    awk '$0 == "---" { if (line != "") print line; line = ""; next }
        { line = (line == "" ? $0 : line " " $0) }
        END { if (line != "") print line }' "$LOG" 2>/dev/null
}

assert_invocation() { # LINE
    if ! log_invocations | grep -Fxq -- "$1"; then
        bad "no recorded invocation: $1"
    fi
}

# Prints jq FILTER over stdout (empty without jq).
out_value() { # FILTER
    jq -r "$1" "$OUT" 2>/dev/null
}

have_jq() { command -v jq >/dev/null 2>&1; }

test_provider_setup_stdin() {
    begin "provider setup --stdin creates the provider without a prompt"
    new_case setup-stdin
    CREDENTIAL_ENV=DEEPSEEK_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log
    run_maki_with_input "$(stdin_file 'fixture-stdin-key\n')" provider setup --stdin --profile maki-deepseek
    assert_rc 0
    assert_invocation "provider create --name maki-deepseek --type maki-deepseek --from-existing --global-profile"
    assert_credential_env fixture-stdin-key
    assert_secret_absent fixture-stdin-key
    assert_out_missing "[y/N]"
    assert_out_missing "Default model"

    begin "provider setup --stdin refuses empty, multi-line, and oversized input"
    for pss_input in '' '\n' 'fixture-line-a\nfixture-line-b\n'; do
        reset_log
        run_maki_with_input "$(stdin_file "$pss_input")" provider setup --stdin --profile maki-deepseek
        assert_rc 1
        assert_log_empty "invalid stdin reached the gateway"
    done
    assert_err_missing fixture-line
    head -c 65537 /dev/zero | tr '\0' k >"$CASE/big.txt"
    reset_log
    run_maki_with_input "$CASE/big.txt" provider setup --stdin --profile maki-deepseek
    assert_rc 1
    assert_err_has "at most 65536 bytes"
    assert_log_empty "an oversized credential reached the gateway"
    head -c 65536 /dev/zero | tr '\0' k >"$CASE/max.txt"
    run_maki_with_input "$CASE/max.txt" provider setup --stdin --profile maki-deepseek --yes
    assert_rc 0

    begin "provider setup --stdin needs --profile and takes no second source"
    reset_log
    run_maki_with_input "$(stdin_file 'fixture-k')" provider setup --stdin
    assert_rc 1
    assert_err_has "needs --profile"
    run_maki_with_input "$(stdin_file 'fixture-k')" provider setup --stdin --env X --profile maki-deepseek
    assert_rc 1
    assert_err_has "one credential source"
    assert_log_empty "a usage error reached the gateway"

    begin "MAKI_OSS_INTERACTIVE=1 does not bring prompts back under --stdin"
    new_case setup-stdin-interactive
    seed_sandbox maki-project Ready
    INTERACTIVE=1
    run_maki_with_input "$(stdin_file 'fixture-k\n')" provider setup --stdin --profile maki-deepseek
    assert_rc 0
    assert_out_missing "[y/N]"
    assert_out_missing "Default model"
    assert_log_line_missing attach
    reset_log
    run_maki_with_input "$(stdin_file 'fixture-k\n')" provider setup --stdin --profile maki-deepseek
    assert_rc 1
    assert_err_has "already exists"
    assert_out_missing "[y/N]"
    assert_no_mutation
}

test_provider_setup_profile_id() {
    begin "provider setup --profile takes a curated or a generated profile id"
    new_case setup-profile-id
    run_maki_with_input "$(stdin_file 'fixture-id-key')" provider setup --stdin --profile maki-deepseek
    assert_rc 0
    assert_log_line "$ROOT/examples/providers/maki-deepseek.yaml"
    mkdir -p "$XDG_CONFIG_HOME/maki-oss/profiles"
    write_fixture_profile "$XDG_CONFIG_HOME/maki-oss/profiles/my-generated.yaml" my-generated GEN_KEY
    reset_log
    run_maki_with_input "$(stdin_file 'fixture-id-key')" provider setup --stdin --profile my-generated
    assert_rc 0
    assert_log_line "$XDG_CONFIG_HOME/maki-oss/profiles/my-generated.yaml"
    assert_invocation "provider create --name my-generated --type my-generated --from-existing --global-profile"

    begin "provider setup refuses an unsafe or unknown profile id before the gateway"
    for psp_id in ../x no-such-profile; do
        reset_log
        run_maki_with_input "$(stdin_file 'fixture-id-key')" provider setup --stdin --profile "$psp_id"
        assert_rc 1
        assert_log_empty "profile id '$psp_id' reached the gateway"
    done
}

test_providers_json_front_ends() {
    begin "__providers-json reports setup, profiles, gateway, and remembered"
    new_case providers-json
    seed_remembered_provider maki-stub
    mkdir -p "$XDG_CONFIG_HOME/maki-oss/profiles"
    write_fixture_profile "$XDG_CONFIG_HOME/maki-oss/profiles/my-custom.yaml" my-custom MY_CUSTOM_KEY
    printf 'id: broken-one\n' >"$XDG_CONFIG_HOME/maki-oss/profiles/broken-one.yaml"
    run_maki __providers-json
    assert_rc 0
    if have_jq; then
        [ "$(out_value '.setup + " " + .command')" = "stdin maki-oss provider setup" ] \
            || bad "setup: $(out_value '.setup + " " + .command')"
        [ "$(out_value '.profiles[] | select(.id == "maki-deepseek") | [.env, .source, .note] | join("|")')" \
            = "DEEPSEEK_API_KEY|curated|DeepSeek API key" ] \
            || bad "maki-deepseek: $(out_value '.profiles[] | select(.id == "maki-deepseek")')"
        [ "$(out_value '.profiles[] | select(.id == "my-custom") | [.env, .source, (.note | tostring)] | join("|")')" \
            = "MY_CUSTOM_KEY|custom|null" ] \
            || bad "my-custom: $(out_value '.profiles[] | select(.id == "my-custom")')"
        [ "$(out_value '.profiles[] | select(.id == "broken-one") | [(.env | tostring), .note] | join("|")')" \
            = "null|unreadable profile" ] \
            || bad "broken-one: $(out_value '.profiles[] | select(.id == "broken-one")')"
        [ "$(out_value '[.profiles[] | select(.id == "template")] | length')" = 0 ] \
            || bad "the template is listed as a profile"
        [ "$(out_value '.gateway | index("maki-stub") != null')" = true ] \
            || bad "gateway: $(out_value '.gateway')"
        [ "$(out_value '.remembered | join(",")')" = maki-stub ] \
            || bad "remembered: $(out_value '.remembered')"
    fi

    begin "__providers-json keeps profiles and reports a gateway error"
    GATEWAY_DOWN=1
    run_maki __providers-json
    assert_rc 0
    if have_jq; then
        [ "$(out_value '.gateway.error.message | type')" = string ] \
            || bad "gateway: $(out_value '.gateway')"
        [ "$(out_value '(.profiles | length) > 0')" = true ] || bad "profiles missing with the gateway down"
        [ "$(out_value '.remembered | join(",")')" = maki-stub ] || bad "remembered missing with the gateway down"
    fi
    GATEWAY_DOWN=

    begin "__providers-json reads each front-end's catalog note column"
    oc_case providers-json-oc
    run_oc __providers-json
    assert_rc 0
    if have_jq; then
        [ "$(out_value '.setup')" = stdin ] || bad "oc setup: $(out_value '.setup')"
        [ "$(out_value '.profiles[] | select(.id == "opencode-deepseek") | .note')" = "DeepSeek API key" ] \
            || bad "oc note: $(out_value '.profiles[] | select(.id == "opencode-deepseek")')"
    fi
    cc_case providers-json-cc
    run_cc __providers-json
    assert_rc 0
    if have_jq; then
        [ "$(out_value '.profiles[] | select(.id == "claude-anthropic") | .note')" = "Anthropic API key, billed per call" ] \
            || bad "cc note: $(out_value '.profiles[] | select(.id == "claude-anthropic")')"
    fi
    cx_case providers-json-cx
    run_cx __providers-json
    assert_rc 0
    if have_jq; then
        [ "$(out_value '.setup + " " + .command')" = "login codex-oss provider setup" ] \
            || bad "cx setup: $(out_value '.setup + " " + .command')"
    fi
}

test_provider_setup_program() {
    begin "__provider-setup creates, attaches, and prints only JSON on stdout"
    new_case provider-setup-program
    seed_sandbox mk-demo-1a2b Ready
    CREDENTIAL_ENV=DEEPSEEK_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log
    run_maki_with_input "$(stdin_file 'fixture-program-key')" --name mk-demo-1a2b \
        __provider-setup --profile maki-deepseek --attach --json
    assert_rc 0
    [ "$(wc -l <"$OUT" | tr -d ' ')" = 1 ] || bad "stdout is not one line: $(cat "$OUT")"
    assert_err_has "Linting profile"
    if have_jq; then
        [ "$(out_value '[.ok, .outcome, .attached, .remembered] | map(tostring) | join(" ")')" \
            = "true created mk-demo-1a2b true" ] || bad "result: $(cat "$OUT")"
        [ "$(out_value '.steps | join(",")')" = linted,imported,created,remembered,attached ] \
            || bad "steps: $(out_value '.steps')"
    fi
    assert_credential_env fixture-program-key
    assert_secret_absent fixture-program-key

    begin "__provider-setup refuses an existing provider without --yes and updates with it"
    reset_log
    run_maki_with_input "$(stdin_file 'fixture-program-key')" __provider-setup --profile maki-deepseek --json
    assert_rc 2
    assert_out_has '"outcome":"refused"'
    assert_no_mutation
    run_maki_with_input "$(stdin_file 'fixture-program-key')" __provider-setup --profile maki-deepseek --yes --json
    assert_rc 0
    assert_out_has '"outcome":"updated"'
    assert_invocation "provider update maki-deepseek --from-existing"
    assert_log_line_missing attach

    begin "__provider-setup refuses an attach to a missing sandbox before any change"
    new_case provider-setup-missing
    run_maki_with_input "$(stdin_file 'fixture-program-key')" --name mk-gone-0000 \
        __provider-setup --profile maki-deepseek --attach --json
    assert_rc 2
    assert_out_has '"outcome":"refused"'
    assert_out_has "not on the gateway"
    assert_no_mutation

    begin "__provider-setup reports the completed steps when the attach fails"
    new_case provider-setup-attach-fail
    seed_sandbox mk-demo-1a2b Ready
    ATTACH_FAIL=1
    run_maki_with_input "$(stdin_file 'fixture-program-key')" --name mk-demo-1a2b \
        __provider-setup --profile maki-deepseek --attach --json
    assert_rc 3
    if have_jq; then
        [ "$(out_value '[.ok, .outcome, .attached] | map(tostring) | join(" ")')" = "false failed null" ] \
            || bad "result: $(cat "$OUT")"
        [ "$(out_value '.steps | join(",")')" = linted,imported,created,remembered ] \
            || bad "steps: $(out_value '.steps')"
    fi
    assert_out_has "created maki-deepseek and remembered it; attach to 'mk-demo-1a2b' failed: stub: attach of maki-deepseek timed out waiting for the supervisor"
    assert_secret_absent fixture-program-key

    begin "__provider-setup --probe refuses a login agent and passes a stdin agent"
    cx_case provider-setup-probe
    run_cx __provider-setup --probe --json
    assert_rc 2
    assert_out_has '"outcome":"refused"'
    assert_out_has '"command":"codex-oss provider setup"'
    assert_log_empty "the probe contacted the gateway"
    run_maki __provider-setup --probe --json
    assert_rc 0
    [ ! -s "$OUT" ] || bad "a passing probe printed: $(cat "$OUT")"
}

run_osa_with_input() { # STDIN_FILE ARGS...
    osa_rc=0
    (
        MAKI=$OSA
        run_maki_with_input "$@"
        exit "$RC"
    ) || osa_rc=$?
    RC=$osa_rc
}

test_osa_providers() {
    begin "osa providers lists every agent or one, and refuses an unknown tag"
    new_case osa-providers
    run_osa providers --json
    assert_rc 0
    assert_json_array 4
    if have_jq; then
        [ "$(out_value '[.[].agent] | join(",")')" = mk,oc,cc,cx ] || bad "agents: $(out_value '[.[].agent]')"
        [ "$(out_value '.[] | select(.agent == "cx") | .setup')" = login ] || bad "cx is not a login agent"
    fi
    run_osa providers --agent mk --json
    assert_rc 0
    assert_json_array 1
    if have_jq; then
        [ "$(out_value '.[0].profiles[] | select(.id == "maki-deepseek") | .env + " " + .source')" \
            = "DEEPSEEK_API_KEY curated" ] || bad "maki-deepseek: $(cat "$OUT")"
    fi
    run_osa providers
    assert_rc 0
    assert_out_has "mk (maki-oss): setup stdin"
    assert_out_has "run 'codex-oss provider setup' in a terminal"
    run_osa providers --agent zz --json
    assert_rc 1
    run_osa providers extra
    assert_rc 1

    begin "osa providers exits 0 with a gateway error object per agent"
    GATEWAY_DOWN=1
    run_osa providers --json
    assert_rc 0
    assert_json_array 4
    if have_jq; then
        [ "$(out_value '[.[] | .gateway.error.message | type] | unique | join(",")')" = string ] \
            || bad "gateway: $(out_value '[.[].gateway]')"
        [ "$(out_value 'all(.[]; (.profiles | length) > 0)')" = true ] || bad "profiles missing"
    fi
}

test_osa_provider_setup() {
    begin "osa provider setup creates and attaches from stdin, which osa never reads"
    new_case osa-provider-setup
    seed_registry_entry mk-demo-1a2b mk "$CASE/project"
    seed_registry_entry oc-demo-1a2b oc "$CASE/project"
    seed_sandbox mk-demo-1a2b Ready
    CREDENTIAL_ENV=DEEPSEEK_API_KEY
    CREDENTIAL_LOG=$CASE/credential-env.log
    run_osa_with_input "$(stdin_file 'sk-test-osa-fixture')" provider setup mk --profile maki-deepseek \
        --attach mk-demo-1a2b --json
    assert_rc 0
    assert_invocation "profile lint -f $ROOT/examples/providers/maki-deepseek.yaml"
    assert_invocation "provider create --name maki-deepseek --type maki-deepseek --from-existing --global-profile"
    assert_invocation "sandbox provider attach mk-demo-1a2b maki-deepseek --wait"
    assert_out_has '"outcome":"created"'
    assert_out_has '"attached":"mk-demo-1a2b"'
    # The probe runs with stdin closed and osa execs the front-end, so the
    # front-end reads the whole key: any byte osa consumed would be missing.
    assert_credential_env sk-test-osa-fixture
    assert_secret_absent sk-test-osa-fixture

    begin "osa provider setup needs --yes for an existing provider"
    reset_log
    run_osa_with_input "$(stdin_file 'sk-test-osa-fixture')" provider setup mk --profile maki-deepseek \
        --attach mk-demo-1a2b --json
    assert_rc 2
    assert_out_has '"outcome":"refused"'
    assert_log_line_missing update
    assert_log_line_missing attach

    begin "osa provider setup validates the tag, ids, and sandbox before the front-end"
    reset_log
    run_osa_with_input "$(stdin_file 'sk-test-osa-fixture')" provider setup mk --profile maki-deepseek \
        --attach oc-demo-1a2b --json
    assert_rc 1
    assert_err_has "belongs to agent 'oc'"
    run_osa_with_input "$(stdin_file 'sk-test-osa-fixture')" provider setup mk --profile maki-deepseek \
        --attach mk-nowhere-0000
    assert_rc 1
    run_osa_with_input "$(stdin_file 'k')" provider setup zz --profile maki-deepseek
    assert_rc 1
    run_osa_with_input "$(stdin_file 'k')" provider setup mk --profile ../x
    assert_rc 1
    run_osa_with_input "$(stdin_file 'k')" provider setup mk --profile maki-deepseek --name Bad_Name
    assert_rc 1
    run_osa_with_input "$(stdin_file 'k')" provider setup mk
    assert_rc 1
    run_osa_with_input "$(stdin_file 'k')" provider remove mk
    assert_rc 1
    assert_log_empty "a refused osa provider setup reached the gateway"

    begin "osa provider setup refuses a login agent and names its command"
    run_osa_with_input "$(stdin_file 'k')" provider setup cx --profile codex-chatgpt --json
    assert_rc 2
    assert_out_has "codex-oss provider setup"
    assert_log_empty "a login agent's setup reached the gateway"

    begin "osa provider setup reports the steps when the attach fails"
    new_case osa-provider-setup-fail
    seed_registry_entry mk-demo-1a2b mk "$CASE/project"
    seed_sandbox mk-demo-1a2b Ready
    ATTACH_FAIL=1
    run_osa_with_input "$(stdin_file 'sk-test-osa-fixture')" provider setup mk --profile maki-deepseek \
        --attach mk-demo-1a2b --json
    assert_rc 3
    assert_out_has '"outcome":"failed"'
    assert_out_has "created maki-deepseek and remembered it; attach to 'mk-demo-1a2b' failed"
    assert_out_has '"steps":["linted","imported","created","remembered"]'
    assert_secret_absent sk-test-osa-fixture
}

# Asserts the credential is in no argv, output, or file under the state and
# config roots.
assert_secret_nowhere() { # VALUE
    assert_secret_absent "$1"
    if grep -rFq -- "$1" "$HOME/.local/state" "$XDG_CONFIG_HOME" 2>/dev/null; then
        bad "a file under the state or config root holds the credential"
    fi
}

test_provider_setup_secret_scan() {
    begin "no setup path leaks the credential to argv, output, state, or config"
    new_case setup-secret-scan
    pss_secret=FIXTURE-SECRET-7c1e9b
    seed_registry_entry mk-demo-1a2b mk "$CASE/project"
    seed_sandbox mk-demo-1a2b Ready
    run_maki_with_input "$(stdin_file "$pss_secret\n")" provider setup --stdin --profile maki-deepseek
    assert_rc 0
    assert_secret_nowhere "$pss_secret"
    run_maki_with_input "$(stdin_file "$pss_secret")" provider setup --stdin --profile maki-deepseek
    assert_rc 1
    assert_secret_nowhere "$pss_secret"
    run_maki_with_input "$(stdin_file "$pss_secret")" provider setup --stdin --profile maki-deepseek --yes
    assert_rc 0
    assert_secret_nowhere "$pss_secret"
    run_maki_with_input "$(stdin_file "$pss_secret\n$pss_secret\n")" provider setup --stdin --profile maki-deepseek --yes
    assert_rc 1
    assert_secret_nowhere "$pss_secret"
    run_osa_with_input "$(stdin_file "$pss_secret")" provider setup mk --profile maki-deepseek \
        --name maki-second --attach mk-demo-1a2b --json
    assert_rc 0
    assert_secret_nowhere "$pss_secret"
    run_osa_with_input "$(stdin_file "$pss_secret")" provider setup mk --profile maki-deepseek --json
    assert_rc 2
    assert_secret_nowhere "$pss_secret"
    ATTACH_FAIL=1
    run_osa_with_input "$(stdin_file "$pss_secret")" provider setup mk --profile maki-deepseek \
        --name maki-third --attach mk-demo-1a2b --json
    assert_rc 3
    assert_secret_nowhere "$pss_secret"
    ATTACH_FAIL=
    PROFILE_LINT_EXIT=1
    run_osa_with_input "$(stdin_file "$pss_secret")" provider setup mk --profile maki-deepseek \
        --name maki-fourth --json
    assert_rc 2
    assert_secret_nowhere "$pss_secret"
    PROFILE_LINT_EXIT=
    GATEWAY_DOWN=1
    run_osa_with_input "$(stdin_file "$pss_secret")" provider setup mk --profile maki-deepseek \
        --name maki-fifth --json
    assert_rc 2
    assert_secret_nowhere "$pss_secret"
    GATEWAY_DOWN=
    run_osa_with_input "$(stdin_file '')" provider setup mk --profile maki-deepseek --name maki-sixth --json
    assert_rc 1
    assert_secret_nowhere "$pss_secret"
}

# ---------------------------------------------------------------------------
# Base images (specs/osa-project-layer: "osa reports and builds base images").
# ---------------------------------------------------------------------------

test_image_build_forwards_term() {
    begin "image build forwards SIGTERM to the engine and leaves no engine process"
    new_case image-build-term
    BUILD_MODE='sleep'
    BUILD_PID_FILE=$CASE/build.pid
    BUILD_SIGNAL_LOG=$CASE/build-signal.log
    (
        run_maki image build
        printf '%s' "$RC" >"$CASE/rc"
    ) &
    ibt_bg=$!
    ibt_i=0
    while [ ! -s "$BUILD_PID_FILE.sleep" ] && [ "$ibt_i" -lt 100 ]; do
        sleep 0.1
        ibt_i=$((ibt_i + 1))
    done
    if [ ! -s "$BUILD_PID_FILE.sleep" ]; then
        bad "the stub engine never started"
        kill "$ibt_bg" 2>/dev/null || :
        return
    fi
    ibt_engine=$(cat "$BUILD_PID_FILE")
    ibt_sleep=$(cat "$BUILD_PID_FILE.sleep")
    # The engine's parent is the front-end; signal it alone.
    ibt_front=$(ps -o ppid= -p "$ibt_engine" | tr -d ' ')
    kill -TERM "$ibt_front"
    wait "$ibt_bg" || :
    [ "$(cat "$CASE/rc" 2>/dev/null)" != 0 ] || bad "the front-end exited 0 after SIGTERM"
    grep -Fqx TERM "$BUILD_SIGNAL_LOG" 2>/dev/null || bad "the engine did not receive SIGTERM"
    sleep 0.2
    if kill -0 "$ibt_engine" 2>/dev/null || kill -0 "$ibt_sleep" 2>/dev/null; then
        bad "an engine process from the build remains"
        kill "$ibt_engine" "$ibt_sleep" 2>/dev/null || :
    fi
}

test_image_json() {
    begin "__image-json reports a present, missing, or configured base image"
    new_case image-json
    run_maki __image-json
    assert_rc 0
    if have_jq; then
        [ "$(out_value '[.agent, .image, .engine, .present, .id, (.configured | tostring), (.error | tostring)] | map(tostring) | join(" ")')" \
            = "mk maki-agent:local docker true sha256:stub null null" ] || bad "present: $(cat "$OUT")"
    fi
    IMAGE_INSPECT=missing
    run_maki __image-json
    assert_rc 0
    if have_jq; then
        [ "$(out_value '[.present, (.error | tostring)] | map(tostring) | join(" ")')" = "false null" ] \
            || bad "missing: $(cat "$OUT")"
    fi
    IMAGE_INSPECT=error
    run_maki __image-json
    assert_rc 0
    if have_jq; then
        out_value '.error.message' | grep -q 'permission denied' || bad "inspect failure: $(cat "$OUT")"
    fi
    IMAGE_INSPECT=
    mkdir -p "$XDG_CONFIG_HOME/maki-oss"
    printf 'image = "maki-env:me"\n' >"$XDG_CONFIG_HOME/maki-oss/config.toml"
    run_maki __image-json
    assert_rc 0
    if have_jq; then
        [ "$(out_value '.image + " " + .configured')" = "maki-agent:local maki-env:me" ] \
            || bad "configured: $(cat "$OUT")"
    fi
    printf 'engine = "no-such-engine"\n' >"$XDG_CONFIG_HOME/maki-oss/config.toml"
    run_maki __image-json
    assert_rc 0
    assert_out_has "container engine 'no-such-engine' not found on PATH"
    assert_log_line_missing build
    oc_case image-json-oc
    run_oc __image-json
    assert_rc 0
    assert_out_has '"image":"opencode-agent:local"'
}

test_osa_images() {
    begin "osa images reports every agent with no build and no gateway call"
    new_case osa-images
    IMAGE_INSPECT=missing
    run_osa images --json
    assert_rc 0
    assert_json_array 4
    if have_jq; then
        [ "$(out_value '[.[] | .agent + ":" + (.present | tostring)] | join(",")')" \
            = "mk:false,oc:false,cc:false,cx:false" ] || bad "images: $(cat "$OUT")"
    fi
    if log_invocations | grep -v '^image inspect ' | grep -q .; then
        bad "osa images ran more than image inspect: $(log_invocations | grep -v '^image inspect ')"
    fi
    run_osa images
    assert_rc 0
    assert_out_has "maki-agent:local"
    assert_out_has "missing; run 'osa image build mk'"

    begin "osa image build streams the front-end's build and passes its status through"
    reset_log
    BUILD_MODE=lines
    run_osa image build oc
    assert_rc 0
    assert_out_has "step 1/3"
    assert_out_has "step 3/3"
    assert_invocation "build -t opencode-agent:local $ROOT/opencode-oss/image"
    oib_rc=0
    (
        STUB_ENGINE_EXIT=5
        export STUB_ENGINE_EXIT
        run_osa image build oc
        exit "$RC"
    ) || oib_rc=$?
    [ "$oib_rc" -eq 2 ] || bad "a failed build exited $oib_rc, not the front-end's 2"

    begin "osa image build refuses extra arguments and unknown tags before the engine"
    reset_log
    run_osa image build mk --maki-version 1.2.3
    assert_rc 1
    run_osa image build zz
    assert_rc 1
    run_osa image build
    assert_rc 1
    run_osa image build mk mk
    assert_rc 1
    run_osa image list
    assert_rc 1
    assert_log_empty "a refused image build reached the engine"
}

# ---------------------------------------------------------------------------
# Idle stop state (specs/osa-project-layer: "osa health reports a sandbox's
# health"): idle_state over constructed idle/idle.log files.
# ---------------------------------------------------------------------------

# Appends `LOCAL_TIME EVENT...` to DIR/idle.log, SECONDS_AGO before now, in the
# local time of the current TZ, the way idle_log writes it.
idle_line() { # DIR SECONDS_AGO EVENT...
    il_dir=$1
    il_epoch=$(($(date +%s) - $2))
    shift 2
    il_local=$(date -d "@$il_epoch" '+%Y-%m-%dT%H:%M:%S' 2>/dev/null \
        || date -r "$il_epoch" '+%Y-%m-%dT%H:%M:%S')
    mkdir -p "$il_dir"
    printf '%s %s\n' "$il_local" "$*" >>"$il_dir/idle.log"
}

# Seconds since the epoch for an ISO 8601 UTC time.
iso_epoch() { # TIME
    date -u -d "$1" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$1" +%s
}

idle_state_of() { # DIR [SECS]
    (. "$ROOT/lib/osa-state.sh" && idle_state "$@")
}

# Field N (1-based) of an idle_state line.
idle_field() { # LINE N
    printf '%s\n' "$1" | awk -F '\t' -v n="$2" '{ print $n }'
}

# Fails unless DEADLINE is SECONDS from now, within 5 seconds.
assert_deadline_in() { # DEADLINE SECONDS
    adi_at=$(iso_epoch "$1") || { bad "deadline is not ISO 8601 UTC: $1"; return 0; }
    adi_off=$((adi_at - $(date +%s) - $2))
    [ "$adi_off" -ge -5 ] && [ "$adi_off" -le 5 ] \
        || bad "deadline $1 is ${adi_off}s off from now + $2s"
}

test_idle_state() {
    begin "idle_state reports every idle-stop state from the idle files"
    new_case idle-state
    is_dead_pid=$(sh -c 'echo $$')

    st=$(idle_state_of "$CASE/none" 3600)
    [ "$(idle_field "$st" 1)" = none ] || bad "no idle.log: $st"
    st=$(idle_state_of "$CASE/none" 0)
    [ "$(idle_field "$st" 1)" = off ] && [ "$(idle_field "$st" 2)" = 0 ] || bad "secs 0: $st"

    idle_line "$CASE/running" 30 "armed secs=3600 session=$$ watcher=1"
    printf '%s.%s\n' "$(date +%s)" "$$" >"$CASE/running/idle"
    st=$(idle_state_of "$CASE/running")
    [ "$(idle_field "$st" 1)" = running ] || bad "a live session: $st"
    [ "$(idle_field "$st" 2)" = 3600 ] || bad "the period comes from the armed line: $st"

    idle_line "$CASE/counting" 900 "armed secs=3600 session=$is_dead_pid watcher=1"
    idle_line "$CASE/counting" 600 "closed session=$is_dead_pid"
    st=$(idle_state_of "$CASE/counting")
    [ "$(idle_field "$st" 1)" = counting ] && [ "$(idle_field "$st" 4)" = false ] \
        || bad "a closed session: $st"
    assert_deadline_in "$(idle_field "$st" 3)" 3000
    [ "$(idle_field "$st" 5)" = closed ] || bad "last event: $st"
    assert_deadline_in "$(idle_field "$st" 6)" -600
    # The watcher's own period (from --idle-stop, say) wins over the setting.
    st=$(idle_state_of "$CASE/counting" 1800)
    assert_deadline_in "$(idle_field "$st" 3)" 3000
    [ "$(idle_field "$st" 2)" = 3600 ] || bad "the armed period was replaced: $st"
    # Without an armed line the setting is the period.
    idle_line "$CASE/no-armed" 600 "closed session=$is_dead_pid"
    st=$(idle_state_of "$CASE/no-armed" 1800)
    assert_deadline_in "$(idle_field "$st" 3)" 1200

    idle_line "$CASE/estimated" 120 "armed secs=3600 session=$is_dead_pid watcher=1"
    printf '%s.%s\n' "$(date +%s)" "$is_dead_pid" >"$CASE/estimated/idle"
    st=$(idle_state_of "$CASE/estimated")
    [ "$(idle_field "$st" 1)" = counting ] && [ "$(idle_field "$st" 4)" = true ] \
        || bad "a dead session without closed is an estimate: $st"
    assert_deadline_in "$(idle_field "$st" 3)" 3600

    for is_case in stopped:stopped superseded:skipped busy:skipped \
        stop-failed:failed scan-failed:failed; do
        is_event=${is_case%%:*}
        idle_line "$CASE/$is_event" 3700 "armed secs=60 session=$is_dead_pid watcher=1"
        idle_line "$CASE/$is_event" 3600 "closed session=$is_dead_pid"
        idle_line "$CASE/$is_event" 3540 "$is_event session=$is_dead_pid"
        st=$(idle_state_of "$CASE/$is_event")
        [ "$(idle_field "$st" 1)" = "${is_case#*:}" ] || bad "$is_event: $st"
        [ "$(idle_field "$st" 3)" = - ] || bad "$is_event has a deadline: $st"
        [ "$(idle_field "$st" 5)" = "$is_event" ] || bad "$is_event last event: $st"
    done

    begin "idle_state converts local log times to UTC in any time zone"
    for is_tz in Asia/Yekaterinburg America/New_York UTC; do
        rm -rf "$CASE/tz"
        st=$(
            TZ=$is_tz
            export TZ
            idle_line "$CASE/tz" 900 "armed secs=3600 session=$is_dead_pid watcher=1"
            idle_line "$CASE/tz" 600 "closed session=$is_dead_pid"
            idle_state_of "$CASE/tz"
        )
        case $(idle_field "$st" 3) in
            *Z) ;;
            *) bad "$is_tz: the deadline is not UTC: $st" ;;
        esac
        assert_deadline_in "$(idle_field "$st" 3)" 3000
    done
}

test_osa_quick_idle() {
    begin "osa status --quick reports the idle deadline without the gateway"
    new_case osa-quick-idle
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    run_maki up
    assert_rc 0
    oqi_dead=$(sh -c 'echo $$')
    idle_line "$(session_dir maki-myproject)" 900 "armed secs=3600 session=$oqi_dead watcher=1"
    idle_line "$(session_dir maki-myproject)" 600 "closed session=$oqi_dead"
    reset_log
    run_osa status --quick --json
    assert_rc 0
    assert_json_array 1
    assert_out_has '"idle":{"period":3600,"state":"counting","deadline":"'
    oqi_deadline=$(sed -n 's/.*"idle":{[^}]*"deadline":"\([^"]*\)".*/\1/p' "$OUT")
    assert_deadline_in "$oqi_deadline" 3000
    if [ -s "$LOG" ]; then
        bad "--quick contacted the gateway: $(tr '\n' ' ' <"$LOG")"
    fi
    run_osa status --quick
    assert_rc 0
    assert_out_has "Idle stop: counting down; stop due $oqi_deadline (period 3600s)"
    [ ! -s "$LOG" ] || bad "--quick text contacted the gateway"
}

# ---------------------------------------------------------------------------
# osa resolve (specs/osa-project-layer: "osa resolves retained patches",
# "osa resolves parked workspaces", "Session and resolve exclusion").
# ---------------------------------------------------------------------------

# Runs a front-end (maki, oc, or cc) with its stub environment.
run_front() { # FRONT ARGS...
    rfr_front=$1
    shift
    case $rfr_front in
        maki) run_maki "$@" ;;
        oc) run_oc "$@" ;;
        cc) run_cc "$@" ;;
    esac
}

# Starts a case with FRONT's settings cleared (maki, oc, or cc).
front_case() { # FRONT NAME
    case $1 in
        maki) new_case "$2" ;;
        oc) oc_case "$2" ;;
        cc) cc_case "$2" ;;
    esac
}

# Runs osa with FRONT's environment, so `resolve` reaches that front-end with
# the same settings the sessions used.
run_osa_for() { # FRONT ARGS...
    rof_rc=0
    (
        MAKI=$OSA
        OC=$OSA
        CC=$OSA
        run_front "$@"
        exit "$RC"
    ) || rof_rc=$?
    RC=$rof_rc
}

# Leaves FRONT's sandbox with one pending kind. Sets RUN_DIR, RS_NAME (the
# sandbox), and RS_PATCH (the retained patch, if any); stderr keeps the exit
# sync's recovery block.
#   clean     retained: git project; the host committed during the session
#   conflict  retained: the host edited the patch's lines during the session
#   dirty     retained: dirty baseline; the agent changed another file
#   plain     retained: plain folder; the host had no git and no patch at exit
#   binary    retained: like plain, with a binary file in the patch
#   parked    parked: --no-sync
resolve_fixture() { # FRONT KIND
    rsf_front=$1
    rsf_kind=$2
    case $rsf_kind in
        plain|binary|parked) rsf_dir=myproject ;;
        *) rsf_dir=repo ;;
    esac
    RUN_DIR=$CASE/project/$rsf_dir
    RS_NAME=$rsf_front-$rsf_dir
    case $rsf_kind in
        plain|binary|parked)
            mkdir -p "$RUN_DIR"
            printf 'base\n' >"$RUN_DIR/file.txt"
            ;;
        *)
            seed_git_project "$RUN_DIR"
            ;;
    esac
    if [ "$rsf_kind" = dirty ]; then
        printf 'local edit\n' >>"$RUN_DIR/tracked.txt"
    fi
    seed_sandbox "$RS_NAME" Ready
    case $rsf_front in
        maki)
            seed_remembered_provider maki-stub
            attach_stub_provider "$RS_NAME" maki-stub
            ;;
        oc)
            seed_oc_provider opencode-stub
            attach_stub_provider "$RS_NAME" opencode-stub
            ;;
        cc)
            seed_cc_provider claude-anthropic
            attach_stub_provider "$RS_NAME" claude-anthropic
            ;;
    esac
    case $rsf_kind in
        clean|conflict)
            run_front "$rsf_front" upload .
            ;;
    esac
    case $rsf_kind in
        clean)
            STUB_MAKI_SCRIPT='printf "agent\n" > agent.txt
printf "host\n" > "'"$RUN_DIR"'/host.txt"
git -C "'"$RUN_DIR"'" add host.txt
git -C "'"$RUN_DIR"'" commit -q -m host-move'
            ;;
        conflict)
            STUB_MAKI_SCRIPT='printf "agent\n" > tracked.txt
printf "host edit\n" > "'"$RUN_DIR"'/tracked.txt"'
            ;;
        dirty)
            STUB_MAKI_SCRIPT='printf "agent new\n" > new.txt'
            ;;
        plain|parked)
            STUB_MAKI_SCRIPT='printf "agent\n" > file.txt'
            ;;
        binary)
            STUB_MAKI_SCRIPT='printf "agent\n" > file.txt
printf "\000\001\002" > data.bin'
            ;;
    esac
    case $rsf_kind in
        plain|binary) PATH_OVERRIDE=$(no_git_path) ;;
    esac
    if [ "$rsf_kind" = parked ]; then
        run_front "$rsf_front" --no-sync run "edit"
    else
        run_front "$rsf_front" run "edit"
    fi
    PATH_OVERRIDE=
    STUB_MAKI_SCRIPT=
    RS_PATCH=$(pending_value "$RS_NAME" patch)
}

# Prints every project file (not .git) with its checksum, plus HEAD and the
# index state for a git project.
project_snapshot() {
    (cd "$RUN_DIR" && find . -path ./.git -prune -o -type f -print | LC_ALL=C sort \
        | while IFS= read -r ps_file; do
            printf '%s %s\n' "$ps_file" "$(cksum <"$ps_file")"
        done)
    if [ -d "$RUN_DIR/.git" ]; then
        git -C "$RUN_DIR" rev-parse HEAD
        git -C "$RUN_DIR" status --porcelain=v1 -z | cksum
        git -C "$RUN_DIR" diff --cached | cksum
    fi
}

# Checks that stdout is exactly one JSON object (with jq when present) for
# which FILTER holds.
assert_json_object() { # FILTER
    if [ "$(wc -l <"$OUT" | tr -d ' ')" != 1 ]; then
        bad "stdout is not one line: $(cat "$OUT")"
        return
    fi
    if command -v jq >/dev/null 2>&1; then
        jq -e "type == \"object\" and ($1)" "$OUT" >/dev/null 2>&1 \
            || bad "stdout fails '$1': $(cat "$OUT")"
    else
        case $(cat "$OUT") in
            '{"sandbox":'*'}') ;;
            *) bad "stdout is not a JSON object: $(cat "$OUT")" ;;
        esac
    fi
}

test_resolve_fixtures() {
    begin "resolve fixtures leave the expected pending kind for maki-oss and opencode-oss"
    for rf_front in maki oc; do
        for rf_kind in clean conflict dirty plain parked; do
            front_case "$rf_front" "resolve-fixture-$rf_front-$rf_kind"
            resolve_fixture "$rf_front" "$rf_kind"
            rf_expect=retained
            [ "$rf_kind" = parked ] && rf_expect=parked
            run_osa projects --json
            assert_rc 0
            assert_out_has "\"pending\":\"$rf_expect\""
            if [ "$rf_expect" = retained ] && [ ! -s "$RS_PATCH" ]; then
                bad "$rf_front $rf_kind: no retained patch file"
            fi
        done
    done
}

test_resolve_dispatch_refusals() {
    begin "osa resolve validates the action and refuses unregistered and orphan sandboxes"
    new_case resolve-dispatch
    mkdir -p "$CASE/project"
    run_osa help
    assert_rc 0
    assert_out_has "resolve SANDBOX ACTION"
    run_osa up
    assert_rc 1
    assert_err_has "projects, status, health, providers, images, resolve, provider setup, image build, dashboard, help"
    run_osa resolve
    assert_rc 1
    run_osa resolve maki-x frobnicate
    assert_rc 1
    assert_err_has "unknown resolve action"
    run_osa resolve maki-x apply extra
    assert_rc 1

    reset_log
    run_osa resolve maki-nope apply
    assert_rc 2
    assert_err_has "not registered"
    run_osa resolve ../projects/maki-nope apply
    assert_rc 2
    assert_err_has "not registered"
    run_osa resolve maki-nope apply --json
    assert_rc 2
    assert_json_object '.ok == false and .action == "apply" and .sandbox == "maki-nope" and .changed == []'

    seed_registry_entry mk-ghost-0000 mk "$CASE/project/gone"
    run_osa resolve mk-ghost-0000 drop --yes
    assert_rc 2
    assert_err_has "folder for 'mk-ghost-0000' is missing"
    if [ -s "$LOG" ]; then
        bad "a refusal contacted the gateway: $(tr '\n' ' ' <"$LOG")"
    fi
    [ -f "$(registry_entry mk-ghost-0000)" ] || bad "the refusal removed the orphan's entry"
}

test_resolve_wrong_kind() {
    begin "osa resolve refuses an action for the other pending kind, for every front-end"
    for wk_front in maki oc cc; do
        front_case "$wk_front" "resolve-kind-parked-$wk_front"
        resolve_fixture "$wk_front" parked
        project_snapshot >"$CASE/before.txt"
        reset_log
        run_osa_for "$wk_front" resolve "$RS_NAME" apply
        assert_rc 2
        assert_err_has "parked"
        assert_err_has "osa resolve $RS_NAME rescue"
        assert_err_has "osa resolve $RS_NAME discard --yes"
        [ "$(pending_value "$RS_NAME" kind)" = parked ] || bad "$wk_front: the marker changed"
        project_snapshot >"$CASE/after.txt"
        cmp -s "$CASE/before.txt" "$CASE/after.txt" || bad "$wk_front: a refused apply changed the project"
        if [ -s "$LOG" ]; then
            bad "$wk_front: a refused apply contacted the gateway"
        fi

        front_case "$wk_front" "resolve-kind-retained-$wk_front"
        resolve_fixture "$wk_front" plain
        reset_log
        run_osa_for "$wk_front" resolve "$RS_NAME" rescue
        assert_rc 2
        assert_err_has "retained patch"
        assert_err_has "osa resolve $RS_NAME apply"
        assert_err_has "osa resolve $RS_NAME branch"
        assert_err_has "osa resolve $RS_NAME drop --yes"
        assert_log_missing "download"
        [ "$(pending_value "$RS_NAME" kind)" = retained ] || bad "$wk_front: the marker changed"
        [ -s "$RS_PATCH" ] || bad "$wk_front: the patch is gone"
    done

    begin "osa resolve refuses when nothing is pending"
    new_case resolve-kind-none
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    run_maki up
    assert_rc 0
    run_osa resolve maki-myproject drop --yes
    assert_rc 2
    assert_err_has "nothing is pending"
}

test_resolve_json_output() {
    begin "osa resolve --json prints one result object for success, refusal, and failure"
    new_case resolve-json-ok
    resolve_fixture maki plain
    run_osa resolve "$RS_NAME" drop --yes --json
    assert_rc 0
    assert_json_object '.ok == true and .action == "drop" and (.changed | length) == 1 and (.message | length) > 0'

    new_case resolve-json-refused
    resolve_fixture maki parked
    run_osa resolve "$RS_NAME" apply --json
    assert_rc 2
    assert_json_object '.ok == false and (.message | test("parked"))'

    new_case resolve-json-failed
    resolve_fixture maki parked
    DOWNLOAD_EXIT=1
    run_osa resolve "$RS_NAME" rescue --json
    assert_rc 3
    assert_json_object '.ok == false and .action == "rescue" and .changed == []'
    if [ -n "$(find "$(session_dir "$RS_NAME")" -maxdepth 1 -name 'rescue-*' 2>/dev/null)" ]; then
        bad "a failed rescue left its directory"
    fi
    [ "$(pending_value "$RS_NAME" kind)" = parked ] || bad "a failed rescue changed the marker"
}

test_resolve_apply() {
    begin "resolve apply changes only the working tree and clears the marker"
    new_case resolve-apply-clean
    resolve_fixture maki clean
    head_before=$(git -C "$RUN_DIR" rev-parse HEAD)
    reset_log
    run_osa resolve "$RS_NAME" apply
    assert_rc 0
    assert_out_has "Applied the retained patch"
    [ "$(cat "$RUN_DIR/agent.txt" 2>/dev/null)" = agent ] || bad "the patch's change is not in the host"
    [ "$(git -C "$RUN_DIR" rev-parse HEAD)" = "$head_before" ] || bad "apply moved HEAD"
    git -C "$RUN_DIR" diff --cached --quiet || bad "apply staged changes"
    [ ! -f "$(session_dir "$RS_NAME")/pending" ] || bad "apply left the marker"
    [ -s "$RS_PATCH" ] || bad "apply removed the patch file"
    if [ -s "$LOG" ]; then
        bad "apply contacted the gateway: $(tr '\n' ' ' <"$LOG")"
    fi
    # The next session refreshes the workspace instead of parking it.
    run_maki status
    assert_out_has "Sync:      behind"

    begin "resolve apply refuses a conflicting patch and changes nothing"
    new_case resolve-apply-conflict
    resolve_fixture maki conflict
    project_snapshot >"$CASE/before.txt"
    run_osa resolve "$RS_NAME" apply
    assert_rc 2
    assert_err_has "does not apply cleanly"
    assert_err_has "osa resolve $RS_NAME branch"
    project_snapshot >"$CASE/after.txt"
    cmp -s "$CASE/before.txt" "$CASE/after.txt" || bad "a refused apply changed the project"
    [ "$(pending_value "$RS_NAME" kind)" = retained ] || bad "a refused apply changed the marker"

    begin "resolve apply of an already-applied patch only clears the marker"
    new_case resolve-apply-present
    resolve_fixture maki clean
    git -C "$RUN_DIR" apply "$RS_PATCH"
    project_snapshot >"$CASE/before.txt"
    run_osa resolve "$RS_NAME" apply
    assert_rc 0
    assert_out_has "already in"
    project_snapshot >"$CASE/after.txt"
    cmp -s "$CASE/before.txt" "$CASE/after.txt" || bad "an applied patch changed the project again"
    [ ! -f "$(session_dir "$RS_NAME")/pending" ] || bad "the marker was not cleared"

    begin "resolve apply works in a plain folder with git and with patch"
    new_case resolve-apply-plain-git
    resolve_fixture maki plain
    run_osa resolve "$RS_NAME" apply
    assert_rc 0
    [ "$(cat "$RUN_DIR/file.txt")" = agent ] || bad "git apply did not change the plain folder"
    [ ! -f "$(session_dir "$RS_NAME")/pending" ] || bad "the marker was not cleared"

    if command -v patch >/dev/null 2>&1; then
        new_case resolve-apply-plain-patch
        resolve_fixture maki plain
        PATH_OVERRIDE=$(no_git_path with_patch)
        run_osa resolve "$RS_NAME" apply
        assert_rc 0
        [ "$(cat "$RUN_DIR/file.txt")" = agent ] || bad "patch did not change the plain folder"
        [ ! -f "$(session_dir "$RS_NAME")/pending" ] || bad "the marker was not cleared"
        run_osa resolve "$RS_NAME" apply
        assert_rc 2

        new_case resolve-apply-binary-no-git
        resolve_fixture maki binary
        PATH_OVERRIDE=$(no_git_path with_patch)
        project_snapshot >"$CASE/before.txt"
        run_osa resolve "$RS_NAME" apply
        assert_rc 2
        assert_err_has "binary changes"
        assert_err_has "osa resolve $RS_NAME branch"
        project_snapshot >"$CASE/after.txt"
        cmp -s "$CASE/before.txt" "$CASE/after.txt" || bad "a refused binary apply changed the project"
        PATH_OVERRIDE=
    else
        skipped "no patch tool on this host"
    fi
}

test_resolve_branch() {
    begin "resolve branch commits on the recorded base without touching the checkout"
    new_case resolve-branch-dirty
    resolve_fixture maki dirty
    base=$(baseline_value "$RS_NAME" base)
    [ -n "$base" ] || bad "the fixture recorded no base"
    head_before=$(git -C "$RUN_DIR" rev-parse HEAD)
    status_before=$(git -C "$RUN_DIR" status --porcelain=v1 -z | cksum)
    worktrees_before=$(git -C "$RUN_DIR" worktree list | wc -l | tr -d ' ')
    reset_log
    run_osa resolve "$RS_NAME" branch --json
    assert_rc 0
    assert_json_object '.ok == true and (.changed[0] | startswith("refs/heads/osa/"))'
    branch=$(git -C "$RUN_DIR" for-each-ref --format='%(refname:short)' 'refs/heads/osa/*' | head -n 1)
    case $branch in
        "osa/$RS_NAME-"[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
        *) bad "unexpected branch name: '$branch'" ;;
    esac
    if [ -n "$branch" ]; then
        [ "$(git -C "$RUN_DIR" rev-parse "$branch^")" = "$base" ] \
            || bad "the branch commit's parent is not the recorded base"
        branch_id=$(git -C "$RUN_DIR" diff --binary --full-index "$base" "$branch" | git patch-id --stable | cut -d' ' -f1)
        patch_id=$(git patch-id --stable <"$RS_PATCH" | cut -d' ' -f1)
        [ -n "$patch_id" ] && [ "$branch_id" = "$patch_id" ] || bad "the branch diff differs from the patch"
    fi
    [ "$(git -C "$RUN_DIR" rev-parse HEAD)" = "$head_before" ] || bad "branch moved HEAD"
    [ "$(git -C "$RUN_DIR" status --porcelain=v1 -z | cksum)" = "$status_before" ] \
        || bad "branch changed the working tree or index"
    [ "$(git -C "$RUN_DIR" worktree list | wc -l | tr -d ' ')" = "$worktrees_before" ] \
        || bad "branch left a worktree"
    [ ! -f "$(session_dir "$RS_NAME")/pending" ] || bad "branch left the marker"
    [ -s "$RS_PATCH" ] || bad "branch removed the patch file"
    if [ -s "$LOG" ]; then
        bad "branch contacted the gateway"
    fi

    begin "resolve branch leaves no branch behind on a conflict"
    new_case resolve-branch-conflict
    resolve_fixture maki conflict
    git -C "$RUN_DIR" commit -qam "host edit"
    conflict_base=$(git -C "$RUN_DIR" rev-parse HEAD)
    sed "s/^base=.*/base=$conflict_base/" "$(session_dir "$RS_NAME")/baseline" >"$CASE/baseline"
    cp "$CASE/baseline" "$(session_dir "$RS_NAME")/baseline"
    project_snapshot >"$CASE/before.txt"
    worktrees_before=$(git -C "$RUN_DIR" worktree list | wc -l | tr -d ' ')
    run_osa resolve "$RS_NAME" branch
    assert_rc 2
    assert_err_has "conflicts"
    [ -z "$(git -C "$RUN_DIR" branch --list 'osa/*')" ] || bad "a conflict left a branch"
    [ "$(git -C "$RUN_DIR" worktree list | wc -l | tr -d ' ')" = "$worktrees_before" ] \
        || bad "a conflict left a worktree"
    project_snapshot >"$CASE/after.txt"
    cmp -s "$CASE/before.txt" "$CASE/after.txt" || bad "a conflict changed the project"
    [ "$(pending_value "$RS_NAME" kind)" = retained ] || bad "a conflict changed the marker"

    begin "resolve branch refuses a missing base and a plain folder"
    sed "s/^base=.*/base=0123456789abcdef0123456789abcdef01234567/" "$CASE/baseline" \
        >"$(session_dir "$RS_NAME")/baseline"
    run_osa resolve "$RS_NAME" branch
    assert_rc 2
    assert_err_has "no longer in the repository"

    new_case resolve-branch-plain
    resolve_fixture maki plain
    run_osa resolve "$RS_NAME" branch
    assert_rc 2
    assert_err_has "osa resolve $RS_NAME apply"
    [ "$(pending_value "$RS_NAME" kind)" = retained ] || bad "a refused branch changed the marker"
}

test_resolve_drop() {
    begin "resolve drop needs --yes and moves the patch into dropped/"
    new_case resolve-drop
    resolve_fixture maki plain
    run_osa resolve "$RS_NAME" drop
    assert_rc 2
    assert_err_has "--yes"
    [ -s "$RS_PATCH" ] || bad "drop without --yes moved the patch"
    [ "$(pending_value "$RS_NAME" kind)" = retained ] || bad "drop without --yes changed the marker"

    run_osa resolve "$RS_NAME" drop --yes
    assert_rc 0
    dropped=$(session_dir "$RS_NAME")/dropped/$(basename -- "$RS_PATCH")
    [ -s "$dropped" ] || bad "the patch is not in dropped/"
    [ ! -e "$RS_PATCH" ] || bad "the patch is still at its old path"
    [ ! -f "$(session_dir "$RS_NAME")/pending" ] || bad "drop left the marker"
    [ "$(cat "$RUN_DIR/file.txt")" = base ] || bad "drop changed a project file"
}

test_resolve_rescue() {
    begin "resolve rescue downloads into the session directory and stays parked"
    new_case resolve-rescue
    resolve_fixture maki parked
    project_snapshot >"$CASE/before.txt"
    reset_log
    run_osa resolve "$RS_NAME" rescue
    assert_rc 0
    rescue_dir=$(find "$(session_dir "$RS_NAME")" -maxdepth 1 -type d -name 'rescue-*' | head -n 1)
    [ -n "$rescue_dir" ] || bad "no rescue directory"
    [ "$(cat "$rescue_dir/file.txt" 2>/dev/null)" = agent ] || bad "the rescue copy lacks the workspace files"
    assert_out_has "$rescue_dir"
    download_dests=$(awk '
        $0 == "---" { n = 0; next }
        { n++; arg[n] = $0 }
        n == 5 && arg[1] == "sandbox" && arg[2] == "download" { print arg[5] }' "$LOG")
    [ "$(printf '%s\n' "$download_dests" | grep -c .)" = 1 ] || bad "expected one download, got: $download_dests"
    case $download_dests in
        "$rescue_dir"/) ;;
        *) bad "the download went outside the rescue directory: $download_dests" ;;
    esac
    project_snapshot >"$CASE/after.txt"
    cmp -s "$CASE/before.txt" "$CASE/after.txt" || bad "rescue changed the project"
    [ "$(pending_value "$RS_NAME" kind)" = parked ] || bad "rescue changed the marker"

    begin "resolve rescue starts a stopped sandbox and says so"
    printf 'Stopped\n' >"$STUB_STATE_DIR/sandboxes/$RS_NAME"
    run_osa resolve "$RS_NAME" rescue
    assert_rc 0
    assert_out_has "Started sandbox '$RS_NAME'"
}

test_resolve_discard() {
    begin "resolve discard needs --yes and replaces the parked workspace"
    new_case resolve-discard
    resolve_fixture maki parked
    old_patch=$(session_dir "$RS_NAME")/patch-old.patch
    printf '+old\n' >"$old_patch"
    reset_log
    run_osa resolve "$RS_NAME" discard
    assert_rc 2
    assert_err_has "--yes"
    assert_log_missing "upload"
    [ "$(pending_value "$RS_NAME" kind)" = parked ] || bad "discard without --yes changed the marker"

    printf 'Stopped\n' >"$STUB_STATE_DIR/sandboxes/$RS_NAME"
    run_osa resolve "$RS_NAME" discard --yes
    assert_rc 2
    assert_err_has "is Stopped"
    assert_log_missing "upload"
    assert_log_line_missing "start"
    printf 'Ready\n' >"$STUB_STATE_DIR/sandboxes/$RS_NAME"

    run_osa resolve "$RS_NAME" discard --yes
    assert_rc 0
    assert_log_has "upload"
    [ ! -f "$(session_dir "$RS_NAME")/pending" ] || bad "discard left the marker"
    [ -f "$old_patch" ] || bad "discard removed an existing patch file"
    [ "$(cat "$SANDBOX_WORKDIR/file.txt")" = base ] || bad "the workspace does not match the host"
    run_maki status
    assert_out_has "Sync:      clean"
    run_osa status --json
    assert_out_has '"sync":"clean"'
}

# Starts a process that outlives the next few commands; prints its PID.
start_holder() {
    sleep 60 >/dev/null 2>&1 &
    printf '%s' "$!"
}

# Prints the PID of a process that has exited.
dead_pid() {
    sh -c 'exit 0' &
    dp_pid=$!
    wait "$dp_pid" 2>/dev/null || true
    printf '%s' "$dp_pid"
}

test_resolve_session_lock() {
    begin "resolve refuses while a session holds the sandbox, and a stale lock is ignored"
    new_case resolve-lock
    resolve_fixture maki plain
    lock_dir=$(session_dir "$RS_NAME")/locks
    [ -d "$lock_dir" ] || bad "the session took no lock"
    [ -z "$(find "$lock_dir" -name 'session.*')" ] || bad "the finished session left its lock file"
    holder=$(start_holder)
    : >"$lock_dir/session.$holder"
    run_osa resolve "$RS_NAME" drop --yes
    assert_rc 2
    assert_err_has "a session is running"
    assert_err_has "PID $holder"
    [ -s "$RS_PATCH" ] || bad "a refused drop moved the patch"
    [ ! -d "$lock_dir/resolve.d" ] || bad "a refused resolve kept its lock"

    begin "osa status --quick reports busy while a holder lives"
    run_osa status --quick --json
    assert_out_has '"busy":true'
    kill "$holder" 2>/dev/null || true
    wait "$holder" 2>/dev/null || true
    run_osa status --quick --json
    assert_out_has '"busy":false'

    begin "a stale session lock is cleaned and ignored"
    stale=$(dead_pid)
    : >"$lock_dir/session.$stale"
    run_osa resolve "$RS_NAME" apply
    assert_rc 0
    [ ! -e "$lock_dir/session.$stale" ] || bad "the stale lock file was not removed"
    [ ! -d "$lock_dir/resolve.d" ] || bad "resolve did not release its lock"

    begin "a session refuses to start while a resolve runs, and sessions share"
    new_case resolve-lock-session
    resolve_fixture maki parked
    lock_dir=$(session_dir "$RS_NAME")/locks
    holder=$(start_holder)
    mkdir -p "$lock_dir/resolve.d"
    printf '%s\n' "$holder" >"$lock_dir/resolve.d/pid"
    reset_log
    run_maki run "edit"
    assert_rc 1
    assert_err_has "osa resolve is running"
    assert_err_has "PID $holder"
    assert_log_missing "exec"
    kill "$holder" 2>/dev/null || true
    wait "$holder" 2>/dev/null || true
    rm -rf "$lock_dir/resolve.d"
    run_osa resolve "$RS_NAME" discard --yes
    assert_rc 0

    holder=$(start_holder)
    : >"$lock_dir/session.$holder"
    run_maki run "edit"
    assert_rc 0
    [ -e "$lock_dir/session.$holder" ] || bad "a session removed another live session's lock"
    [ "$(find "$lock_dir" -name 'session.*' | wc -l | tr -d ' ')" = 1 ] \
        || bad "the session did not release its own lock"
    kill "$holder" 2>/dev/null || true
    wait "$holder" 2>/dev/null || true

    begin "a stale resolve lock does not block a session"
    stale=$(dead_pid)
    mkdir -p "$lock_dir/resolve.d"
    printf '%s\n' "$stale" >"$lock_dir/resolve.d/pid"
    run_maki run "edit"
    assert_rc 0
    [ ! -d "$lock_dir/resolve.d" ] || bad "the stale resolve lock was not removed"
}

test_resolve_recovery_text() {
    begin "Recovery names the osa resolve commands"
    for rt_front in maki oc; do
        front_case "$rt_front" "resolve-recovery-$rt_front"
        resolve_fixture "$rt_front" conflict
        assert_err_has "osa resolve $RS_NAME apply"
        assert_err_has "osa resolve $RS_NAME branch"
        assert_err_has "osa resolve $RS_NAME drop --yes"

        front_case "$rt_front" "resolve-recovery-parked-$rt_front"
        resolve_fixture "$rt_front" parked
        assert_err_has "osa resolve $RS_NAME rescue"
        assert_err_has "osa resolve $RS_NAME discard --yes"
    done
}

# ---------------------------------------------------------------------------
# Caller-owned workspace mode (MAKI_OSS_WORKSPACE=caller): oskhs drives the
# helper from a fresh directory per round against a workspace it owns.
# ---------------------------------------------------------------------------

# A caller-mode case: sandbox repo-app, one task workspace per run, each run
# from its own empty directory.
caller_case() { # NAME
    new_case "$1"
    ENV_WORKSPACE=caller
    ENV_NAME=repo-app
    NAME_PIN=
    # oskhs always names its providers.
    ENV_PROVIDERS=maki-stub
    PROVIDER_NAMES=maki-stub
    mkdir -p "$CASE/sandbox/tasks/t1" "$CASE/sandbox/tasks/t2" "$CASE/cwd1" "$CASE/cwd2" "$CASE/cwd3"
}

assert_no_session_state() { # SANDBOX
    for anss_file in pending synced baseline; do
        if [ -e "$(session_dir "$1")/$anss_file" ]; then
            bad "session state '$anss_file' written for $1"
        fi
    done
    if [ -e "$(registry_entry "$1")" ]; then
        bad "registry entry written for $1: $(cat "$(registry_entry "$1")")"
    fi
}

test_caller_consecutive_runs() {
    begin "caller mode: up and two runs from different directories all reach the agent"
    caller_case caller-runs
    RUN_DIR=$CASE/cwd1
    run_maki up
    assert_rc 0
    RUN_DIR=$CASE/cwd2
    ENV_WORKDIR=$CASE/sandbox/tasks/t1
    run_maki run "q1"
    assert_rc 0
    assert_out_has "stub-exec-output"
    RUN_DIR=$CASE/cwd3
    ENV_WORKDIR=$CASE/sandbox/tasks/t2
    run_maki run --no-sync "q2"
    assert_rc 0
    assert_out_has "stub-exec-output"
    assert_log_missing "maki-oss-git"
    assert_log_missing "upload"
    assert_no_session_state repo-app
}

test_caller_parked_marker_ignored() {
    begin "caller mode: a parked marker neither blocks the run nor changes"
    caller_case caller-parked
    seed_sandbox repo-app Ready
    attach_stub_provider repo-app maki-stub
    mkdir -p "$(session_dir repo-app)"
    printf 'kind = "parked"\nsandbox = "repo-app"\nsandbox_id = "id-repo-app"\nreason = "no-sync"\n' \
        >"$(session_dir repo-app)/pending"
    cp "$(session_dir repo-app)/pending" "$CASE/pending.before"
    RUN_DIR=$CASE/cwd1
    ENV_WORKDIR=$CASE/sandbox/tasks/t1
    run_maki run "q"
    assert_rc 0
    assert_out_has "stub-exec-output"
    cmp -s "$CASE/pending.before" "$(session_dir repo-app)/pending" \
        || bad "the parked marker changed"
}

test_caller_up_no_upload() {
    begin "caller mode: creating the sandbox uploads nothing"
    caller_case caller-up
    RUN_DIR=$CASE/cwd1
    printf 'not for the sandbox\n' >"$RUN_DIR/file.txt"
    run_maki up
    assert_rc 0
    assert_log_has "create"
    assert_log_missing "upload"
    assert_no_session_state repo-app
}

test_caller_requires_name_and_workdir() {
    begin "caller mode: a missing name, a name pattern, or a missing workdir is a usage error"
    caller_case caller-explicit
    RUN_DIR=$CASE/cwd1
    ENV_NAME=
    run_maki run "q"
    assert_rc 1
    assert_err_has "MAKI_OSS_SANDBOX_NAME"
    [ -s "$LOG" ] && bad "gateway was contacted: $(cat "$LOG")"
    ENV_NAME='repo-{project}'
    run_maki up
    assert_rc 1
    assert_err_has "MAKI_OSS_SANDBOX_NAME"
    [ -s "$LOG" ] && bad "gateway was contacted: $(cat "$LOG")"
    ENV_NAME=repo-app
    ENV_WORKDIR=
    run_maki run "q"
    assert_rc 1
    assert_err_has "MAKI_OSS_WORKDIR"
    [ -s "$LOG" ] && bad "gateway was contacted: $(cat "$LOG")"
    return 0
}

test_caller_no_policy_advisor() {
    begin "caller mode: the policy advisor stays off"
    caller_case caller-advisor
    seed_sandbox repo-app Ready
    attach_stub_provider repo-app maki-stub
    RUN_DIR=$CASE/cwd1
    ENV_WORKDIR=$CASE/sandbox/tasks/t1
    run_maki run "q"
    assert_rc 0
    assert_log_missing "agent_policy_proposals_enabled"
}

test_caller_run_wrapper() {
    begin "caller mode: the timeout wrapper and caller run tag are unchanged"
    caller_case caller-wrapper
    seed_sandbox repo-app Ready
    attach_stub_provider repo-app maki-stub
    RUN_DIR=$CASE/cwd1
    ENV_WORKDIR=$CASE/sandbox/tasks/t1
    ENV_TIMEOUT=30
    ENV_RUN_TAG=oskhs-t1
    run_maki run "q"
    assert_rc 0
    assert_log_has "maki-oss-run"
    assert_log_has "oskhs-t1"
    assert_log_has "$CASE/sandbox/tasks/t1"
}

test_caller_invalid_mode() {
    begin "an unknown workspace mode is a usage error before any gateway call"
    caller_case caller-invalid
    ENV_WORKSPACE=shared
    RUN_DIR=$CASE/cwd1
    ENV_WORKDIR=$CASE/sandbox/tasks/t1
    run_maki run "q"
    assert_rc 1
    assert_err_has "managed"
    assert_err_has "caller"
    [ -s "$LOG" ] && bad "gateway was contacted: $(cat "$LOG")"
    return 0
}

# ---------------------------------------------------------------------------
# Health (specs/osa-project-layer: "osa health reports a sandbox's health"):
# each front-end's __health-json against its own doctor and mcp status text.
# ---------------------------------------------------------------------------

# Runs FRONT (maki, oc, cc, or cx) with its stub environment.
run_front_any() { # FRONT ARGS...
    rfa_front=$1
    shift
    case $rfa_front in
        cx) run_cx "$@" ;;
        *) run_front "$rfa_front" "$@" ;;
    esac
}

# Renders a health JSON file's MCP section as `mcp status` gate and fix lines.
health_mcp_text() { # FILE
    jq -r '.mcp.servers[]
        | "  \(.name): \([.gates[] | "\(.gate)=\(if .ok then "ok" else "missing" end)"] | join(" ")) transport=\(.transport)",
          (.gates[] | select(.fix != null) | "    fix: \(.fix)")' "$1"
}

# Renders a health JSON file's doctor section as `doctor` check lines.
health_doctor_text() { # FILE
    jq -r '.doctor.checks[] | "\(.status)\u0001\(.name)\u0001\(.detail)"' "$1" \
        | awk -F '\001' '{ printf "%-5s %s: %s\n", $1, $2, $3 }'
}

# Runs FRONT's mcp status, doctor, and __health-json in the current case and
# fails unless the JSON reports the same gates, fixes, and checks.
assert_health_matches() { # FRONT
    run_front_any "$1" mcp status
    grep '^  ' "$OUT" >"$CASE/expected-mcp" || :
    run_front_any "$1" doctor
    grep -E '^(ok|fail|skip|warn) ' "$OUT" >"$CASE/expected-doctor" || :
    run_front_any "$1" __health-json
    assert_rc 0
    cp "$OUT" "$CASE/health.json"
    jq -e 'type == "object"' "$CASE/health.json" >/dev/null 2>&1 \
        || { bad "$1 __health-json is not one JSON object: $(cat "$CASE/health.json")"; return 0; }
    health_mcp_text "$CASE/health.json" >"$CASE/got-mcp"
    cmp -s "$CASE/expected-mcp" "$CASE/got-mcp" \
        || bad "$1 MCP gates differ from mcp status: $(diff "$CASE/expected-mcp" "$CASE/got-mcp" | tr '\n' ' ')"
    health_doctor_text "$CASE/health.json" >"$CASE/got-doctor"
    cmp -s "$CASE/expected-doctor" "$CASE/got-doctor" \
        || bad "$1 doctor checks differ from doctor: $(diff "$CASE/expected-doctor" "$CASE/got-doctor" | tr '\n' ' ')"
    [ -s "$CASE/got-doctor" ] || bad "$1 reported no doctor checks"
}

health_value() { # JQ
    jq -r "$1" "$CASE/health.json"
}

test_health_json_maki() {
    begin "maki-oss __health-json matches its mcp status and doctor"
    command -v jq >/dev/null 2>&1 || { skipped "jq not found"; return 0; }
    new_case health-maki
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_host_mcp stdio
    attach_stub_provider maki-myproject mcp-context7
    seed_exec_stdio 1
    POLICY_FULL='host: mcp.context7.com'
    assert_health_matches maki
    [ "$(health_value '.sandbox + " " + .agent')" = "maki-myproject mk" ] \
        || bad "sandbox and agent: $(health_value '.sandbox + " " + .agent')"
    [ "$(health_value '.mcp.supported')" = true ] && [ "$(health_value '.mcp.ok')" = false ] \
        || bad "a failing gate is not reported: $(health_value '.mcp')"
    health_value '.mcp.servers[] | select(.name == "synthetic") | .gates[] | select(.gate == "runtime") | .fix' \
        | grep -q "provides the runtime 'bun'" || bad "the runtime gate carries no fix"
    [ "$(health_value '.doctor.checks[] | select(.name == "image") | .status')" = ok ] \
        || bad "no image check: $(health_value '.doctor')"
    # The suite runs with MAKI_OSS_IDLE_STOP=0.
    [ "$(health_value '.idle.state + " " + (.idle.period | tostring)')" = "off 0" ] \
        || bad "idle: $(health_value '.idle')"
    assert_log_line_missing start
    # shellcheck disable=SC2016  # the literal ${VAR} placeholder text is the assertion
    assert_secret_absent '${SYNTHETIC_API_KEY}'

    begin "maki-oss __health-json reports a missing image the way doctor does"
    # The stub engine fails every call, so `image inspect` finds nothing.
    STUB_ENGINE_EXIT=1
    export STUB_ENGINE_EXIT
    assert_health_matches maki
    unset STUB_ENGINE_EXIT
    health_value '.doctor.checks[] | select(.name == "image") | .status + " " + .detail' \
        | grep -q '^fail maki-agent:local not found (build it: maki-oss image build)$' \
        || bad "image check: $(health_value '.doctor.checks[] | select(.name == "image")')"
    [ "$(health_value '.doctor.ok')" = false ] || bad "doctor.ok with a missing image"
}

test_health_json_front_ends() {
    begin "opencode-oss __health-json matches its mcp status and doctor"
    command -v jq >/dev/null 2>&1 || { skipped "jq not found"; return 0; }
    oc_case health-oc
    oc_ready_project
    seed_oc_host_mcp "$OC_HOST_MCP"
    EXEC_STDOUT=$(cat "$ROOT/opencode-oss/image/config/opencode.json")
    assert_health_matches oc
    [ "$(health_value '.agent')" = oc ] || bad "agent: $(health_value '.agent')"
    [ "$(health_value '.doctor.checks[] | select(.name == "model") | .status')" = warn ] \
        || bad "the model warning is missing: $(health_value '.doctor')"

    begin "opencode-oss __health-json reports MCP as an error without jq"
    PATH_OVERRIDE=$(no_jq_path)
    run_oc __health-json
    PATH_OVERRIDE=
    assert_rc 0
    cp "$OUT" "$CASE/health.json"
    health_value '.mcp.error' | grep -q 'needs jq' || bad "MCP without jq: $(cat "$OUT")"
    [ "$(health_value '.doctor.checks | length > 0')" = true ] || bad "doctor missing without jq"

    begin "claude-oss __health-json matches its mcp status and doctor"
    cc_case health-cc
    cc_ready_project
    seed_cc_host_mcp "$CC_HOST_MCP"
    EXEC_STDOUT=$(cat "$ROOT/claude-oss/image/claude.json")
    assert_health_matches cc
    [ "$(health_value '.agent')" = cc ] || bad "agent: $(health_value '.agent')"

    begin "codex-oss __health-json matches its mcp status and doctor"
    cx_case health-cx
    cx_ready_project
    seed_cx_host_mcp "$CX_HOST_MCP"
    EXEC_STDOUT='model = "x"'
    assert_health_matches cx
    [ "$(health_value '.agent')" = cx ] || bad "agent: $(health_value '.agent')"
}

test_health_json_stopped() {
    begin "__health-json reports a stopped sandbox's MCP as an error and starts nothing"
    command -v jq >/dev/null 2>&1 || { skipped "jq not found"; return 0; }
    new_case health-stopped
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Stopped
    seed_host_mcp
    reset_log
    run_maki __health-json
    assert_rc 0
    cp "$OUT" "$CASE/health.json"
    health_value '.mcp.error' | grep -q 'not running' || bad "MCP error: $(health_value '.mcp')"
    [ "$(health_value '.mcp.servers | length')" = 0 ] || bad "a stopped sandbox reported servers"
    [ "$(health_value '.doctor.checks | length > 0')" = true ] || bad "doctor missing"
    for hs_verb in start exec create; do
        assert_log_line_missing "$hs_verb"
    done
    phase=$(cat "$STUB_STATE_DIR/sandboxes/maki-myproject")
    [ "$phase" = Stopped ] || bad "the sandbox phase changed to $phase"
}

test_osa_health() {
    begin "osa health reports a registered sandbox through its front-end"
    command -v jq >/dev/null 2>&1 || { skipped "jq not found"; return 0; }
    new_case osa-health
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_maki_store anthropic 'fixture-health-secret-5c1e'
    seed_remembered_provider maki-stub
    run_maki up
    assert_rc 0
    attach_stub_provider maki-myproject maki-stub
    seed_host_mcp
    EXEC_STDOUT=$(sandbox_mcp_fixture)
    POLICY_FULL='host: mcp.context7.com'
    oh_dead=$(sh -c 'echo $$')
    idle_line "$(session_dir maki-myproject)" 900 "armed secs=3600 session=$oh_dead watcher=1"
    idle_line "$(session_dir maki-myproject)" 600 "closed session=$oh_dead"
    ENV_IDLE_STOP=1h

    RUN_DIR=$CASE
    run_osa health maki-myproject --json
    assert_rc 0
    cp "$OUT" "$CASE/health.json"
    [ "$(health_value '.sandbox + " " + .agent')" = "maki-myproject mk" ] \
        || bad "sandbox and agent: $(cat "$OUT")"
    [ "$(health_value '.idle.state + " " + (.idle.period | tostring)')" = "counting 3600" ] \
        || bad "idle: $(health_value '.idle')"
    [ "$(health_value '.mcp.servers[0].gates[] | select(.gate == "provider") | .fix')" = \
        "maki-oss provider attach mcp-context7" ] || bad "MCP: $(health_value '.mcp')"
    [ "$(health_value '.doctor.checks[] | select(.name == "gateway") | .status')" = ok ] \
        || bad "doctor: $(health_value '.doctor')"
    assert_secret_absent 'fixture-health-secret-5c1e'

    run_osa health maki-myproject
    assert_rc 0
    assert_out_has "Health of sandbox 'maki-myproject' (mk):"
    assert_out_has "Idle stop: counting down; stop due "
    assert_out_has "context7: sandbox=ok provider=missing endpoint=ok transport=http"
    assert_out_has "fix: maki-oss provider attach mcp-context7"
    assert_out_has "ok    gateway: connected"
    assert_secret_absent 'fixture-health-secret-5c1e'

    begin "osa health reports MCP and the gateway check as failed when the gateway is down"
    GATEWAY_DOWN=1
    run_osa health maki-myproject --json
    GATEWAY_DOWN=
    assert_rc 0
    cp "$OUT" "$CASE/health.json"
    health_value '.mcp.error' | grep -q 'gateway' || bad "MCP error: $(health_value '.mcp')"
    [ "$(health_value '.doctor.checks[] | select(.name == "gateway") | .status')" = fail ] \
        || bad "doctor gateway: $(health_value '.doctor')"
    [ "$(health_value '.idle.state')" = counting ] || bad "idle without the gateway: $(health_value '.idle')"
    assert_secret_absent 'fixture-health-secret-5c1e'

    begin "osa health refuses an unregistered sandbox as a usage error"
    reset_log
    run_osa health mk-nowhere-0000 --json
    assert_rc 1
    assert_err_has "not registered"
    [ ! -s "$OUT" ] || bad "stdout for an unregistered sandbox: $(cat "$OUT")"
    [ ! -s "$LOG" ] || bad "an unregistered sandbox contacted the gateway"
    run_osa health
    assert_rc 1
    assert_err_has "usage: osa health SANDBOX"

    begin "osa health reports only idle stop for an orphan"
    seed_registry_entry mk-ghost-0000 mk "$CASE/project/gone"
    oh_ghost=$(state_root)/sessions/mk-ghost-0000
    idle_line "$oh_ghost" 7200 "armed secs=60 session=$oh_dead watcher=1"
    idle_line "$oh_ghost" 7100 "stopped session=$oh_dead"
    reset_log
    run_osa health mk-ghost-0000 --json
    assert_rc 0
    cp "$OUT" "$CASE/health.json"
    [ "$(health_value '.idle.state')" = stopped ] || bad "orphan idle: $(cat "$OUT")"
    [ "$(health_value '.mcp.error + "|" + .doctor.error')" = "project folder missing|project folder missing" ] \
        || bad "orphan sections: $(cat "$OUT")"
    [ ! -s "$LOG" ] || bad "an orphan's health contacted the gateway"
    run_osa health mk-ghost-0000
    assert_rc 0
    assert_out_has "Idle stop: stopped at "
    assert_out_has "error: project folder missing"
}

# ---------------------------------------------------------------------------
# osa dashboard: an exec wrapper around the repository's Bun dashboard. A
# per-case bun stub, ahead of tests/stub (whose bun stands in for the TUI
# bridge), answers --version from BUN_VERSION and otherwise records its argv,
# DASHBOARD_OSA_BIN, DASHBOARD_PORT, and working directory, then exits 0.

write_dashboard_bun_stub() {
    mkdir -p "$CASE/bun-bin"
    cat >"$CASE/bun-bin/bun" <<'STUB'
#!/bin/sh
if [ "${1:-}" = --version ]; then
    printf '%s\n' "$STUB_BUN_VERSION"
    exit 0
fi
{
    for stub_arg in "$@"; do
        printf 'argv: %s\n' "$stub_arg"
    done
    printf 'DASHBOARD_OSA_BIN=%s\n' "${DASHBOARD_OSA_BIN:-}"
    printf 'DASHBOARD_PORT=%s\n' "${DASHBOARD_PORT:-}"
    printf 'pwd=%s\n' "$(pwd -P)"
} >"$STUB_BUN_LOG"
STUB
    chmod +x "$CASE/bun-bin/bun"
}

# Runs osa dashboard with the bun stub first on PATH (PATH_OVERRIDE replaces
# the whole PATH), BUN_VERSION as its version, DASHBOARD_ENV_OSA_BIN as the
# inherited DASHBOARD_OSA_BIN, and OSA_CMD (default: $OSA) as the command.
run_osa_dashboard() { # ARGS...
    BUN_LOG=$CASE/bun.log
    rm -f "$BUN_LOG"
    RC=0
    (
        cd "${RUN_DIR:-$CASE/project}"
        PATH="${PATH_OVERRIDE:-$CASE/bun-bin:$STUB_DIR:$PATH}" \
        HOME="$HOME" \
        XDG_STATE_HOME="$CASE/xdg-state" \
        STUB_LOG="$STUB_LOG" \
        STUB_STATE_DIR="$STUB_STATE_DIR" \
        STUB_BUN_VERSION="${BUN_VERSION:-1.4.2}" \
        STUB_BUN_LOG="$BUN_LOG" \
        DASHBOARD_OSA_BIN="${DASHBOARD_ENV_OSA_BIN:-}" \
        DASHBOARD_PORT=9123 \
        "${OSA_CMD:-$OSA}" dashboard "$@" >"$OUT" 2>"$ERR" </dev/null
    ) || RC=$?
}

# Checks that the bun stub received exactly `run <repo>/dashboard/src/main.ts`
# followed by ARGS, in order.
assert_bun_argv() { # ARGS...
    {
        printf 'argv: run\n'
        printf 'argv: %s\n' "$ROOT/dashboard/src/main.ts"
        for bun_arg in "$@"; do
            printf 'argv: %s\n' "$bun_arg"
        done
    } >"$CASE/bun-argv.want"
    if [ ! -f "$BUN_LOG" ]; then
        bad "bun did not run: $(cat "$ERR")"
        return
    fi
    grep '^argv: ' "$BUN_LOG" >"$CASE/bun-argv.got" || :
    cmp -s "$CASE/bun-argv.want" "$CASE/bun-argv.got" \
        || bad "bun argv: $(tr '\n' '|' <"$CASE/bun-argv.got")"
}

assert_bun_not_run() { # WHY
    [ ! -f "$BUN_LOG" ] || bad "$1: bun ran: $(tr '\n' '|' <"$BUN_LOG")"
}

assert_bun_log_line() { # LINE
    grep -qxF "$1" "$BUN_LOG" 2>/dev/null || bad "bun log lacks '$1': $(tr '\n' '|' <"$BUN_LOG" 2>/dev/null)"
}

test_osa_dashboard() {
    begin "osa dashboard execs Bun on the repository's dashboard with this osa"
    new_case osa-dashboard
    write_dashboard_bun_stub
    run_osa_dashboard
    assert_rc 0
    assert_bun_argv
    assert_bun_log_line "DASHBOARD_OSA_BIN=$ROOT/bin/osa"
    assert_bun_log_line "DASHBOARD_PORT=9123"
    assert_bun_log_line "pwd=$(CDPATH='' cd -- "$CASE/project" && pwd -P)"

    begin "osa dashboard passes its five flags through unchanged and in order"
    run_osa_dashboard --port 9000 --host 127.0.0.1 --token T --read-only --open
    assert_rc 0
    assert_bun_argv --port 9000 --host 127.0.0.1 --token T --read-only --open
    run_osa_dashboard --open --token=T2 --host=::1 --read-only --port=0
    assert_rc 0
    assert_bun_argv --open --token=T2 --host=::1 --read-only --port=0
    run_osa_dashboard --port abc
    assert_rc 0
    assert_bun_argv --port abc

    begin "osa dashboard rejects other arguments before starting Bun"
    run_osa_dashboard --daemon
    assert_rc 1
    assert_err_has "unknown dashboard option: --daemon"
    assert_bun_not_run "--daemon"
    run_osa_dashboard extra
    assert_rc 1
    assert_bun_not_run "a positional argument"
    run_osa_dashboard --port
    assert_rc 1
    assert_err_has "option --port requires a value"
    assert_bun_not_run "--port without a value"
    run_osa_dashboard --read-only --token
    assert_rc 1
    assert_bun_not_run "--token without a value"
    run_osa_dashboard --help
    assert_rc 0
    assert_out_has "Usage: osa dashboard"
    assert_bun_not_run "--help"

    begin "osa dashboard exits 2 without Bun, naming the minimum and the install link"
    mkdir -p "$CASE/nobin"
    PATH_OVERRIDE="$CASE/nobin:/usr/bin:/bin"
    run_osa_dashboard
    PATH_OVERRIDE=
    assert_rc 2
    assert_err_has "Bun >= 1.2.0"
    assert_err_has "https://bun.sh"
    assert_bun_not_run "no bun"

    begin "osa dashboard refuses Bun below 1.2.0 and runs at 1.2.0"
    BUN_VERSION=1.1.30
    run_osa_dashboard
    assert_rc 2
    assert_err_has "found 1.1.30"
    assert_err_has "Bun >= 1.2.0"
    assert_bun_not_run "Bun 1.1.30"
    BUN_VERSION=1.2.0
    run_osa_dashboard
    assert_rc 0
    assert_bun_argv
    BUN_VERSION=1.2.0-canary.3+abc
    run_osa_dashboard
    assert_rc 0
    assert_bun_argv

    begin "osa dashboard warns on an unreadable Bun version and still runs"
    BUN_VERSION=nightly
    run_osa_dashboard --open
    assert_rc 0
    assert_err_has "warning: cannot read Bun's version ('nightly')"
    assert_bun_argv --open
    BUN_VERSION=

    begin "osa dashboard overrides an inherited DASHBOARD_OSA_BIN"
    DASHBOARD_ENV_OSA_BIN=/elsewhere/bin/osa
    run_osa_dashboard
    DASHBOARD_ENV_OSA_BIN=
    assert_rc 0
    assert_bun_log_line "DASHBOARD_OSA_BIN=$ROOT/bin/osa"

    begin "osa dashboard found on PATH from / starts the same dashboard"
    RUN_DIR=/
    PATH_OVERRIDE="$CASE/bun-bin:$ROOT/bin:$STUB_DIR:$PATH"
    OSA_CMD=osa
    run_osa_dashboard --read-only
    OSA_CMD=
    PATH_OVERRIDE=
    RUN_DIR=
    assert_rc 0
    assert_bun_argv --read-only
    assert_bun_log_line "DASHBOARD_OSA_BIN=$ROOT/bin/osa"
    assert_bun_log_line "pwd=/"
}

test_osa_dashboard_writes_nothing() {
    begin "osa dashboard writes no state and makes no openshell call"
    new_case osa-dashboard-quiet
    write_dashboard_bun_stub
    mkdir -p "$CASE/xdg-state"
    find "$CASE/xdg-state" "$HOME" | sort >"$CASE/before.txt"
    reset_log
    run_osa_dashboard
    assert_rc 0
    run_osa_dashboard --port 0 --open
    assert_rc 0
    run_osa_dashboard --daemon
    assert_rc 1
    find "$CASE/xdg-state" "$HOME" | sort >"$CASE/after.txt"
    cmp -s "$CASE/before.txt" "$CASE/after.txt" \
        || bad "osa dashboard wrote a file: $(diff "$CASE/before.txt" "$CASE/after.txt" | tr '\n' ' ')"
    [ ! -s "$LOG" ] || bad "osa dashboard called openshell: $(tr '\n' ' ' <"$LOG")"
}

run_test test_flat_get_helper
run_test test_shared_state_root
run_test test_old_state_root_ignored
run_test test_state_toml_round_trip
run_test test_project_name_sources
run_test test_default_name_hash
run_test test_registered_name_and_binding
run_test test_registry_entry_lifecycle
run_test test_registry_fingerprint
run_test test_osa_usage
run_test test_osa_projects
run_test test_osa_status_quick
run_test test_osa_status_full
run_test test_osa_read_only
run_test test_osa_providers
run_test test_osa_provider_setup
run_test test_osa_images
run_test test_idle_state
run_test test_osa_quick_idle
run_test test_health_json_maki
run_test test_health_json_front_ends
run_test test_health_json_stopped
run_test test_osa_health
run_test test_osa_dashboard
run_test test_osa_dashboard_writes_nothing
run_test test_resolve_fixtures
run_test test_resolve_dispatch_refusals
run_test test_resolve_wrong_kind
run_test test_resolve_json_output
run_test test_resolve_apply
run_test test_resolve_branch
run_test test_resolve_drop
run_test test_resolve_rescue
run_test test_resolve_discard
run_test test_resolve_session_lock
run_test test_resolve_recovery_text
run_test test_help
run_test test_usage_errors
run_test test_config_precedence
run_test test_config_unknown_key
run_test test_sandbox_name_fit
run_test test_sandbox_name_validation
run_test test_up_creates
run_test test_up_idempotent
run_test test_run_passthrough
run_test test_maki_attach
run_test test_upload_no_mount
run_test test_upload_prunes_tracked_deletion
run_test test_upload_prunes_plain_deletion
run_test test_upload_discards_parked_workspace
run_test test_upload_subpath_keeps_copy_in_semantics
run_test test_upload_explicit_path_copies_only_that_path
run_test test_upload_partial_copy_keeps_workspace_behind
run_test test_upload_partial_copy_refused_when_parked
run_test test_upload_partial_copy_warns_about_retained_patch
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
run_test test_image_build_ignores_configured_image
run_test test_image_build_forwards_term
run_test test_image_json
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
run_test test_provider_setup_stdin
run_test test_provider_setup_profile_id
run_test test_providers_json_front_ends
run_test test_provider_setup_program
run_test test_provider_setup_secret_scan
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
run_test test_caller_consecutive_runs
run_test test_caller_parked_marker_ignored
run_test test_caller_up_no_upload
run_test test_caller_requires_name_and_workdir
run_test test_caller_no_policy_advisor
run_test test_caller_run_wrapper
run_test test_caller_invalid_mode
run_test test_session_sync_failure_preserves_code
run_test test_session_plain_apply
run_test test_session_plain_conflict_keeps_project
run_test test_baseline_capture_clean_git
run_test test_baseline_capture_dirty_git
run_test test_sandbox_baseline_after_upload
run_test test_filtered_baseline_is_not_stale_after_upload
run_test test_existing_sandbox_baseline_migration
run_test test_sandbox_id_recorded
run_test test_host_change_refreshes_before_session
run_test test_parked_workspace_refuses_session
run_test test_sandbox_id_mismatch_archives_state
run_test test_rm_parked_guard_and_recreate
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
run_test test_parked_workspace_blocks_second_session
run_test test_retained_patch_does_not_block_second_session
run_test test_applied_retained_patch_clears_notice
run_test test_stale_retained_notice_is_advisory
run_test test_legacy_retained_marker
run_test test_legacy_parked_marker
run_test test_status_clean_and_behind
run_test test_status_retained
run_test test_status_parked
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
run_test test_fish_install_both_front_ends
run_test test_fish_uninstall_skips_foreign
run_test test_fish_fisher_layout
run_test test_fish_completions
run_test test_example_config
run_test test_asset_agent_onboarding
run_test test_idle_stop_setting
run_test test_idle_stop_after_idle
run_test test_idle_stop_after_sighup
run_test test_idle_stop_newer_session_cancels
run_test test_idle_stop_busy_sandbox
run_test test_idle_stop_failure_is_silent
run_test test_no_placeholder_spelling
run_test test_oc_help
run_test test_oc_run_argv
run_test test_oc_tui_argv
run_test test_oc_session_mapping
run_test test_oc_session_conflicts
run_test test_oc_image_build
run_test test_oc_stores_catalog
run_test test_oc_provider_setup
run_test test_oc_provider_setup_custom
run_test test_oc_mcp_status_missing_in_sandbox
run_test test_oc_mcp_status_present
run_test test_oc_mcp_status_unreadable
run_test test_oc_mcp_no_jq_and_doctor
run_test test_oc_isolation
run_test test_oc_lifecycle_and_guard
run_test test_oc_run_timeout_and_proposals
run_test test_oc_sync_clean_git
run_test test_oc_sync_dirty_host
run_test test_oc_sync_plain_directory
run_test test_oc_sync_no_git
run_test test_cc_help
run_test test_cc_run_argv
run_test test_cc_tui_argv
run_test test_cc_session_flags
run_test test_cc_image_build
run_test test_cc_profiles_and_catalogs
run_test test_cc_provider_setup_store
run_test test_cc_provider_setup_token
run_test test_cc_doctor
run_test test_cc_mcp_status
run_test test_cc_isolation_and_registry
run_test test_cc_lifecycle_and_guard
run_test test_cc_timeout_proposals_idle
run_test test_cc_sync_clean_git
run_test test_cc_sync_dirty_host
run_test test_cc_sync_plain_directory
run_test test_cc_sync_no_git
run_test test_cx_help
run_test test_cx_run_argv
run_test test_cx_tui_argv
run_test test_cx_session_flags
run_test test_cx_image_build
run_test test_cx_profiles_and_catalogs
run_test test_cx_codex_stub
run_test test_cx_provider_setup
run_test test_cx_provider_setup_rerun_and_errors
run_test test_cx_doctor
run_test test_cx_mcp_status
run_test test_cx_isolation_and_registry
run_test test_cx_lifecycle_and_guard
run_test test_cx_timeout_proposals_idle
run_test test_cx_sync_clean_git
run_test test_cx_sync_dirty_host
run_test test_cx_sync_plain_directory
run_test test_cx_sync_no_git

printf '\n%d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -ne 0 ]; then
    exit 1
fi
