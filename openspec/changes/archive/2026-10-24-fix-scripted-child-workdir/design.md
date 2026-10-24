# Design

`OPENMAKI_CWD` is already the child's announced `cwd`; the fix uses it for the
spawned shell too. Bridge tests set it to their temp workdir, journey runs to
the journey workdir, so no test or journey writes into the repository again.
