## ADDED Requirements

### Requirement: Report a Maki edit's file diff
For a successful `Edit` whose new text occurs exactly once in the edited
file, the bridge SHALL report the edit's unified patch, with addition and
deletion counts, as `metadata.files` on `session.tool.success`. It SHALL
report no diff for an edit it cannot undo unambiguously, and SHALL keep the
session's frames in order while it reads the file.

#### Scenario: The edit renders with its diff
- **WHEN** the agent replaces `alpha` with `beta` in `notes.txt`
- **THEN** the transcript shows `← Edit notes.txt` with `1 - alpha` and
  `1 + beta`, as the reference does

#### Scenario: An ambiguous edit renders without a diff
- **WHEN** the edited file holds the new text more than once
- **THEN** the success frame carries no file diff
