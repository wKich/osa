#!/bin/sh
# The journeys' external editor ($EDITOR): the TUI hands it a temp file with
# the draft (tui editor.ts v2.0.32 L14–L42); it replaces the draft with one
# fixed prompt, so "edit in the editor, return to the composer" is the same
# on every side and run.
for f; do :; done
printf 'Reply with the word EDITED only.' > "$f"
