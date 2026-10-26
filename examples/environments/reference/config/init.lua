-- Global Maki configuration for the reference environment image.
--
-- This is the sandbox user's global config (~/.config/maki/init.lua). It
-- replaces the base image's file, so the shared YOLO and trust settings are
-- repeated here. OpenShell, not Maki, is the security boundary: filesystem,
-- network, and process policy are enforced outside this process. These
-- settings only make unattended sandbox runs work without interactive prompts.
maki.setup({
    -- Keep the base's YOLO default: every session starts without permission
    -- prompts, and explicit deny rules in permissions.toml still apply.
    always_yolo = true,

    -- Compact chat rendering, matching the host's low-verbosity setup.
    ui = {
        thinking_lines = 0,          -- reasoning collapses to its header
        typewriter_ms_per_char = 0,  -- text lands instantly
        tool_output_lines = {
            bash = 1, code_execution = 1, task = 1, index = 1, grep = 1,
            read = 1, write = 1, web = 1, other = 1,
        },
    },

    -- Pre-answer folder trust for projects placed under /sandbox. Without
    -- this, headless runs skip a project's .maki configuration and report
    -- the skipped path on stderr. `prompt = false` also drops the trust card
    -- for interactive use in the image.
    trust = {
        paths = { "/sandbox", "/sandbox/**" },
        prompt = false,
    },
})
