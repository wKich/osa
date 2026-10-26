# Claude Code coding-agent image for OpenShell sandboxes.
#
# Build from the repository root:
#   docker build -t claude-agent:local claude-oss/image
#
# The image contains no credentials and no Claude Code login state. OpenShell
# injects provider placeholders at sandbox runtime; never bake secrets into
# this image.
#
# This is the base image: agent runtime and safety baseline only. Personal
# MCP servers, plugins, and UI preferences belong in an image built FROM this
# one, following the environment-store pattern in examples/environments/.

FROM ubuntu:24.04

# Pinned Claude Code release and the SHA-256 of each native Linux build, read
# from the signed release manifest
# (https://downloads.claude.ai/claude-code-releases/<version>/manifest.json,
# platforms.linux-<arch>.checksum). Bump all three together; see "Build the
# image" in claude-oss/README.md.
ARG CLAUDE_VERSION=2.1.308
ARG CLAUDE_SHA256_ARM64=fdd22e6cbb734d580f5664c48df4294eeec850218ff07f186f9af30426396ee1
ARG CLAUDE_SHA256_AMD64=356733f185fa988e6bf3aa9a555269fdd167982a2e2a80d3c8a78037bb92ad58

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        iproute2 \
        jq \
 && rm -rf /var/lib/apt/lists/*

# Install the native Claude Code binary directly. It is self-contained, so the
# image needs no Node or Bun. install.sh is not used: it always downloads the
# latest build first and installs under ~/.local, a path no profile binds.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
        amd64) platform=linux-x64; sha="$CLAUDE_SHA256_AMD64" ;; \
        arm64) platform=linux-arm64; sha="$CLAUDE_SHA256_ARM64" ;; \
        *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/claude \
        "https://downloads.claude.ai/claude-code-releases/${CLAUDE_VERSION}/${platform}/claude"; \
    echo "${sha}  /tmp/claude" | sha256sum -c -; \
    install -m 0755 /tmp/claude /usr/local/bin/claude; \
    rm -f /tmp/claude; \
    /usr/local/bin/claude --version

# Managed settings: deny rules that hold in every permission mode and the
# switches that stop nonessential traffic. Root-owned, so the sandbox user
# cannot change its own guardrails.
COPY --chown=root:root --chmod=0644 managed-settings.json /etc/claude-code/managed-settings.json
RUN chmod 0755 /etc/claude-code

# Interactive launcher step: approves the attached API key placeholder before
# the TUI starts. Root-owned like the managed settings.
COPY --chown=root:root --chmod=0755 approve-api-key /usr/local/libexec/claude-oss/approve-api-key

# Non-root sandbox identity. The sandbox policy pins the same uid/gid, so the
# image user and claude-oss/policies/*.yaml must agree.
RUN groupadd --gid 1500 sandbox \
 && useradd --uid 1500 --gid 1500 --create-home --home-dir /sandbox \
        --shell /bin/bash --comment "OpenShell sandbox user" sandbox \
 && mkdir -p /sandbox/.claude /sandbox/project \
 && chown -R sandbox:sandbox /sandbox

# First-run seed: onboarding done and /sandbox/project trusted, so the TUI
# opens on the prompt. No credential value; Claude Code updates it in place.
# Claude Code's default locations are used (~/.claude/ and ~/.claude.json):
# `openshell sandbox exec` does not pass image ENV through, so an image-level
# CLAUDE_CONFIG_DIR would not reach the agent.
COPY --chown=sandbox:sandbox --chmod=0600 claude.json /sandbox/.claude.json

ENV HOME=/sandbox
WORKDIR /sandbox
USER sandbox

CMD ["/bin/bash"]
