# Reference environment store

A worked example of the environment layer: a Docker build context that adds
this user's MCP servers, the Bun runtime they need, and YOLO/compact-UI
preferences on top of the generic `maki-agent:local` base. It is opt-in — the
repository never selects it by default.

Copy this directory outside the repository to make it your own. Do not edit
`examples/maki-image/` for a personal choice; the base is shared and stays
agent-only.

## Build

The base must exist first:

```sh
maki-oss image build
docker build -t maki-agent:reference examples/environments/reference
```

Verify the derived image reports the same Maki version as the base and carries
the server runtime and package:

```sh
docker run --rm maki-agent:reference maki --version
docker run --rm --entrypoint sh maki-agent:reference -c \
  'command -v bun && command -v synthetic-search-mcp'
```

## Select it

Set `image` in `${XDG_CONFIG_HOME:-$HOME/.config}/maki-oss/config.toml` (or pass
`--image`, or export `MAKI_OSS_IMAGE`) to the tag you built:

```toml
image = "maki-agent:reference"
```

`maki-oss status`, `maki-oss doctor`, and new sandboxes use that tag. Existing
sandboxes keep their image until they are deleted and recreated; sessions and
sandbox-local state are lost on delete.

## Host-side provider setup

The store carries configuration and packages only. Credentials and egress come
from the shipped provider profiles, which stay host-side under
[`examples/providers/`](../../providers/):

- [`mcp-context7.yaml`](../../providers/mcp-context7.yaml)
- [`mcp-synthetic.yaml`](../../providers/mcp-synthetic.yaml)

Set up and attach each profile on the host. The key is migration input for
`--env` only; never copy a value into this store:

```sh
CONTEXT7_API_KEY=<key> maki-oss provider setup \
  --profile examples/providers/mcp-context7.yaml --env CONTEXT7_API_KEY --yes
maki-oss provider attach mcp-context7

maki-oss provider setup \
  --profile examples/providers/mcp-synthetic.yaml --env MCP_SYNTHETIC_API_KEY --yes
maki-oss provider attach mcp-synthetic
```

`MCP_SYNTHETIC_API_KEY` (not the host's `SYNTHETIC_API_KEY`) is deliberate: a
sandbox can attach only one provider per credential key, and `maki-synthetic`
already owns the original name.

Then check every gate from the project whose sandbox uses the derived image:

```sh
maki-oss mcp status
```

Expected: one line per server with `sandbox=ok`, the runtime gate `ok` for the
stdio server, and `provider=ok` after attachment. A missing server or runtime
points at the environment-image build and
[`docs/ai/environment-playbook.md`](../../../docs/ai/environment-playbook.md),
not at `maki-oss image build`.

## Rules this store follows

- Every `headers` and `environment` value is a `${VAR}` placeholder resolved by
  an attached provider profile. No API key, token, or OAuth secret is stored
  here.
- MCP endpoints stay in provider profiles, not in the Dockerfile or config.
- The base's `permissions.toml` deny rules are inherited unchanged.
- `.dockerignore` excludes `.git`, local credential files, and host-only
  profile copies so they cannot enter the image build context.

For the full audit → classify → generate → build → verify procedure for any
host agent, follow
[`docs/ai/environment-playbook.md`](../../../docs/ai/environment-playbook.md).
