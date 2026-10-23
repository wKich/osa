## ADDED Requirements

### Requirement: Describe Maki's model catalog and provider connections
The bridge SHALL answer `GET /api/model`, `GET /api/provider` and
`GET /api/integration` from what Maki can run in the sandbox. Two outputs are
read once at boot over the sandbox exec transport: `maki models` (one
`provider/model-id` per line) and `maki auth status`.

The model list SHALL lead with the model a Maki child announced, or, before
any announcement, the configured model, followed by the rest of the catalog.
The provider list SHALL name every provider in the model list or in the auth
status. Every provider whose key comes from an environment variable
(`(via VAR)`) SHALL be an integration with that variable as its only `env`
method and its `env` connection. A provider without credentials SHALL not be
listed as an integration.

Only when there is neither a catalog nor a configured or announced model may
the model list fall back to the synthesized entry permitted before an
announcement.

#### Scenario: The configured model leads the catalog
- **WHEN** the helper configured `anthropic/claude-sonnet-5-5`, the sandbox's
  `maki models` lists two `synthetic/…` models and that model, and no child
  has started
- **THEN** the model list starts with the configured model, followed by the
  two `synthetic/…` models, without duplicates

#### Scenario: The announced model moves to the front
- **WHEN** a child announces `synthetic/fake`
- **THEN** the refetched model list starts with `synthetic/fake`

#### Scenario: Env-backed providers are connected integrations
- **WHEN** `maki auth status` reports `synthetic` and `anthropic` via
  `SYNTHETIC_API_KEY` and `ANTHROPIC_API_KEY`, and `openai` as not logged in
- **THEN** the integration list holds `synthetic` and `anthropic`, each with
  that variable as its `env` method and connection, and `openai` is absent
