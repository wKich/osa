#!/bin/sh
# TUI-level discovery pass (design decision 6): drive the real `opencode` TUI
# at the bridge for boot → prompt → permission, capture the terminal
# transcript plus the bridge's request/frame logs, then hand them to
# bridge/test/tui-check.ts, which asserts the invariants and compares the
# capture against bridge/defects.json (open defects must still reproduce;
# their reproductions are recorded, not failed).
#
#   bridge/test/tui-discovery.sh      run by `make test-ui` from the repo root
#
# Prompts are typed as fused writes (text + CR) — the spike measured that a
# split CR makes the TUI drop the submit. Fresh XDG state per run: the TUI
# restores recent sessions from local state, and stale ones block the composer.
set -eu

cd "$(dirname "$0")/../.."
ROOT=$PWD
OUT=bridge/test/captures
TRANSCRIPT=$ROOT/$OUT/tui-last.typescript
REQUESTS=$ROOT/$OUT/tui-last-requests.jsonl
FRAMES=$ROOT/$OUT/tui-last-frames.jsonl
BRIDGE_LOG_OUT=$ROOT/$OUT/tui-last-bridge.log
PROBE=/tmp/maki-oss-tui-probe.txt
STATE_HOME=/tmp/maki-oss-tui-state
DATA_HOME=/tmp/maki-oss-tui-data

P1='Reply with the word PONG only.'
P2="Use your shell tool to run exactly: rm -f $PROBE . Then reply with the single word DONE."
BOOT_WAIT=${TUI_BOOT_WAIT:-12}
TURN_WAIT=${TUI_TURN_WAIT:-20}

mkdir -p "$ROOT/$OUT"
rm -f "$TRANSCRIPT" "$REQUESTS" "$FRAMES" "$BRIDGE_LOG_OUT" "$PROBE"
rm -rf "$STATE_HOME" "$DATA_HOME"

MAKI_CHILD_CMD=$ROOT/bridge/test/fake-maki.ts
# sandbox reads go through the scripted openshell, run in OPENMAKI_CWD
OPENSHELL_BIN=$ROOT/bridge/test/fake-openshell.ts
OPENMAKI_SANDBOX=fake-sandbox
OPENMAKI_CWD=$ROOT
BRIDGE_LOG=$REQUESTS
BRIDGE_SSE_LOG=$FRAMES
PORT=0
export MAKI_CHILD_CMD OPENSHELL_BIN OPENMAKI_SANDBOX OPENMAKI_CWD BRIDGE_LOG BRIDGE_SSE_LOG PORT

bun bridge/src/bridge.ts > "$BRIDGE_LOG_OUT" 2>&1 &
BRIDGE_PID=$!
cleanup() {
    if [ -n "${BRIDGE_PORT:-}" ]; then
        # argv0-anchored: only the TUI process itself — the script(1) wrapper
        # carries the same URL in its arguments and must exit on its own
        pkill -f "^([^ ]*/)?opencode --server http://127\.0\.0\.1:${BRIDGE_PORT}\$" 2>/dev/null || true
    fi
    kill "$BRIDGE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# same budget and parse as bin/maki-oss's wait_for_bridge_port
BRIDGE_PORT=
waited=0
while [ -z "$BRIDGE_PORT" ]; do
    BRIDGE_PORT=$(sed -n 's|.*bridge listening on http://127\.0\.0\.1:\([0-9][0-9]*\).*|\1|p' "$BRIDGE_LOG_OUT" 2>/dev/null | head -n 1)
    [ -n "$BRIDGE_PORT" ] && break
    if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
        cat "$BRIDGE_LOG_OUT" >&2 || true
        echo 'tui-discovery: bridge exited before listening' >&2
        exit 1
    fi
    waited=$((waited + 1))
    if [ "$waited" -gt 15 ]; then
        echo 'tui-discovery: bridge reported no listen address within 15s' >&2
        exit 1
    fi
    sleep 1
done
TUI_PATTERN="^([^ ]*/)?opencode --server http://127\.0\.0\.1:${BRIDGE_PORT}\$"
echo "tui-discovery: bridge on port $BRIDGE_PORT"

printf 'probe\n' > "$PROBE"

# drive the TUI: boot, one plain turn, one permission-gated turn, accept the
# dialog; then tear the TUI down and let `script` flush the transcript
(
    (
        sleep "$BOOT_WAIT"; printf '%s\r' "$P1"
        sleep "$TURN_WAIT"
        printf '%s\r' "$P2"
        sleep "$TURN_WAIT"
        printf '\r' # accept the permission dialog (allow once)
        sleep 15
    ) |
    case "$(uname -s)" in
        Darwin)
            # shortcut: BSD script(1) flags; the Linux form below is the
            # util-linux spelling and is untested on this host
            script -qF "$TRANSCRIPT" env XDG_STATE_HOME="$STATE_HOME" XDG_DATA_HOME="$DATA_HOME" \
                opencode --server "http://127.0.0.1:$BRIDGE_PORT" >/dev/null 2>&1
            ;;
        *)
            script -qec "env XDG_STATE_HOME=$STATE_HOME XDG_DATA_HOME=$DATA_HOME opencode --server http://127.0.0.1:$BRIDGE_PORT" \
                "$TRANSCRIPT" >/dev/null 2>&1
            ;;
    esac
) &
TUI_JOB=$!

sleep $((BOOT_WAIT + TURN_WAIT * 2 + 15 + 5))
pkill -f "$TUI_PATTERN" 2>/dev/null || true
sleep 2 # let script(1) flush the transcript after the TUI exits
wait "$TUI_JOB" 2>/dev/null || true
kill "$BRIDGE_PID" 2>/dev/null || true
wait "$BRIDGE_PID" 2>/dev/null || true
trap - EXIT INT TERM

exec bun bridge/test/tui-check.ts "$TRANSCRIPT" "$REQUESTS" "$FRAMES" "$PROBE"
