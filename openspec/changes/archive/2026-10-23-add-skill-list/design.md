# Design

## Context

- Maki v0.6.4, `plugins/skill/init.lua`:
  - `PROJECT_SKILL_DIRS` and `GLOBAL_SKILL_DIRS` are at L11–L17.
    `discover_skills` scans the builtin skill, then
    `config_dir()/skills`, then the home dirs, then the workdir and its
    ancestors up to the first `.git` (L98–L130).
  - Skills are kept in a table keyed by name, so a later write wins.
  - The name comes from frontmatter, falling back to the directory name, and
    an empty body is skipped (L34; `skill_helpers.lua` L3–L19).
- OpenCode v2.0.32: `Skill.Info {id, name, description?, path, content}`
  (vendored OpenAPI). It is offered as `@skill` in
  `tui/src/component/prompt/autocomplete.tsx` L427–L441 and in `/skills`.

## Decisions

1. **The scan is Maki's, in the sandbox.** One fixed `sh` script walks the
   same directories in the same order. The bridge reads no host path.
2. **`id` is the name.** That is the key Maki's `skill` tool takes.
3. **The builtin `maki-plugin-dev` skill is not listed.** Its content is
   compiled into the binary and has no `SKILL.md` path to report.
4. **A picked skill needs no forwarding.** Its mention text is in the prompt
   (`Prompt.Mention` spans the text), and the child's `skill` tool lists the
   same skills to the model.
