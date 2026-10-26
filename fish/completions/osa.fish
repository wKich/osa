# Fish completions for osa.

complete -c osa -f

# Subcommands.
complete -c osa -n __fish_use_subcommand -a projects -d 'List every registered project'
complete -c osa -n __fish_use_subcommand -a status -d 'Report the project at PATH for each agent'
complete -c osa -n __fish_use_subcommand -a help -d 'Show usage'

# Options.
complete -c osa -n '__fish_seen_subcommand_from projects status' -l json -d 'Print one JSON array'
complete -c osa -n '__fish_seen_subcommand_from status' -l quick -d 'Skip the gateway; report the host fingerprint'
complete -c osa -n '__fish_seen_subcommand_from status' -a '(__fish_complete_directories)' -d 'Project folder'
