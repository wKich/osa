## ADDED Requirements

### Requirement: List the sandbox's MCP servers with their observed state
The bridge SHALL answer `GET /api/mcp` with the MCP servers Maki would load in
the sandbox workdir: the `[mcp.<name>]` tables of the sandbox user's global
`maki/mcp.toml`, then the project's `.maki/mcp.toml`, with a project server
replacing a same-named global one. These SHALL be read over the sandbox exec
transport. Each server's status SHALL be:
- `disabled` when its config sets `enabled = false`;
- `connected` when a Maki child advertised a `<name>__…` tool on
  `system.init`;
- `pending` when no child has advertised its tools yet, or the child defers
  MCP tools behind `tool_search`;
- `failed` otherwise.

Without a sandbox or a config file, the list SHALL be empty.

#### Scenario: Configured servers before any child
- **WHEN** the sandbox config names servers and no session has started
- **THEN** each enabled server is listed `pending`

#### Scenario: Advertised tools decide the state
- **WHEN** a child advertised `context7__resolve-library-id` and
  `github__search`, the global config disables `github`, and the project
  config re-enables it and adds `local`
- **THEN** `context7` and `github` are `connected`, and `docs` and `local` are
  `failed` with an error naming the missing tools

#### Scenario: Disabled and deferred servers
- **WHEN** a server is disabled, and the child advertised `tool_search`
- **THEN** the disabled server is `disabled`, and enabled servers without an
  advertised tool are `pending` rather than `failed`
