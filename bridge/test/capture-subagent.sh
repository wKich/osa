#!/bin/sh
# Capture one live Maki subagent turn (change add-live-subagent-capture). Maki
# runs inside a scratch OpenShell sandbox, directly over stdio — not through
# the bridge, so bridge/src stays untouched. The sandbox carries no --env
# value: the maki-synthetic provider profile supplies the credential binding
# and the sandbox only sees the opaque stand-in it substitutes.
#
#   bridge/test/capture-subagent.sh [SANDBOX_NAME] [OUTPUT_PATH]
#
# Gated like the TUI pass: it needs a connected gateway, the image, and bun, so
# it is never part of `make test`. It skips with a message when a dependency is
# absent. The sandbox is deleted on exit.
set -eu

cd "$(dirname "$0")/../.."
NAME=${1:-maki-sub-live}
OUT=${2:-bridge/test/fixtures/maki-subagent-live.jsonl}
IMAGE=maki-agent:local
POLICY=examples/policies/maki-minimal.yaml
MODEL=synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017
HOLD=${CAPTURE_HOLD:-120}
MSG='{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Use the task tool to spawn a subagent. Tell the subagent to run the bash command echo subagent-live-marker using its bash tool, and to report the command output. Then reply with DONE."}]}}'
APPEND='You must use the task tool to delegate this request to a subagent before answering.'

skip() {
    echo "capture-subagent: $*; skipping" >&2
    exit 0
}

command -v openshell >/dev/null 2>&1 || skip "openshell not found"
command -v bun >/dev/null 2>&1 || skip "bun not found"
docker image inspect "$IMAGE" >/dev/null 2>&1 || skip "image $IMAGE not found"
[ -f "$POLICY" ] || skip "policy $POLICY not found"
openshell sandbox list 2>/dev/null | awk '{print $1}' | grep -qx -- "$NAME" \
    && skip "sandbox $NAME already exists; delete it or pass another name"

mkdir -p "$(dirname "$OUT")"
: > "$OUT"
FEED=$(mktemp -d)
CREATED=0
cleanup() {
    [ "$CREATED" -eq 1 ] && openshell sandbox delete "$NAME" >/dev/null 2>&1 || true
    rm -rf "$FEED"
}
trap cleanup EXIT INT TERM

echo "capture-subagent: creating $NAME from $IMAGE" >&2
openshell sandbox create --name "$NAME" --from "$IMAGE" --policy "$POLICY" \
    --provider maki-synthetic --detach >/dev/null
CREATED=1

phase=
i=0
while [ "$phase" != "Ready" ] && [ "$i" -lt 60 ]; do
    phase=$(openshell sandbox list 2>/dev/null | awk -v n="$NAME" '$1 == n {print $NF}')
    [ "$phase" = "Ready" ] && break
    sleep 2
    i=$((i + 1))
done
[ "$phase" = "Ready" ] || { echo "capture-subagent: $NAME not ready (phase '$phase')" >&2; exit 1; }

mkfifo "$FEED/in"
# Hold stdin open until the terminal result line lands (closing it early ends
# the SDK stream), bounded by HOLD seconds.
(
    printf '%s\n' "$MSG"
    i=0
    while [ "$i" -lt "$HOLD" ]; do
        grep -q '"type":"result"' "$OUT" 2>/dev/null && break
        sleep 1
        i=$((i + 1))
    done
) > "$FEED/in" &
FEEDER=$!

echo "capture-subagent: running maki $MODEL" >&2
openshell sandbox exec -n "$NAME" --no-login-shell --workdir /sandbox -- \
    maki -p --trust --input-format stream-json --output-format stream-json \
    --append-system-prompt "$APPEND" -m "$MODEL" < "$FEED/in" | tee "$OUT"
wait "$FEEDER" 2>/dev/null || true

grep -q '"type":"result"' "$OUT" || { echo "capture-subagent: no terminal result frame in $OUT" >&2; exit 1; }
grep -q 'parent_tool_use_id' "$OUT" || { echo "capture-subagent: no parent_tool_use_id frame in $OUT" >&2; exit 1; }
echo "capture-subagent: captured $OUT ($(wc -l < "$OUT" | tr -d ' ') lines)" >&2
