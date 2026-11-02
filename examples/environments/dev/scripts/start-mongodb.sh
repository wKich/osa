#!/bin/sh
# Start the loopback MongoDB server shipped in the osa development image.
#
# Idempotent: an already answering server is left alone. The data directory and
# the log both live under /sandbox, owned by uid/gid 1500, so the server needs
# no root and no path outside the sandbox filesystem policy.
set -eu

data_root=${OSA_DEV_MONGO_ROOT:-/sandbox/.local/share/mongodb}
data_dir=$data_root/data
log=$data_root/mongod.log
port=${OSA_DEV_MONGO_PORT:-27017}

ping() {
    mongosh --quiet --port "$port" --eval 'db.runCommand({ping:1}).ok' \
        >/dev/null 2>&1
}

if ping; then
    exit 0
fi

mkdir -p "$data_dir"

mongod --dbpath "$data_dir" \
    --bind_ip 127.0.0.1 \
    --port "$port" \
    --wiredTigerCacheSizeGB 0.5 \
    --logpath "$log" \
    --fork >/dev/null

tries=0
while [ "$tries" -lt 60 ]; do
    if ping; then
        exit 0
    fi
    tries=$((tries + 1))
    sleep 1
done

printf 'start-mongodb: mongod did not answer on 127.0.0.1:%s; see %s\n' \
    "$port" "$log" >&2
exit 1
