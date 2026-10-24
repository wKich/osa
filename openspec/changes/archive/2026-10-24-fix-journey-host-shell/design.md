# Design

`SHELL` is the harness's own setting, like `OPENCODE_DISABLE_AUTOUPDATE`; the
isolation test still rejects every host credential and host `OPENCODE_*`
variable. The workdir rule already folds a prompt's `user@host:~/journey-work`
into `<WORKDIR>`; the hostname rule covers a prompt elsewhere.
