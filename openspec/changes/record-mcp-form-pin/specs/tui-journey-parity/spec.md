## ADDED Requirements

### Requirement: MCP forms are pin-blocked at Maki v0.6.4
The catalog SHALL record `answer-mcp-form` as `blockedBy: "pin"` with a
citation of Maki's MCP client capabilities while Maki declares no
elicitation.

#### Scenario: Maki's call returns without a form
- **WHEN** the agent calls the journey server's `ask_color`
- **THEN** on the Maki side, offline and live, the call returns that it
  could not ask and the reply renders
