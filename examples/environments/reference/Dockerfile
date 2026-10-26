# Reference environment image for maki-oss.
#
# Build the base first (`maki-oss image build`), then this store:
#   docker build -t maki-agent:reference examples/environments/reference
#
# This store demonstrates the environment layer: the MCP servers, the Bun
# runtime they need, and the compact-UI preferences that the base does not
# contain. Copy this directory outside the repository to make it your own;
# never edit examples/maki-image/ for a personal choice.
#
# The image contains no credentials. Every MCP header or environment value is
# a ${VAR} name that an attached OpenShell provider profile resolves; never
# bake a secret into this context.

FROM maki-agent:local

# Pinned bun runtime for the stdio MCP server declared in config/mcp.toml.
# Bumping it is an image rebuild; no helper code keys on the version.
ARG BUN_VERSION=1.4.3

ARG DEBIAN_FRONTEND=noninteractive

# The base image omits unzip: it was installed only for Bun, which lives here.
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip \
 && rm -rf /var/lib/apt/lists/*

# Pinned bun binary. Bun's Linux releases are zip archives, not tarballs
# (unlike maki's), so unpack with unzip and keep only the binary. Installed to
# /usr/local/bin: the runtime the readiness gate's `command -v` and Maki's
# spawned child resolve is the same file.
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

# Environment configuration layered over the base. init.lua adds the personal
# preferences; mcp.toml declares this store's servers. permissions.toml is
# inherited from the base unchanged.
COPY --chown=sandbox:sandbox config/init.lua /sandbox/.config/maki/init.lua
COPY --chown=sandbox:sandbox config/mcp.toml /sandbox/.config/maki/mcp.toml

USER sandbox
ENV PATH=/sandbox/.bun/bin:$PATH

# Pre-warm the declared stdio MCP server's package as uid 1500, so its cache
# and global install live under /sandbox. A session then resolves the installed
# binary only: no package fetch at session time, so egress stays
# deny-by-default with no npm/registry endpoint in any policy.
RUN bun add -g synthetic-search-mcp@0.2.2 \
 && command -v synthetic-search-mcp

CMD ["/bin/bash"]
