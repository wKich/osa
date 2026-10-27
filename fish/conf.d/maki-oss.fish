# maki-oss fish plugin.
#
# This file intentionally defines no startup work: the command is a thin
# wrapper in functions/maki-oss.fish (resolution is shared in
# functions/__oss_run.fish) and the completions load on demand from
# completions/maki-oss.fish. It exists so `fisher install ./fish` installs
# the same layout as the symlink-based `maki-oss fish install`.
