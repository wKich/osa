#!/bin/sh
# Entrypoint for the osa development image.
#
# Brings up the loopback MongoDB the store suites use, then runs the requested
# command unchanged. The server is development-only: it binds 127.0.0.1, accepts
# no credential, and has no reachable interface outside the sandbox.
#
# OSA_DEV_SKIP_MONGOD=1 runs the command without starting it, for a caller that
# wants the image's toolchain only.
set -eu

if [ "${OSA_DEV_SKIP_MONGOD:-0}" != "1" ]; then
    if ! osa-dev-start-mongodb; then
        printf '%s\n' \
            'osa-dev: the loopback MongoDB did not start (see /sandbox/.local/share/mongodb/mongod.log); set OSA_DEV_SKIP_MONGOD=1 to run without it' >&2
        exit 1
    fi
fi

exec "$@"
