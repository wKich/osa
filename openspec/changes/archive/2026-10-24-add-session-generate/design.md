# Design

The fork is the only way the pinned child can answer from the session's
context without writing to it. The fork's id comes from its own
`system.init`; the delete runs only for an id other than the parent's, so
the parent session is never removed. The answer is the reply's text (the
last top-level assistant text, else the result text). A 120 s budget bounds
the call.
