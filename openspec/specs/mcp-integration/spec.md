# mcp-integration Specification

## Purpose

Lets an MCP server configured on the host also work from a Maki session inside
an OpenShell sandbox: the server's config, credential, and network reach are
each supplied by a mechanism the sandbox boundary allows, and every server that
cannot work is reported by name with the reason instead of being silently
absent.

## Requirements

### Requirement: MCP servers work through profiles, not copied config

An MCP server usable inside the sandbox SHALL be backed by an OpenShell
provider profile that declares the endpoint its traffic needs and binds the
server's credential to that endpoint: for an HTTP MCP server, the server's
endpoint as `protocol: mcp` with the host, port, and path the server actually
serves; for a stdio MCP server — whose Maki-facing leg is a local pipe the
gateway never inspects — the upstream API endpoint the server process calls,
with the protocol that endpoint serves. The helper SHALL lint each such profile
against the installed gateway before import and SHALL import it at global
scope, exactly as it does for inference profiles. The base sandbox policy SHALL
NOT gain an endpoint of its own for either kind; reach SHALL come only from
the server's attached provider profile.

#### Scenario: A shipped MCP profile lints and imports
- **WHEN** the user runs `maki-oss provider setup --profile examples/providers/mcp-context7.yaml --env CONTEXT7_API_KEY --yes`
- **THEN** the profile lints against the installed gateway, imports at global scope, creates the provider, and the sandbox's effective policy gains only that profile's endpoint

#### Scenario: The incremental policy path is not used for MCP
- **WHEN** any helper command needs to make an MCP endpoint reachable
- **THEN** no `openshell policy update --add-endpoint` invocation carries an MCP endpoint, because the incremental path cannot express `protocol: mcp`

#### Scenario: A profile that fails lint changes nothing
- **WHEN** an MCP profile's fields do not match the installed gateway's schema
- **THEN** the helper exits non-zero with the lint error and imports no profile and creates no provider

#### Scenario: A stdio server's upstream profile lints and imports
- **WHEN** the user runs `maki-oss provider setup --profile examples/providers/mcp-synthetic.yaml --env MCP_SYNTHETIC_API_KEY --yes`
- **THEN** the profile lints against the installed gateway, imports at global scope, creates the provider, and the sandbox's effective policy gains only that profile's upstream API endpoint

### Requirement: MCP config travels with the sandbox, without credentials

The sandbox SHALL carry each enabled MCP server's definition at the sandbox
user's global Maki MCP config path, and that file SHALL reference credentials
only through `${VAR}` expansion of the placeholder environment variables the
attached provider injects. No credential value, OAuth client secret, or access
token SHALL appear in any file copied or baked into the sandbox, in the image,
or in any helper-generated artifact.

#### Scenario: A header references the placeholder, not the value
- **WHEN** the sandbox config for an HTTP MCP server is rendered
- **THEN** its `headers` expand a `${VAR}` that names a provider-injected placeholder variable, and the file contains no literal token

#### Scenario: A server whose variable is unset fails loudly
- **WHEN** a server's referenced variable is not injected because its provider is detached
- **THEN** that server fails with the variable named in its status, and the other configured servers still work

### Requirement: A stdio MCP server works when the image provides its runtime

The sandbox image built from the base plus the environment layer SHALL run a
stdio MCP server (one configured with a `command` array) when that image
provides the command that array names and the server's package is installed in
that image. The runtime and the package SHALL be installed at environment-image
build time; the helper MUST NOT install a runtime, fetch a package, or
otherwise add code to a running sandbox. When the command is absent from the
sandbox, `maki-oss mcp status` SHALL report that server with the missing
command named and the environment-image build guidance as the fix. The server's
`environment` entries in the sandbox's MCP config SHALL reference credentials
only through `${VAR}` expansion of provider-injected placeholder variables,
never a value copied from the host config.

#### Scenario: A stdio server with its runtime present passes the runtime gate
- **WHEN** the environment image provides the command the baked config names and the user runs `maki-oss mcp status`
- **THEN** that server is judged by its runtime, config, and provider gates like any other server, instead of being rejected as unsupported for its transport

#### Scenario: A missing runtime is named with the build fix and nothing is installed
- **WHEN** the baked config names a command that is absent from the sandbox and the user runs `maki-oss mcp status`
- **THEN** the output names the missing command for that server with the environment-image build guidance as the fix, exits non-zero, and no package install, runtime install, or image change is attempted

#### Scenario: The baked stdio config carries a placeholder, not the host's value
- **WHEN** a stdio server entry with an `environment` credential is rendered into the image's MCP config
- **THEN** its `environment` values expand a `${VAR}` naming a provider-injected placeholder variable, and the file contains no literal credential from the host config

### Requirement: MCP readiness is reported per server

The helper SHALL report, for every server it checks, one line naming the
server and the state of each gate that decides whether it works in the
sandbox. For an HTTP server those gates are: present in the sandbox's MCP
config, provider attached, endpoint present in the effective policy, and
transport supported. For a stdio server they are: present in the sandbox's MCP
config, the command named by its `command` array present in the sandbox (the
runtime gate), and provider attached — its endpoint gate is carried by the
attached profile, because a stdio server's config names no URL. The set of
servers checked SHALL include every server enabled in the host's
`~/.config/maki/mcp.toml`, so a server added on the host after the environment
image was built is reported rather than silently absent. A server missing any
gate SHALL be reported with the specific gate that fails and the command or
guidance that fixes it. For a server or runtime absent from the sandbox, the
fix SHALL name the environment-image build and the environment playbook, not a
base-image rebuild. Reporting SHALL be read-only and MUST NOT mutate the
sandbox, the gateway, or any profile.

#### Scenario: A ready server is reported ready
- **WHEN** a server's gates for its transport all hold
- **THEN** its line reports all gates satisfied and the command exits zero

#### Scenario: An unattached provider is named as the failing gate
- **WHEN** a server's config and endpoint exist but its provider is not attached to the sandbox
- **THEN** its line names the attachment as the failing gate and prints the `maki-oss provider attach` command, and the command exits non-zero

#### Scenario: A stdio server missing its runtime is named as the failing gate
- **WHEN** the host and sandbox configs both declare a stdio server whose command is absent from the sandbox, and the user runs `maki-oss mcp status`
- **THEN** its line names the runtime gate as failing and prints the environment-image build guidance as the fix, and the command exits non-zero

#### Scenario: A server added to the host after the image build is reported
- **WHEN** the host's `~/.config/maki/mcp.toml` enables a server that the baked sandbox config does not contain
- **THEN** the report names that server as absent from the sandbox, with the environment-image build guidance as the fix

#### Scenario: A zero-MCP base points at the environment layer
- **WHEN** the sandbox is built from the base image and the host enables an MCP server that the base does not declare
- **THEN** the report names the server as absent and the fix directs the user to build and select an environment image, not to rebuild the base

#### Scenario: Reporting never mutates
- **WHEN** the readiness report runs against a sandbox in any phase
- **THEN** no `sandbox create`, `provider attach`, `profile import`, or policy update invocation is recorded
### Requirement: MCP revisions a gateway cannot serve fail by name

An MCP server whose protocol revision is not in the endpoint's allowed
`mcp.versions` SHALL fail with a named policy error rather than appearing
working or silently disconnected, and the helper's readiness report SHALL
surface that state for the affected server.

#### Scenario: A revision the policy excludes is reported
- **WHEN** a server negotiates a revision excluded by its endpoint policy
- **THEN** the readiness report names the revision mismatch for that server instead of reporting it ready

### Requirement: Shipped MCP profiles match the pinned gateway

Every MCP profile shipped under `examples/providers/` SHALL lint clean against
the OpenShell version this repository pins, and its field spellings SHALL match
that version's schema. When the pinned OpenShell version changes, the shipped
MCP profiles SHALL be re-verified against it.

#### Scenario: Shipped profiles lint against the pinned version
- **WHEN** the pinned OpenShell version is installed and each shipped MCP profile is linted
- **THEN** every profile passes lint with no field-name errors
