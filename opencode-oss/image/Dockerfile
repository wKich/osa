# OpenCode coding-agent image for OpenShell sandboxes.
#
# Build from the repository root:
#   docker build -t opencode-agent:local opencode-oss/image
#
# The image contains no credentials. OpenShell injects provider placeholders at
# sandbox runtime; never bake secrets into this image.
#
# This is the base image: agent runtime and safety baseline only. Personal
# MCP servers, plugins, and UI preferences belong in an image built FROM this
# one, following the environment-store pattern in examples/environments/.

FROM ubuntu:24.04

# Pinned OpenCode release and the npm sha512 integrity of each platform
# tarball (hex of `npm view @opencode/<pkg>@<version> dist.integrity`). Bump
# all three together. Independent of the TUI bridge's OpenCode pin.
ARG OPENCODE_VERSION=2.1.4
ARG OPENCODE_SHA512_ARM64=76bc342d6306d2789a13de1e3d79b587baa314165945c4990f781a72dde1c773983d77aca7bc6b3add1b9f7b2271835437a7e88c446b0ca47a8d8ad79995feac
ARG OPENCODE_SHA512_AMD64=d3f1f8c110c05b8840e4858de38d17c03ad10136ef4f7727a3e514b2a1729d3bb44de1973400e32b60197ef84d4dfc89695c826bebfb56107eafb821b8c6b911

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        iproute2 \
 && rm -rf /var/lib/apt/lists/*

# Install the native OpenCode binary from its npm platform package. The
# tarball holds a self-contained executable at package/bin/opencode, so the
# image needs no Node or Bun. The x64 "baseline" build runs on CPUs without
# AVX2, including emulated amd64.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
        amd64) pkg=cli-linux-x64-baseline; sha="$OPENCODE_SHA512_AMD64" ;; \
        arm64) pkg=cli-linux-arm64; sha="$OPENCODE_SHA512_ARM64" ;; \
        *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/opencode.tgz \
        "https://registry.npmjs.org/@opencode/${pkg}/-/${pkg}-${OPENCODE_VERSION}.tgz"; \
    echo "${sha}  /tmp/opencode.tgz" | sha512sum -c -; \
    tar -xzf /tmp/opencode.tgz -C /tmp package/bin/opencode; \
    install -m 0755 /tmp/package/bin/opencode /usr/local/bin/opencode; \
    rm -rf /tmp/opencode.tgz /tmp/package; \
    /usr/local/bin/opencode --version

# Non-root sandbox identity. The sandbox policy pins the same uid/gid, so the
# image user and opencode-oss/policies/*.yaml must agree.
RUN groupadd --gid 1500 sandbox \
 && useradd --uid 1500 --gid 1500 --create-home --home-dir /sandbox \
        --shell /bin/bash --comment "OpenShell sandbox user" sandbox \
 && mkdir -p /sandbox/.config/opencode /sandbox/project \
 && chown -R sandbox:sandbox /sandbox

# Baked global OpenCode configuration: no self-update, no sharing, and the
# deny rules that protect the sandbox identity and this file.
COPY --chown=sandbox:sandbox config/opencode.json /sandbox/.config/opencode/opencode.json

# No catalog seeding step: OpenCode 2.1.4 ships its model catalog inside the
# binary, so `opencode models` works with no network. Each run still tries a
# catalog refresh from models.opencode.ai; the sandbox denies it and OpenCode
# falls back to the bundled catalog. An image ENV switch cannot stop that
# attempt because `openshell sandbox exec` does not pass image ENV through.
# Do not run OpenCode at build time without --standalone; that starts the
# background service and bakes its password into /sandbox.
ENV HOME=/sandbox
WORKDIR /sandbox
USER sandbox

CMD ["/bin/bash"]
