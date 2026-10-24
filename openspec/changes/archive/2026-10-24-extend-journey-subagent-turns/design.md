# Design

The live fixture shows the subagent's frames as buffered `assistant`/`user`
frames carrying `parent_tool_use_id`, interleaved before the task's own
`tool_result`, whose content is the subagent's final text (`plugins/task/
init.lua` v0.6.4 L248). The scripted child mirrors exactly that.
