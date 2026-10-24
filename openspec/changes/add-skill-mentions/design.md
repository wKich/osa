# Design

The change check runs after each terminal execution frame, the only time a
turn can have written a skill; the TUI's own reads reset the baseline. A
user config that sets `plugin_dev = false` would still list the builtin; the
image's config does not set it.

Accepted on `mention-skill-in-prompt`: the title, `Exit code: 0`, each
server's builtin skills, the dialog-occluded model label, and OpenCode's
"Instructions updated" notice, which Maki has no counterpart for.
