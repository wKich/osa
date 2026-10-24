# Design

The `Attached directory:` and image `Attached file:` lines name the sandbox
path where OpenCode names its own (host) path: the model works in the
sandbox, where the host path does not exist. Ranking is a subsequence score
(word-boundary and run bonuses), not a fuzzysort port; the pinned
ordering rules (score, then path length) are kept.

Remaining differences on `mention-file-in-prompt`: the session title and the
silent command's `Exit code: 0`, both accepted on earlier journeys with the
same reasons.
