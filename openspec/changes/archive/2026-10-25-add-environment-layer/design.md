# Design

## Context

See `proposal.md` for motivation. The current `examples/maki-image/` build
context mixes three things: a generic Maki runtime, a safety configuration,
and one person's environment (`context7`, `synthetic`, the
`synthetic-search-mcp` package, Bun installed for it, and YOLO/compact-UI
preferences). `examples/config.toml` also selects an Anthropic provider.
`maki-oss image build` builds that one context as `maki-agent:local`.

The helper already accepts any image through the `image` setting, and
`maki-oss mcp status` already treats the host's `~/.config/maki/mcp.toml` as
the list of servers to check. The active `add-oauth-mcp-support` change adds
`[mcp.linear]` to the same baked `mcp.toml`, so it must move with the
environment layer.

Constraints that shape the design:

- OpenShell remains the security boundary: no bind mounts, no secrets in
  `--env`, deny-by-default egress, non-root sandbox user.
- Maki reads global config from `/sandbox/.config/maki/` and project config
  from the uploaded project; folder trust is pre-answered for `/sandbox`.
- The first slice must not add a new store-specific helper command. The
  existing `image` setting is enough to select a derived image.
- `make test` remains offline and stub-backed.

## Goals / Non-Goals

**Goals:**

- Make the base image generic: agent runtime plus safety baseline, zero MCP
  servers, zero MCP-specific runtime.
- Prove the layering with one self-contained reference environment store and
  one agent-agnostic recipe.
- Keep the default path working: a user who builds only the base still gets a
  functioning sandboxed agent, just without the relocated MCPs.
- Keep the security invariants and the existing helper surface unchanged.

**Non-Goals:**

- A new `maki-oss image build --context` command or an `environment` config
  key. The first slice uses ordinary `docker build` and the existing `image`
  setting; the helper flag is the next follow-up.
- Store-aware `mcp status` source of truth. This slice keeps the host config
  as the oracle and only corrects the fix guidance.
- Automatic provider-profile generation from host MCP configs.
- A multi-agent compatibility matrix or automatic plugin translation.
- Drift detection, image labels, secret scanning, per-project overlays, or
  OAuth live support.

## Decisions

**1. Base is agent runtime plus safety; personal behavior moves out.**
The base keeps Maki, git/curl/ca-certificates, uid/gid 1500, Landlock,
minimal filesystem policy, folder trust for `/sandbox`, and the
`permissions.toml` deny rules. It drops the two MCP entries, the
`synthetic-search-mcp` package, Bun (installed only for that package), and the
`always_yolo`/compact-UI settings. The base ships a comments-only `mcp.toml`
so the config path exists without declaring a server. Rationale: a new user
should not inherit one person's tools or permission posture. Alternative
considered: keep Bun as a generic runtime; rejected because it is an MCP
choice, and the reference store can install it.

**2. The environment is a plain Docker build context, not a manifest.**
The store is a directory with a `Dockerfile` that builds `FROM the base image`.
Arbitrary package installs, config copies, skills, and plugins stay ordinary
Dockerfile steps. Rationale: Docker is already a dependency, the contract is
inspectable, and arbitrary user runtimes cannot be modeled cleanly without an
escape hatch. Alternative considered: a declarative `environment.toml` plus a
generator; rejected for this slice because it adds a schema and generator
before the pattern is proven.

**3. The repository ships a reference store, not a default environment.**
`examples/environments/reference/` carries the relocated MCPs, the Bun
runtime, the YOLO/UI preferences, a `.dockerignore`, and a README. The default
`examples/config.toml` selects the base image and no provider. Rationale: the
pattern needs a worked example, but an example must not become the product
default. Alternative considered: no example, only docs; rejected because the
existing tests and docs need a concrete artifact and users need to see the
shape.

**4. MCP profiles stay in `examples/providers/`.**
The reference store's README points at the shipped `mcp-context7.yaml` and
`mcp-synthetic.yaml`. They are host-side egress/credential definitions, not
image content, so they do not belong in the build context. Rationale: one
canonical location keeps `make lint-profiles` simple and avoids duplicate
profiles drifting. Alternative considered: co-locate profiles in the
reference store; rejected because the store would then mix host-side and
image-side artifacts.

**5. `mcp status` keeps the host config as the oracle in this slice.**
The only behavioral change is the fix guidance: a server or runtime absent
from the sandbox points at the environment image and
`docs/ai/environment-playbook.md`, not `maki-oss image build`. Rationale: the
store-aware source of truth needs an `environment` config key and a spec
change of its own; this slice can land without it. Known consequence: a user
who intentionally omits a host server from the store will see a persistent
"missing" warning until the follow-up. Alternative considered: implement
store-aware readiness now; rejected as scope creep that delays the base split.

**6. The derived image is selected through the existing `image` setting.**
`maki-oss image build` continues to build the base as `maki-agent:local`.
A user builds a store with the configured engine and sets `image` to its tag;
`maki-oss status`, `doctor`, and sandbox creation already use that setting.
Rationale: zero new helper code, and the first slice proves the artifact
boundary before adding convenience. Alternative considered: add `--context`
now; deferred to the follow-up.

**7. Credentials and egress remain host-side.**
The store may contain MCP definitions and package installs, but every
`headers`/`environment` value uses `${VAR}` placeholders. Real values and
endpoints stay in OpenShell provider profiles, and the recipe classifies a
host literal as migration input for `provider setup`, never as store content.
Rationale: the sandbox must never carry a secret, and the image build must not
become a credential channel. Alternative considered: allow host literals in
the store for convenience; rejected outright.

**8. The OAuth example moves with the environment.**
`add-oauth-mcp-support` adds `[mcp.linear]` and its profile; its task must
target the reference store's `config/mcp.toml` (and the host-side profile),
not `examples/maki-image/config/mcp.toml`. Rationale: zero-MCP base and a
baked OAuth server are contradictory. The OAuth change stays a separate
change; this change only changes its target.

## Risks / Trade-offs

- **Breaking image contents** → document the migration and keep the reference
  store as the restore path; existing sandboxes keep the old image until
  recreated.
- **Host-oracle false positives** → accept for one slice; the follow-up adds
  store-aware readiness, and the playbook explains the warning.
- **Interactive sessions prompt more** when `always_yolo` leaves the base →
  the reference store restores the previous behavior, and `maki-oss run`
  already passes `--yolo` for headless work.
- **User build contexts are arbitrary code** → the recipe requires reviewing
  the Dockerfile, a `.dockerignore`, and a secret scan; the helper does not
  build a store in this slice, so the user runs the reviewable `docker build`
  directly.
- **Maki global skill/plugin discovery is not yet proven** → the recipe
  reports unsupported items rather than claiming them; if global skills are
  unavailable, the store can still carry image-installed config and plugins.
- **Reference store package versions drift** → pin `BUN_VERSION` and
  `synthetic-search-mcp` in the store Dockerfile, as the base already pins
  Maki.

## Migration Plan

1. Build the generic base with `maki-oss image build`.
2. If the user wants the relocated behavior, build the reference store with
   `docker build -t maki-agent:reference examples/environments/reference`,
   then set `image = "maki-agent:reference"` in the helper config.
3. Recreate existing sandboxes to pick up the new image; sessions and
   sandbox-local state are lost on delete, as documented by the helper.
4. A user who keeps the default base gets a working agent with no MCP
   servers; adding any server means creating a store.
5. Retarget `add-oauth-mcp-support` before it is implemented.

## Open Questions

- Exact Maki discovery paths for global skills and plugins. The recipe will
  verify them during implementation; if they do not exist, skills stay
  project-scoped or image-installed and the playbook says so.
- Whether Maki accepts a comments-only `mcp.toml` or requires the file to be
  absent. The implementation verifies this; the fallback is to omit the file
  from the base and put the commented template in the reference store.

## Upstream References

- Maki configuration: <https://maki.sh/docs/configuration/>
- Maki permissions: <https://maki.sh/docs/permissions/>
- Maki folder trust: <https://maki.sh/docs/folder-trust/>
- OpenShell profiles: <https://docs.nvidia.com/openshell/how-it-works/providers/profiles.md>
- OpenShell policies: <https://docs.nvidia.com/openshell/how-it-works/policies/overview.md>
- OpenShell security best practices:
  <https://docs.nvidia.com/openshell/security/best-practices.md>
