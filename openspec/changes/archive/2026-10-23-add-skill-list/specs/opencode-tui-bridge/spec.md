## ADDED Requirements

### Requirement: List the skills the Maki child discovers
The bridge SHALL answer `GET /api/skill` with the skills Maki's skill plugin
discovers in the sandbox, read over the sandbox exec transport. Each
`<dir>/<name>/SKILL.md` is read from these places, in this order:
1. the sandbox user's Maki config `skills` directory;
2. the home `.claude/skills`, `.config/opencode/skills` and `.agents/skills`;
3. the workdir and each ancestor up to the first one containing `.git`, using
   `.maki/skills`, `.claude/skills`, `.opencode/skills` and `.agents/skills`.

A later skill with the same name SHALL replace an earlier one. A skill with an
empty body SHALL be skipped. A skill without frontmatter SHALL be named after
its directory. Without a sandbox, the list SHALL be empty.

#### Scenario: Discovered skills with Maki's precedence
- **WHEN** the config dir and the repository root both define `release`, the
  home defines `review`, the workdir holds a frontmatter-less `plain-notes`
  and an empty `empty`, and a directory above the git root defines `outside`
- **THEN** the list is `plain-notes`, the repository's `release` and
  `review`, each with its absolute `SKILL.md` path, description and body, and
  neither `empty` nor `outside` appears
