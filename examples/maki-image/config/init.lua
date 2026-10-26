-- Global Maki configuration for the OpenShell sandbox base image.
--
-- This is the sandbox user's global config (~/.config/maki/init.lua).
-- OpenShell, not Maki, is the security boundary: filesystem, network, and
-- process policy are enforced outside this process. Personal UI preferences
-- belong in an environment image built FROM this base; see
-- examples/environments/reference/.
maki.setup({
    -- Every session starts in YOLO mode: the sandbox is the permission
    -- boundary, so an in-sandbox prompt would only block unattended runs.
    -- Explicit deny rules in permissions.toml still apply.
    always_yolo = true,

    -- Pre-answer folder trust for projects placed under /sandbox. Without
    -- this, headless runs skip a project's .maki configuration and report
    -- the skipped path on stderr. `prompt = false` also drops the trust card
    -- for interactive use in the image.
    trust = {
        paths = { "/sandbox", "/sandbox/**" },
        prompt = false,
    },
})
