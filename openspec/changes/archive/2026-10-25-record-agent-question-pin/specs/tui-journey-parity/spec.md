## ADDED Requirements

### Requirement: Agent questions are pin-blocked at Maki v0.6.4
The catalog SHALL record `answer-agent-question` as `blockedBy: "pin"` with a
citation of the pinned Maki source while Maki's SDK cannot raise a question.

#### Scenario: The question is dismissed under the SDK
- **WHEN** the agent calls its question tool through the bridge
- **THEN** the transcript shows the call and no form, offline and live, and
  the row cites `plugins/question/question_form.lua` v0.6.4 L598–L628
