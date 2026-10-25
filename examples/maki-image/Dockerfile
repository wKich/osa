# Maki coding-agent image for OpenShell sandboxes.
#
# Build from the repository root:
#   docker build --build-arg MAKI_VERSION=0.6.4 -t maki-agent:local examples/maki-image
#
# The image contains no credentials. OpenShell injects provider placeholders at
# sandbox runtime; never bake secrets into this image.
#
# This is the base image: agent runtime and safety baseline only. Personal
# MCP servers, runtimes they need, and UI preferences belong in an environment
# image built FROM this one (see examples/environments/reference/).

FROM ubuntu:24.04

# Pinned Maki release. Keep in sync with the "verified against" header in
# docs/setup-guide.md and docs/ai/references.md.
ARG MAKI_VERSION=0.6.4

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        iproute2 \
 && rm -rf /var/lib/apt/lists/*

# Install the pinned static musl build to /usr/local/bin/maki. The release
# archive contains the single static `maki` binary, so it runs on any Linux
# image without matching the image's glibc.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
        amd64) maki_arch=x86_64 ;; \
        arm64) maki_arch=aarch64 ;; \
        *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/maki.tar.gz \
        "https://github.com/tontinton/maki/releases/download/v${MAKI_VERSION}/maki-v${MAKI_VERSION}-${maki_arch}-unknown-linux-musl.tar.gz"; \
    tar -xzf /tmp/maki.tar.gz -C /usr/local/bin maki; \
    rm -f /tmp/maki.tar.gz; \
    chmod 0755 /usr/local/bin/maki; \
    /usr/local/bin/maki --version

# Non-root sandbox identity. The sandbox policy pins the same uid/gid, so the
# image user and examples/policies/*.yaml must agree.
RUN groupadd --gid 1500 sandbox \
 && useradd --uid 1500 --gid 1500 --create-home --home-dir /sandbox \
        --shell /bin/bash --comment "OpenShell sandbox user" sandbox \
 && mkdir -p /sandbox/.config/maki \
 && chown -R sandbox:sandbox /sandbox

# Baked global Maki configuration: pre-answered folder trust and the deny
# rules that protect it. mcp.toml is comments-only: the base declares no MCP
# servers, and an environment image supplies them.
COPY --chown=sandbox:sandbox config/init.lua /sandbox/.config/maki/init.lua
COPY --chown=sandbox:sandbox config/permissions.toml /sandbox/.config/maki/permissions.toml
COPY --chown=sandbox:sandbox config/mcp.toml /sandbox/.config/maki/mcp.toml

ENV HOME=/sandbox
WORKDIR /sandbox
USER sandbox

# Seed Maki's models.dev catalog so `maki models` and the OpenCode TUI can
# list every provider with deny-by-default egress. The build takes a snapshot;
# a sandbox can refresh it later only when a policy allows models.dev.
RUN maki models --refresh >/dev/null

CMD ["/bin/bash"]
