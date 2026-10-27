# Fish completions for osa.

complete -c osa -f

# Subcommands.
complete -c osa -n __fish_use_subcommand -a projects -d 'List every registered project'
complete -c osa -n __fish_use_subcommand -a status -d 'Report the project at PATH for each agent'
complete -c osa -n __fish_use_subcommand -a health -d 'Report a sandbox'\''s idle stop, MCP readiness, and doctor checks'
complete -c osa -n __fish_use_subcommand -a providers -d 'List setup profiles and providers per agent'
complete -c osa -n __fish_use_subcommand -a images -d 'Report each agent'\''s base image'
complete -c osa -n __fish_use_subcommand -a resolve -d 'Resolve a sandbox'\''s retained patch or parked workspace'
complete -c osa -n __fish_use_subcommand -a provider -d 'Set up a provider from stdin (provider setup)'
complete -c osa -n __fish_use_subcommand -a image -d 'Build an agent'\''s base image (image build)'
complete -c osa -n __fish_use_subcommand -a help -d 'Show usage'

# health SANDBOX and resolve SANDBOX ACTION: registered sandbox names, then
# the resolve actions.
complete -c osa -n '__fish_seen_subcommand_from health resolve; and test (count (commandline -opc)) -eq 2' -a '(osa projects --json 2>/dev/null | string match -ar \'"sandbox_name":"[^"]*"\' | string replace -r \'.*:"(.*)"\' \'$1\')' -d 'Sandbox'
complete -c osa -n '__fish_seen_subcommand_from resolve; and test (count (commandline -opc)) -eq 3' -a 'apply branch drop' -d 'Retained patch'
complete -c osa -n '__fish_seen_subcommand_from resolve; and test (count (commandline -opc)) -eq 3' -a 'rescue discard' -d 'Parked workspace'

# provider setup TAG and image build TAG.
complete -c osa -n '__fish_seen_subcommand_from provider; and test (count (commandline -opc)) -eq 2' -a setup -d 'Set up a provider from a credential on stdin'
complete -c osa -n '__fish_seen_subcommand_from image; and test (count (commandline -opc)) -eq 2' -a build -d 'Build the base image'
complete -c osa -n '__fish_seen_subcommand_from setup build; and test (count (commandline -opc)) -eq 3' -a 'mk oc cc cx' -d 'Agent'

# Options.
complete -c osa -n '__fish_seen_subcommand_from projects status health providers images resolve setup' -l json -d 'Print JSON only'
complete -c osa -n '__fish_seen_subcommand_from providers' -l agent -x -a 'mk oc cc cx' -d 'Only this agent'
complete -c osa -n '__fish_seen_subcommand_from setup' -l profile -x -d 'Profile id'
complete -c osa -n '__fish_seen_subcommand_from setup' -l name -x -d 'Provider name (default: the profile id)'
complete -c osa -n '__fish_seen_subcommand_from setup' -l attach -x -a '(osa projects --json 2>/dev/null | string match -ar \'"sandbox_name":"[^"]*"\' | string replace -r \'.*:"(.*)"\' \'$1\')' -d 'Registered sandbox'
complete -c osa -n '__fish_seen_subcommand_from setup' -l yes -d 'Update an existing provider'\''s credential'
complete -c osa -n '__fish_seen_subcommand_from status' -l quick -d 'Skip the gateway; report the host fingerprint'
complete -c osa -n '__fish_seen_subcommand_from resolve' -l yes -d 'Confirm drop or discard'
complete -c osa -n '__fish_seen_subcommand_from status' -a '(__fish_complete_directories)' -d 'Project folder'
