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

WORK=$(mktemp -d "${TMPDIR:-/tmp}/maki-oss-tests.XXXXXX")
cleanup() { rm -rf "$WORK"; }
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
    mkdir -p "$CASE/home" "$CASE/project" "$CASE/state"
    XDG_CONFIG_HOME=$CASE/home/.config
    HOME=$CASE/home
    STUB_LOG=$CASE/stub.log
    STUB_STATE_DIR=$CASE/state
    LOG=$STUB_LOG
    OUT=$CASE/out
    ERR=$CASE/err
    RUN_DIR=
    ENV_NAME=
    ENV_TIMEOUT=
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
        MAKI_OSS_RUN_TAG="${ENV_RUN_TAG:-}" \
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
    assert_log_line "/sandbox/project"
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
    begin "reusing a sandbox announces the sync-back overwrite"
    new_case reuse-note
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub

    run_maki run "hi"
    assert_rc 0
    assert_err_has "sync-back"
    assert_err_has "upload"
    assert_log_missing "upload"

    # A session that creates the sandbox uploads instead, so no warning.
    reset_state
    reset_log
    seed_remembered_provider maki-stub
    run_maki run "hi"
    assert_rc 0
    assert_log_has "upload"
    assert_err_missing "sync-back"
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
    begin "maki --continue forwards the resume flag and syncs the workspace"
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
    assert_log_before "exec" "download"
    # The exit sync still downloads the workspace only: session state stays
    # inside the sandbox.
    assert_log_line "/sandbox/project"
    assert_log_missing "/.local/state"

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

    # Sync-back is unchanged by resume flags: workspace only, no state dir.
    assert_log_before "exec" "download"
    assert_log_line "/sandbox/project"
    assert_log_missing "/.local/state"
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
    assert_log_has "download"
    assert_log_before "create" "stub-bun start"
    assert_log_before "stub-bun start" "stub-opencode"
    assert_log_before "stub-opencode" "stub-bun SIGTERM"
    assert_log_before "stub-bun SIGTERM" "download"
    # the bridge runs maki in the same project sandbox, with no --env value
    assert_log_has "stub-bun env: OPENMAKI_SANDBOX=maki-myproject"
    assert_log_has "OPENMAKI_CWD=/sandbox/project"
    assert_log_missing "--env"
    # the TUI is attached on the TTY against the bridge's loopback URL
    assert_log_has "stub-opencode argv: --server"
    assert_log_has "stub-opencode argv: http://127.0.0.1:4698"
    assert_log_missing "--tty"
    assert_err_has "Starting the OpenCode TUI bridge"
    assert_err_has "Attaching the OpenCode TUI"

    # --no-sync keeps the flow but skips the download
    reset_log
    run_maki --no-sync
    assert_rc 0
    assert_log_has "stub-bun SIGTERM"
    assert_log_missing "download"
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
    begin "bare maki-oss creates, uploads, runs, and syncs back in order"
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
    assert_log_has "download"
    assert_log_before "create" "upload"
    assert_log_before "upload" "exec"
    assert_log_before "exec" "download"
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
    assert_log_has "exec"
    assert_log_has "download"
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
    assert_log_has "exec"
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
    assert_log_before "attach" "exec"
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
    assert_log_has "download"
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
    assert_out_missing "Synced sandbox changes"
    assert_err_has "Creating sandbox"
    assert_log_has "create"
    assert_log_has "upload"
    assert_log_has "exec"
    assert_log_has "download"
    assert_log_before "create" "upload"
    assert_log_before "upload" "exec"
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
    assert_err_has "--no-sync"
}

test_session_sync_failure_preserves_code() {
    begin "sync failure warns and keeps Maki's exit code"
    new_case session-sync-fail
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    EXEC_STDOUT='partial-output'
    EXEC_EXIT=7
    DOWNLOAD_EXIT=9

    run_maki run "boom"
    assert_rc 7
    assert_out_has "partial-output"
    assert_err_has "download failed"
}

test_session_sync_merge() {
    begin "sync overwrites matching files and preserves host-only files"
    new_case session-sync-merge
    RUN_DIR=$CASE/project/myproject
    mkdir -p "$RUN_DIR"
    seed_sandbox maki-myproject Ready
    seed_remembered_provider maki-stub
    attach_stub_provider maki-myproject maki-stub
    download_fixture=$CASE/download-fixture
    mkdir -p "$download_fixture"
    printf 'sandbox-version\n' >"$download_fixture/readme.txt"
    printf 'new-file\n' >"$download_fixture/new.txt"
    printf 'host-version\n' >"$RUN_DIR/readme.txt"
    printf 'host-only\n' >"$RUN_DIR/hostonly.txt"
    DOWNLOAD_FIXTURE=$download_fixture

    run_maki maki
    assert_rc 0
    grep -Fq 'sandbox-version' "$RUN_DIR/readme.txt" \
        || bad "matching file was not overwritten by the sync"
    grep -Fq 'new-file' "$RUN_DIR/new.txt" 2>/dev/null \
        || bad "new sandbox file was not downloaded"
    grep -Fq 'host-only' "$RUN_DIR/hostonly.txt" 2>/dev/null \
        || bad "host-only file was removed by the sync"
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
    assert_log_has "exec"
    assert_log_has "download"
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
run_test test_session_sync_merge
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
run_test test_no_placeholder_spelling

printf '\n%d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -ne 0 ]; then
    exit 1
fi
