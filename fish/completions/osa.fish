# Fish completions for osa.

complete -c osa -f

# Subcommands.
complete -c osa -n __fish_use_subcommand -a projects -d 'List every registered project'
complete -c osa -n __fish_use_subcommand -a status -d 'Report the project at PATH for each agent'
complete -c osa -n __fish_use_subcommand -a resolve -d 'Resolve a sandbox'\''s retained patch or parked workspace'
complete -c osa -n __fish_use_subcommand -a help -d 'Show usage'

# resolve SANDBOX ACTION: registered sandbox names, then the actions.
complete -c osa -n '__fish_seen_subcommand_from resolve; and test (count (commandline -opc)) -eq 2' -a '(osa projects --json 2>/dev/null | string match -ar \'"sandbox_name":"[^"]*"\' | string replace -r \'.*:"(.*)"\' \'$1\')' -d 'Sandbox'
complete -c osa -n '__fish_seen_subcommand_from resolve; and test (count (commandline -opc)) -eq 3' -a 'apply branch drop' -d 'Retained patch'
complete -c osa -n '__fish_seen_subcommand_from resolve; and test (count (commandline -opc)) -eq 3' -a 'rescue discard' -d 'Parked workspace'

# Options.
complete -c osa -n '__fish_seen_subcommand_from projects status resolve' -l json -d 'Print JSON only'
complete -c osa -n '__fish_seen_subcommand_from status' -l quick -d 'Skip the gateway; report the host fingerprint'
complete -c osa -n '__fish_seen_subcommand_from resolve' -l yes -d 'Confirm drop or discard'
complete -c osa -n '__fish_seen_subcommand_from status' -a '(__fish_complete_directories)' -d 'Project folder'
