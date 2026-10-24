# Design

Export reuses the projected history, so it lists exactly what a reopened TUI
renders. Settled follows the real filter: an assistant message counts once
it has `time.completed`. The sanitizer ports the real redaction for the
message types the bridge projects (user, assistant, idle) and the session
info fields it fills (title, metadata, location).
