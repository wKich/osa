# Codex coding-agent image for OpenShell sandboxes.
#
# Build from the repository root:
#   docker build -t codex-agent:local codex-oss/image
#
# The image contains no credentials and no Codex login state (no auth.json).
# OpenShell injects the ChatGPT access token placeholder at sandbox runtime;
# never bake secrets into this image.
#
# This is the base image: agent runtime and safety baseline only. Personal
# MCP servers, plugins, and UI preferences belong in an image built FROM this
# one, following the environment-store pattern in examples/environments/.

FROM ubuntu:24.04

# Pinned Codex release and the SHA-256 of each static musl build, read from
# the GitHub release asset digests
# (gh release view rust-v<version> -R openai/codex --json assets).
# codex-code-mode-host is the companion binary that runs the agent's shell
# commands; without it every tool call fails. Bump all five together; see
# "Build the image" in codex-oss/README.md.
ARG CODEX_VERSION=0.164.0
ARG CODEX_SHA256_ARM64=29a507a2a3fd8f6cd94b96b762d281d299d15d7902dee6132d314b78cf9108eb
ARG CODEX_SHA256_AMD64=90dd0b03b28afcb7fa733a4f73b413db2916a47347efd43fb669cc1c774ee8e4
ARG CODEX_HOST_SHA256_ARM64=0e0bdde24d5b31b05519693635baa9c4f2dc4fe7eee31c67b92155f190dd32d2
ARG CODEX_HOST_SHA256_AMD64=feade7026436baa4e82e898050c7ef82a8adbd98163dc504771275b5ef224f2f

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        iproute2 \
        jq \
 && rm -rf /var/lib/apt/lists/*

# Install the native Codex binaries directly. The musl builds are static, so
# the image needs no Node or Bun; the npm package is only a launcher for them.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
        amd64) target=x86_64-unknown-linux-musl; sha="$CODEX_SHA256_AMD64"; host_sha="$CODEX_HOST_SHA256_AMD64" ;; \
        arm64) target=aarch64-unknown-linux-musl; sha="$CODEX_SHA256_ARM64"; host_sha="$CODEX_HOST_SHA256_ARM64" ;; \
        *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    fetch() { \
        curl -fsSL -o "/tmp/$1.tar.gz" \
            "https://github.com/openai/codex/releases/download/rust-v${CODEX_VERSION}/$1-${target}.tar.gz"; \
        echo "$2  /tmp/$1.tar.gz" | sha256sum -c -; \
        tar -xzf "/tmp/$1.tar.gz" -C /tmp "$1-${target}"; \
        install -m 0755 "/tmp/$1-${target}" "/usr/local/bin/$1"; \
        rm -f "/tmp/$1.tar.gz" "/tmp/$1-${target}"; \
    }; \
    fetch codex "$sha"; \
    fetch codex-code-mode-host "$host_sha"; \
    /usr/local/bin/codex --version

# Managed configuration and command rules. Root-owned, outside /sandbox, so
# the sandbox user cannot redirect the provider or lift its own guardrails.
COPY --chown=root:root --chmod=0644 managed_config.toml /etc/codex/managed_config.toml
COPY --chown=root:root --chmod=0644 default.rules /etc/codex/rules/default.rules
RUN chmod 0755 /etc/codex /etc/codex/rules

# Non-root sandbox identity. The sandbox policy pins the same uid/gid, so the
# image user and codex-oss/policies/*.yaml must agree. Codex uses its default
# home, ~/.codex: `openshell sandbox exec` does not pass image ENV through, so
# an image-level CODEX_HOME would not reach the agent. No ~/.agents: Codex
# reads skills from there outside its home.
RUN groupadd --gid 1500 sandbox \
 && useradd --uid 1500 --gid 1500 --create-home --home-dir /sandbox \
        --shell /bin/bash --comment "OpenShell sandbox user" sandbox \
 && mkdir -p /sandbox/.codex /sandbox/project \
 && chown -R sandbox:sandbox /sandbox

ENV HOME=/sandbox
WORKDIR /sandbox
USER sandbox

CMD ["/bin/bash"]
