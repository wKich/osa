# Design

`/tmp` falls back to the OS temp dir where it does not exist. The workdir
rule still normalizes the path, so snapshots do not depend on the root.
