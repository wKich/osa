# Development environment store for osa.
#
# Build the selected agent base first, then this store:
#   maki-oss image build                       # maki-agent:local
#   docker build -t osa-dev:local examples/environments/dev
#
# This is an environment layer, not a base image: the base stays agent-only,
# and no front-end selects this tag by default. It carries no credential, no
# provider profile, and no egress rule.

ARG OSA_DEV_BASE=maki-agent:local
FROM ${OSA_DEV_BASE}

ARG DEBIAN_FRONTEND=noninteractive

# Pinned at build. Bumping any of these is an image rebuild, never a download
# in a session. RUST_CHANNEL must match the `channel` in rust-toolchain.toml;
# the verification target names a mismatch.
ARG RUST_CHANNEL=1.98.1
ARG BUN_VERSION=1.4.4
ARG OPENSPEC_VERSION=1.13.1
ARG MONGODB_VERSION=8.0.4
ARG MONGOSH_VERSION=2.5.2

# The pre-fetched dependency set comes from this workspace ref. The ref must be
# one the repository remote publishes, and it must carry the Cargo.lock and bun
# lockfiles the sandbox will build against. Bump OSA_REF when a lockfile
# changes; see the rebuild rule in README.md.
ARG OSA_REPO=https://github.com/wKich/osa.git
ARG OSA_REF=main

# Agent binary the verification target reports. Keep it the base's agent:
# maki for maki-agent:local, opencode for opencode-agent:local, and so on.
ARG OSA_DEV_AGENT=maki

# Suite prerequisites the base deliberately lacks, plus the C toolchain a Rust
# build needs. `timeout` is part of coreutils and is already present; the check
# lives in scripts/verify-dev-environment.sh either way.
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        fish \
        git \
        jq \
        libssl-dev \
        patch \
        pkg-config \
        procps \
        unzip \
        xz-utils \
 && rm -rf /var/lib/apt/lists/*

# MongoDB server, installed from the vendor tarball so the image needs no apt
# repository or GPG key at build. It lives under /usr/local, not /opt: the
# sandbox filesystem policy allows reads under /usr and nothing else outside
# /sandbox, so a binary elsewhere could not start. The data directory lives
# under /sandbox and is created below as uid 1500.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
        amd64) mongo_arch=x86_64 ;; \
        arm64) mongo_arch=aarch64 ;; \
        *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/mongodb.tgz \
        "https://fastdl.mongodb.org/linux/mongodb-linux-${mongo_arch}-ubuntu2404-${MONGODB_VERSION}.tgz"; \
    mkdir -p /usr/local/mongodb; \
    tar -xzf /tmp/mongodb.tgz -C /usr/local/mongodb --strip-components=1; \
    rm -f /tmp/mongodb.tgz; \
    install -m 0755 /usr/local/mongodb/bin/mongod /usr/local/bin/mongod; \
    mongod --version | head -n 1

# mongosh beside the server, so the verification target can ping it offline.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
        amd64) mongosh_arch=x64 ;; \
        arm64) mongosh_arch=arm64 ;; \
        *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/mongosh.tgz \
        "https://downloads.mongodb.com/compass/mongosh-${MONGOSH_VERSION}-linux-${mongosh_arch}.tgz"; \
    mkdir -p /usr/local/mongosh; \
    tar -xzf /tmp/mongosh.tgz -C /usr/local/mongosh --strip-components=1; \
    rm -f /tmp/mongosh.tgz; \
    printf '%s\n' '#!/bin/sh' 'exec /usr/local/mongosh/bin/mongosh "$@"' \
        > /usr/local/bin/mongosh; \
    chmod 0755 /usr/local/bin/mongosh; \
    mongosh --version

# Pinned Bun. Installed to /usr/local/bin: the runtime the suites' `command -v`
# resolves is the same file Maki spawns and the dashboard starts.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
        amd64) bun_arch=x64 ;; \
        arm64) bun_arch=aarch64 ;; \
        *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/bun.zip \
        "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${bun_arch}.zip"; \
    unzip -q /tmp/bun.zip -d /tmp/bun; \
    install -m 0755 "/tmp/bun/bun-linux-${bun_arch}/bun" /usr/local/bin/bun; \
    rm -rf /tmp/bun.zip /tmp/bun; \
    bun --version

# Start command: bring up the loopback MongoDB, then run what was asked for.
COPY --chown=root:root scripts/entrypoint.sh /usr/local/bin/osa-dev-entrypoint
COPY --chown=root:root scripts/start-mongodb.sh /usr/local/bin/osa-dev-start-mongodb
RUN chmod 0755 /usr/local/bin/osa-dev-entrypoint /usr/local/bin/osa-dev-start-mongodb

# The pins the verification target compares against. Root-owned and read-only
# to the sandbox user, like every other system path.
RUN install -d -m 0755 /etc/osa-dev \
 && printf 'RUST_CHANNEL=%s\nBUN_VERSION=%s\nOPENSPEC_VERSION=%s\nMONGODB_VERSION=%s\nMONGOSH_VERSION=%s\nOSA_DEV_AGENT=%s\n' \
        "$RUST_CHANNEL" "$BUN_VERSION" "$OPENSPEC_VERSION" "$MONGODB_VERSION" "$MONGOSH_VERSION" "$OSA_DEV_AGENT" \
        > /etc/osa-dev/pins.env

# Everything below runs as the sandbox identity, so the toolchain, the caches,
# and the database all land under /sandbox owned by uid/gid 1500.
USER sandbox
ENV HOME=/sandbox \
    RUSTUP_HOME=/sandbox/.rustup \
    CARGO_HOME=/sandbox/.cargo \
    BUN_INSTALL=/sandbox/.bun
ENV PATH=/sandbox/.cargo/bin:/sandbox/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /sandbox

# The Rust channel from rust-toolchain.toml, with the two components the
# repository's lint target uses.
RUN set -eux; \
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/rustup-init.sh; \
    sh /tmp/rustup-init.sh -y --no-modify-path --profile minimal --default-toolchain none; \
    rm -f /tmp/rustup-init.sh; \
    rustup toolchain install "$RUST_CHANNEL" --profile minimal --component clippy --component rustfmt; \
    rustup default "$RUST_CHANNEL"; \
    cargo --version; \
    cargo clippy --version; \
    cargo fmt --version

# Pinned OpenSpec CLI. Bun's global prefix is /sandbox/.bun, so the package and
# the binary both live under /sandbox and no session needs a package fetch.
# The published bin carries a `node` shebang and the base has no Node, so the
# launcher runs the same entry point under the pinned Bun.
RUN set -eux; \
    bun add -g "@fission-ai/openspec@${OPENSPEC_VERSION}"; \
    openspec_js=/sandbox/.bun/install/global/node_modules/@fission-ai/openspec/bin/openspec.js; \
    test -f "$openspec_js"; \
    rm -f /sandbox/.bun/bin/openspec; \
    printf '%s\n' '#!/bin/sh' "exec /usr/local/bin/bun $openspec_js \"\$@\"" \
        > /sandbox/.bun/bin/openspec; \
    chmod 0755 /sandbox/.bun/bin/openspec; \
    openspec --version

# Pre-fetch the dependency set from the workspace ref: the crates registry and
# the git dependency pinned in osa-core/Cargo.lock, plus Bun's install cache for
# the bridge and oskhs lockfiles. The checkout itself is discarded; only the
# caches under /sandbox remain, so the uploaded project builds and installs
# with egress denied.
RUN set -eux; \
    git init -q /tmp/osa-workspace; \
    cd /tmp/osa-workspace; \
    git remote add origin "$OSA_REPO"; \
    git fetch -q --depth 1 origin "$OSA_REF"; \
    git checkout -q FETCH_HEAD; \
    cargo fetch --locked --manifest-path osa-core/Cargo.toml; \
    (cd bridge && bun install --frozen-lockfile); \
    (cd oskhs && bun install --frozen-lockfile); \
    cd /sandbox; \
    rm -rf /tmp/osa-workspace; \
    test -n "$(ls -A /sandbox/.cargo/registry/cache)"; \
    test -n "$(ls -A /sandbox/.cargo/git/checkouts)"

# Named data directory for the loopback server; the store tests use a
# throwaway database per run.
RUN install -d -m 0700 /sandbox/.local/share/mongodb/data

# A loopback URI the full gate accepts without host setup. The server is
# started by the entrypoint or by osa-dev-start-mongodb; the URI alone never
# makes a run green.
ENV OSKHS_TEST_MONGO_URI=mongodb://127.0.0.1:27017

ENTRYPOINT ["/usr/local/bin/osa-dev-entrypoint"]
CMD ["/bin/bash"]
