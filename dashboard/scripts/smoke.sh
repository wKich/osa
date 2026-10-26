#!/bin/sh
# End-to-end smoke test for the dashboard.
#
# Starts the real server with the stub `openshell` first on PATH, then curls
# the API and page routes and asserts their payloads. Covers every documented
# flag (--port, --host, --token, --read-only and their DASHBOARD_* environment
# equivalents). No gateway, no Docker, no network beyond loopback.
#
#   dashboard/scripts/smoke.sh
#
# Set SMOKE_PORT to move the main server off its default port.

set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)
STUB_DIR=$ROOT/test/stub
MAIN_PORT=${SMOKE_PORT:-8797}
READONLY_PORT=$((MAIN_PORT + 1))
TOKEN_PORT=$((MAIN_PORT + 2))
HOST_PORT=$((MAIN_PORT + 3))

WORK=$(mktemp -d "${TMPDIR:-/tmp}/dashboard-smoke.XXXXXX")
cleanup() {
    stop_all
    rm -rf "$WORK"
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

STATE=$WORK/state
CONFIG_HOME=$WORK/config
LOG=$WORK/argv.log
mkdir -p "$STATE/sandboxes" "$STATE/providers" "$STATE/notes" "$CONFIG_HOME/maki-oss"
printf 'Ready\n' > "$STATE/sandboxes/demo"
printf 'maki-anthropic\n' > "$STATE/providers/demo"
cat > "$CONFIG_HOME/maki-oss/config.toml" <<'EOF'
# Deterministic create defaults for the smoke run.
image = "smoke-image:local"
policy = "examples/policies/maki-minimal.yaml"
providers = "smoke-provider"
cpu = "1"
memory = "1Gi"
EOF

PIDS=
PASS=0
FAIL=0

stop_all() {
    for pid in $PIDS; do
        kill "$pid" 2>/dev/null || true
    done
    PIDS=
}

ok() { PASS=$((PASS + 1)); printf 'ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf 'FAIL %s\n' "$1"; }

start_server() {
    # start_server <logfile> <extra args...>
    log=$1
    shift
    (
        cd "$ROOT"
        PATH="$STUB_DIR:$PATH" \
        XDG_CONFIG_HOME="$CONFIG_HOME" \
        STUB_STATE_DIR="$STATE" \
        STUB_LOG="$LOG" \
        STUB_LOG_LINES=8 \
        STUB_LOG_INTERVAL=0.01 \
        STUB_LOG_KEEPALIVE=0 \
        exec bun run src/main.ts "$@"
    ) >"$log" 2>&1 &
    PIDS="$PIDS $!"
}

wait_http() {
    i=0
    while [ $i -lt 200 ]; do
        if curl -sf "$1" >/dev/null 2>&1; then return 0; fi
        i=$((i + 1))
        sleep 0.05
    done
    return 1
}

assert_contains() {
    # assert_contains <label> <file> <needle>
    if grep -Fq -- "$3" "$2" 2>/dev/null; then
        ok "$1"
    else
        bad "$1 (missing: $3)"
    fi
}

assert_status() {
    # assert_status <label> <expected> <url> [curl args...]
    label=$1
    expected=$2
    url=$3
    shift 3
    actual=$(curl -s -o /dev/null -w '%{http_code}' "$@" "$url")
    if [ "$actual" = "$expected" ]; then
        ok "$label"
    else
        bad "$label (expected HTTP $expected, got $actual)"
    fi
}

BASE=http://127.0.0.1:$MAIN_PORT
READONLY=http://127.0.0.1:$READONLY_PORT
TOKENBASE=http://127.0.0.1:$TOKEN_PORT
HOSTBASE=http://127.0.0.1:$HOST_PORT

# Fail fast if a stale server (for example from a crashed run) already owns one
# of the ports; otherwise the checks below would talk to the wrong process.
if command -v lsof >/dev/null 2>&1; then
    for port in "$MAIN_PORT" "$READONLY_PORT" "$TOKEN_PORT" "$HOST_PORT"; do
        if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
            printf 'error: port %s is already in use; free it or set SMOKE_PORT\n' "$port" >&2
            exit 1
        fi
    done
fi

# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------

if (cd "$ROOT" && bun run src/main.ts --help) >"$WORK/help.txt" 2>&1 \
    && grep -q -- "--port" "$WORK/help.txt" \
    && grep -q -- "--host" "$WORK/help.txt" \
    && grep -q -- "--token" "$WORK/help.txt" \
    && grep -q -- "--read-only" "$WORK/help.txt"; then
    ok "--help documents every flag"
else
    bad "--help output incomplete"
fi

if (cd "$ROOT" && bun run src/main.ts --bogus) >/dev/null 2>&1; then
    bad "unknown option accepted"
else
    ok "unknown option exits non-zero"
fi

if (cd "$ROOT" && PATH="$STUB_DIR:$PATH" bun run src/main.ts --host 0.0.0.0 --port "$HOST_PORT") \
    >"$WORK/host-fail.log" 2>&1; then
    bad "non-loopback bind without token started"
elif grep -q "requires an explicit --token" "$WORK/host-fail.log"; then
    ok "--host non-loopback without --token fails with explanation"
else
    bad "non-loopback failure message missing"
fi

# ---------------------------------------------------------------------------
# Main server: page, doctor, inventory, detail, policy, rules
# ---------------------------------------------------------------------------

start_server "$WORK/main.log" --port "$MAIN_PORT"
if wait_http "$BASE/"; then ok "server starts with --port and the stub on PATH"; else bad "server did not start"; fi

curl -s "$BASE/" >"$WORK/page.html"
curl -s -D "$WORK/page.headers" "$BASE/" >/dev/null
assert_contains "page embeds the session bootstrap" "$WORK/page.html" '"token":"'
assert_contains "page loads the client module" "$WORK/page.html" 'src="/app/main.js"'
assert_contains "page carries a CSP" "$WORK/page.headers" "script-src 'self'"

for module in main.js dom.js projects.js patch.js; do
    curl -s "$BASE/app/$module" >>"$WORK/app.js"
done
assert_contains "client modules served" "$WORK/app.js" "document.createElement"
if grep -q "innerHTML" "$WORK/app.js"; then
    bad "client modules contain an HTML sink"
else
    ok "client modules have no HTML sinks"
fi
if [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/app.js")" = 404 ]; then
    ok "the old /app.js path is gone"
else
    bad "/app.js is still served"
fi

TOKEN=$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' "$WORK/page.html" | head -n 1)
if [ -n "$TOKEN" ]; then ok "session token parsed from the page"; else bad "no session token in page"; fi

curl -s "$BASE/api/doctor" >"$WORK/doctor.json"
assert_contains "doctor reports the CLI" "$WORK/doctor.json" '"cli":{"ok":true'
assert_contains "doctor reports the gateway" "$WORK/doctor.json" '"gateway":{"ok":true'

curl -s "$BASE/api/sandboxes" >"$WORK/list.json"
assert_contains "inventory lists the seeded sandbox" "$WORK/list.json" '"name":"demo"'
assert_contains "inventory carries the phase" "$WORK/list.json" '"phase":"Ready"'

curl -s "$BASE/api/sandboxes/demo" >"$WORK/detail.json"
assert_contains "detail carries the sandbox" "$WORK/detail.json" '"sandbox":{"id":"id-demo"'
assert_contains "detail carries providers" "$WORK/detail.json" '"name":"maki-anthropic"'
assert_contains "detail carries policy revisions" "$WORK/detail.json" '"status":"loaded"'

curl -s "$BASE/api/sandboxes/demo/policy?view=full" >"$WORK/policy-full.json"
curl -s "$BASE/api/sandboxes/demo/policy?view=base" >"$WORK/policy-base.json"
assert_contains "effective policy includes provider rules" "$WORK/policy-full.json" 'provider:stub'
if grep -Fq "provider:stub" "$WORK/policy-base.json"; then
    bad "base policy leaked provider rules"
else
    ok "base policy excludes provider rules"
fi

curl -s "$BASE/api/sandboxes/demo/rules?status=pending" >"$WORK/rules.json"
assert_contains "rules list parses pending proposals" "$WORK/rules.json" '"chunkId":"chunk-pending-1"'

curl -sN --max-time 5 "$BASE/events/logs?name=demo&token=$TOKEN" >"$WORK/sse.txt" || true
assert_contains "SSE stream sends ready event" "$WORK/sse.txt" "event: ready"
assert_contains "SSE stream carries log lines" "$WORK/sse.txt" "stub] gateway log line 1"

assert_status "stream without token is 403" 403 "$BASE/events/logs?name=demo"

# ---------------------------------------------------------------------------
# Mutations: token guard, lifecycle, create, rules
# ---------------------------------------------------------------------------

assert_status "mutation without token is 403" 403 "$BASE/api/sandboxes/demo/stop" -X POST
assert_status "mutation with wrong token is 403" 403 "$BASE/api/sandboxes/demo/stop" -X POST -H "x-dashboard-token: wrong"

curl -s -X POST -H "x-dashboard-token: $TOKEN" "$BASE/api/sandboxes/demo/stop" >"$WORK/stop.json"
assert_contains "stop reports success" "$WORK/stop.json" '"message":"stub: stopped demo'
if [ "$(cat "$STATE/sandboxes/demo")" = "Stopped" ]; then
    ok "stop changed the stub sandbox state"
else
    bad "stop did not change the stub sandbox state"
fi

curl -s -X POST -H "x-dashboard-token: $TOKEN" "$BASE/api/sandboxes/demo/start" >/dev/null
if [ "$(cat "$STATE/sandboxes/demo")" = "Ready" ]; then
    ok "start changed the stub sandbox state"
else
    bad "start did not change the stub sandbox state"
fi

curl -s -X POST -H "x-dashboard-token: $TOKEN" -H "content-type: application/json" \
    -d '{"name":"scratch"}' "$BASE/api/sandboxes" >"$WORK/create.json"
assert_contains "create reports success" "$WORK/create.json" '"message":"created scratch"'
assert_contains "create used the configured image" "$WORK/argv.log" "smoke-image:local"
assert_contains "create used the configured provider" "$WORK/argv.log" "smoke-provider"
if [ -f "$STATE/sandboxes/scratch" ]; then
    ok "create made the sandbox visible to the stub"
else
    bad "create did not create stub state"
fi

curl -s -X POST -H "x-dashboard-token: $TOKEN" "$BASE/api/sandboxes/scratch/delete" >/dev/null
if [ ! -f "$STATE/sandboxes/scratch" ]; then
    ok "delete removed the stub sandbox"
else
    bad "delete left the stub sandbox in place"
fi

curl -s -X POST -H "x-dashboard-token: $TOKEN" "$BASE/api/sandboxes/demo/rules/chunk-pending-1/approve" >"$WORK/approve.json"
assert_contains "approve reports success" "$WORK/approve.json" '"message":"OK Chunk approved'
assert_contains "approve passed the chunk id" "$WORK/argv.log" "chunk-pending-1"

BEFORE=$(wc -c <"$WORK/argv.log")
assert_status "reject with empty reason is 400" 400 "$BASE/api/sandboxes/demo/rules/chunk-pending-1/reject" \
    -X POST -H "x-dashboard-token: $TOKEN" -H "content-type: application/json" -d '{"reason":"   "}'
AFTER=$(wc -c <"$WORK/argv.log")
if [ "$BEFORE" = "$AFTER" ]; then
    ok "empty-reason reject never invoked the CLI"
else
    bad "empty-reason reject invoked the CLI"
fi

curl -s -X POST -H "x-dashboard-token: $TOKEN" -H "content-type: application/json" \
    -d '{"reason":"scope it narrower"}' "$BASE/api/sandboxes/demo/rules/chunk-pending-1/reject" >/dev/null
assert_contains "reject passed the reason" "$WORK/argv.log" "scope it narrower"

# ---------------------------------------------------------------------------
# Read-only mode (flag and environment)
# ---------------------------------------------------------------------------

stop_all
start_server "$WORK/readonly.log" --read-only --port "$READONLY_PORT"
if wait_http "$READONLY/"; then ok "read-only server starts with --read-only"; else bad "read-only server did not start"; fi
curl -s "$READONLY/" >"$WORK/readonly-page.html"
assert_contains "read-only page marks the mode" "$WORK/readonly-page.html" '"readOnly":true'
assert_status "read-only rejects mutations with 403" 403 "$READONLY/api/sandboxes/demo/start" \
    -X POST -H "x-dashboard-token: anything"

stop_all
(
    cd "$ROOT"
    PATH="$STUB_DIR:$PATH" XDG_CONFIG_HOME="$CONFIG_HOME" STUB_STATE_DIR="$STATE" STUB_LOG="$LOG" \
    DASHBOARD_PORT="$READONLY_PORT" DASHBOARD_READ_ONLY=1 \
    exec bun run src/main.ts
) >"$WORK/env-readonly.log" 2>&1 &
PIDS="$PIDS $!"
if wait_http "$READONLY/"; then
    assert_status "DASHBOARD_READ_ONLY also rejects" 403 "$READONLY/api/sandboxes/demo/start" -X POST
else
    bad "DASHBOARD_PORT/READ_ONLY server did not start"
fi

# ---------------------------------------------------------------------------
# Explicit --token and non-loopback --host
# ---------------------------------------------------------------------------

stop_all
start_server "$WORK/token.log" --port "$TOKEN_PORT" --token smoke-token
if wait_http "$TOKENBASE/"; then ok "server starts with an explicit --token"; else bad "--token server did not start"; fi
curl -s "$TOKENBASE/" >"$WORK/token-page.html"
assert_contains "explicit token embedded in the page" "$WORK/token-page.html" '"token":"smoke-token"'
assert_status "explicit token authorizes mutations" 200 "$TOKENBASE/api/sandboxes/demo/start" \
    -X POST -H "x-dashboard-token: smoke-token"

stop_all
start_server "$WORK/host.log" --host 0.0.0.0 --port "$HOST_PORT" --token smoke-token
if wait_http "$HOSTBASE/" && grep -q "warning: dashboard bound to 0.0.0.0" "$WORK/host.log"; then
    ok "--host 0.0.0.0 --token starts with a warning"
else
    bad "non-loopback start/warning failed"
fi

stop_all

printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
