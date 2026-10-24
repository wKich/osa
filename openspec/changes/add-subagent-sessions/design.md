# Design

A child is a bridge session with a stub child process: prompts to it answer
503 (a Maki subagent cannot be continued over the SDK), and its translator
projects its frames like any session's. The parent run blocks on the task
call while the subagent runs, so an unflagged stream event in that window is
the subagent's; the task's own streamed block, which the pinned child sends
right after the buffered call, stays with the parent. Remaining differences
on `open-subagent-session`: the session title (accepted), OpenCode's
subagent preamble (`You are a subagent spawned by another session.`, which
Maki does not add — `plugins/task/init.lua` v0.6.4 L211–L214), and the
`Terminals` tab, which waits on the terminal capability, so the journey stays
`diverges`.
