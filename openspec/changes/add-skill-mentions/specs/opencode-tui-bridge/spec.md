## ADDED Requirements

### Requirement: Offer and deliver skills as Maki discovers them
The bridge SHALL list Maki's builtin `maki-plugin-dev` skill first and then
the skills Maki's skill plugin discovers in the sandbox, SHALL emit
`skill.updated` after a turn that changed that set, and SHALL deliver a
prompt's selected sandbox skill to the child as OpenCode's prepared
`<skill_content>` text, reporting each known skill on the admitted prompt.

#### Scenario: A skill written by a turn can be mentioned
- **WHEN** a turn writes `.opencode/skills/journey-greet/SKILL.md` and the
  user runs `/skills`
- **THEN** the dialog lists `journey-greet`, and once it is picked and the
  prompt sent, the transcript lists it under the prompt and the child's
  `user` frame carries its `<skill_content name="journey-greet">`

#### Scenario: The builtin skill is listed without content
- **WHEN** the TUI reads `/api/skill`
- **THEN** the first entry is `maki-plugin-dev` at
  `/builtin/maki-plugin-dev`
