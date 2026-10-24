# Design

The transport costs one round trip per exec, so each request batches its
git commands: repository facts in one exec, the change lists in a second,
and every file's patch in a third (`git … ; printf <sep><code>`), parsed back
by separators. The rules follow the provider line by line; the batching of
patches into one `git diff` the provider uses is replaced by per-file
patches, which carry the same text. A session shares the project id the
bridge currently reads, so sessions follow the checkout when it becomes a
repository.
