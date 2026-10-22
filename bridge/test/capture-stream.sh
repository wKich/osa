#!/bin/sh
# Capture one live Maki turn's stdout (change add-live-stream-deltas, task 5.1)
# to see whether --include-partial-messages makes `stream_event` frames arrive.
# Maki runs inside a scratch OpenShell sandbox, directly over stdio. The sandbox
# carries no --env value: the already-registered maki-synthetic provider profile
# supplies the credential binding and the sandbox only sees the opaque stand-in
# it substitutes. No new credential and no new egress rule are needed.
#
#   bridge/test/capture-stream.sh [SANDBOX_NAME] [OUTPUT_PATH]
#
# Gated: needs a reachable gateway, the image, and openshell, so it is never
# part of `make test`. It skips with a message when a dependency is absent.
# The sandbox is deleted on exit.
set -eu

cd "$(dirname "$0")/../.."
NAME=${1:-maki-stream-live}
OUT=${2:-openspec/changes/add-live-stream-deltas/evidence/stream-live.jsonl}
IMAGE=maki-agent:local
POLICY=examples/policies/maki-minimal.yaml
MODEL=synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017
HOLD=${CAPTURE_HOLD:-120}
MSG='{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Describe the ocean in one short paragraph, then reply DONE."}]}}'

skip() {
    echo "capture-stream: $*; skipping" >&2
    exit 0
}

command -v openshell >/dev/null 2>&1 || skip "openshell not found"
docker image inspect "$IMAGE" >/dev/null 2>&1 || skip "image $IMAGE not found"
[ -f "$POLICY" ] || skip "policy $POLICY not found"
openshell sandbox list >/dev/null 2>&1 || skip "gateway not reachable"
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

echo "capture-stream: creating $NAME from $IMAGE" >&2
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
[ "$phase" = "Ready" ] || { echo "capture-stream: $NAME not ready (phase '$phase')" >&2; exit 1; }

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

echo "capture-stream: running maki $MODEL" >&2
openshell sandbox exec -n "$NAME" --no-login-shell --workdir /sandbox -- \
    maki -p --trust --input-format stream-json --output-format stream-json \
    --include-partial-messages -m "$MODEL" < "$FEED/in" | tee "$OUT"
wait "$FEEDER" 2>/dev/null || true

grep -q '"type":"result"' "$OUT" || { echo "capture-stream: no terminal result frame in $OUT" >&2; exit 1; }
if grep -q '"type":"stream_event"' "$OUT"; then
    echo "capture-stream: stream_event frames present in $OUT ($(wc -l < "$OUT" | tr -d ' ') lines)" >&2
else
    echo "capture-stream: no stream_event frames in $OUT ($(wc -l < "$OUT" | tr -d ' ') lines)" >&2
fi
