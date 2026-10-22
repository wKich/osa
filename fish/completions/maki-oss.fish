# Fish completions for maki-oss.

complete -c maki-oss -f

# Subcommands.
complete -c maki-oss -n __fish_use_subcommand -a doctor -d 'Check prerequisites'
complete -c maki-oss -n __fish_use_subcommand -a image -d 'Build the sandbox image'
complete -c maki-oss -n __fish_use_subcommand -a init -d 'Create or start the sandbox'
complete -c maki-oss -n __fish_use_subcommand -a up -d 'Create or start the sandbox'
complete -c maki-oss -n __fish_use_subcommand -a maki -d 'Ensure the sandbox and attach Maki'
complete -c maki-oss -n __fish_use_subcommand -a run -d 'Run Maki headless'
complete -c maki-oss -n __fish_use_subcommand -a upload -d 'Copy local files into the sandbox'
complete -c maki-oss -n __fish_use_subcommand -a download -d 'Copy files out of the sandbox'
complete -c maki-oss -n __fish_use_subcommand -a status -d 'Show this project sandbox'
complete -c maki-oss -n __fish_use_subcommand -a list -d 'List sandboxes on the gateway'
complete -c maki-oss -n __fish_use_subcommand -a logs -d 'Show sandbox logs'
complete -c maki-oss -n __fish_use_subcommand -a policy -d 'Work with the sandbox policy'
complete -c maki-oss -n __fish_use_subcommand -a provider -d 'Work with provider credentials'
complete -c maki-oss -n __fish_use_subcommand -a mcp -d 'Report MCP server readiness'
complete -c maki-oss -n __fish_use_subcommand -a start -d 'Start the sandbox'
complete -c maki-oss -n __fish_use_subcommand -a stop -d 'Stop the sandbox'
complete -c maki-oss -n __fish_use_subcommand -a rm -d 'Delete the sandbox'
complete -c maki-oss -n __fish_use_subcommand -a fish -d 'Install or remove the fish plugin'
complete -c maki-oss -n __fish_use_subcommand -a help -d 'Show usage'

# Nested subcommands.
complete -c maki-oss -n '__fish_seen_subcommand_from image' -a build -d 'Build the Maki image'
complete -c maki-oss -n '__fish_seen_subcommand_from policy' -a show -d 'Show the policy'
complete -c maki-oss -n '__fish_seen_subcommand_from policy' -a edit -d 'Edit the policy file'
complete -c maki-oss -n '__fish_seen_subcommand_from policy' -a apply -d 'Apply the policy file'
complete -c maki-oss -n '__fish_seen_subcommand_from policy' -a review -d 'List pending network-rule proposals'
complete -c maki-oss -n '__fish_seen_subcommand_from policy' -a approve -d 'Approve one proposal (confirmation required)'
complete -c maki-oss -n '__fish_seen_subcommand_from policy' -a reject -d 'Reject one proposal (--reason sent to the agent)'
complete -c maki-oss -n '__fish_seen_subcommand_from provider' -a add -d 'Create a provider'
complete -c maki-oss -n '__fish_seen_subcommand_from provider' -a attach -d 'Attach a provider to the sandbox'
complete -c maki-oss -n '__fish_seen_subcommand_from provider' -a list -d 'List providers on the gateway'
complete -c maki-oss -n '__fish_seen_subcommand_from provider' -a setup -d 'Set up a provider from a stored credential'
complete -c maki-oss -n '__fish_seen_subcommand_from mcp' -a status -d 'Report MCP server readiness in the sandbox'
complete -c maki-oss -n '__fish_seen_subcommand_from fish' -a install -d 'Install the fish plugin'
complete -c maki-oss -n '__fish_seen_subcommand_from fish' -a uninstall -d 'Remove the fish plugin'

# Common options.
complete -c maki-oss -l name -r -d 'Sandbox name'
complete -c maki-oss -l image -r -d 'Sandbox image reference'
complete -c maki-oss -l policy -r -F -d 'Policy YAML file'
complete -c maki-oss -l provider -r -d 'Attach a provider at creation'
complete -c maki-oss -l cpu -r -d 'CPU limit (for example 2, 500m)'
complete -c maki-oss -l memory -r -d 'Memory limit (for example 4Gi)'
complete -c maki-oss -l engine -r -a 'docker podman' -d 'Container engine'
complete -c maki-oss -l gateway -r -d 'OpenShell gateway name'
complete -c maki-oss -l workdir -r -d 'In-sandbox project directory'
complete -c maki-oss -l env -r -d 'Non-secret KEY=VALUE, or host var for setup'
complete -c maki-oss -l allow-env -r -d 'Allow a credential-like --env key'
complete -c maki-oss -l yes -d 'Skip the confirmation prompt'

# logs options.
complete -c maki-oss -l tail -d 'Stream live logs'
complete -c maki-oss -l since -r -d 'Only logs since this duration (5m, 1h)'
complete -c maki-oss -l source -r -a 'gateway sandbox all' -d 'Log source'
complete -c maki-oss -l level -r -a 'error warn info debug trace' -d 'Minimum log level'
complete -c maki-oss -s n -l lines -r -d 'Number of log lines'

# policy options.
complete -c maki-oss -l full -d 'Include the effective policy'
complete -c maki-oss -l base -d 'Show the base policy'
complete -c maki-oss -l global -d 'Use the gateway-global policy'
complete -c maki-oss -l wait -d 'Wait for the change to apply'
complete -c maki-oss -l reason -r -d 'Rejection reason for policy reject (sent to the agent)'

# provider options.
complete -c maki-oss -l type -r -a 'maki-anthropic maki-openrouter maki-deepseek maki-synthetic maki-openai maki-google maki-mistral maki-xai maki-zai maki-zai-coding maki-opencode maki-opencode-go' -d 'Provider profile type'
complete -c maki-oss -l credential -r -d 'Credential key (add) or store slug (setup)'
complete -c maki-oss -l config -r -d 'Provider config KEY=VALUE'
complete -c maki-oss -l from-existing -d 'Read credentials from existing local state'
complete -c maki-oss -l runtime-credentials -d 'Resolve credentials at runtime'
complete -c maki-oss -l global-profile -d 'Use a platform-scoped profile'

# provider setup options.
complete -c maki-oss -l from -r -a 'maki opencode' -d 'Credential store for provider setup'
complete -c maki-oss -l file -r -F -d 'JSON credential file for provider setup'
complete -c maki-oss -l field -r -d 'JSON field path (default: .api_key)'
complete -c maki-oss -l profile -r -F -d 'Provider profile file for provider setup'
complete -c maki-oss -l attach -d 'Attach the provider to the project sandbox'
complete -c maki-oss -l no-attach -d 'Never attach, even interactively'

# run and session options.
complete -c maki-oss -l model -r -d 'Model for sessions and run (provider/model)'
complete -c maki-oss -s c -l continue -d 'Resume the most recent session in the sandbox workdir'
complete -c maki-oss -s r -l resume -r -d 'Resume a specific session by id'
complete -c maki-oss -l session-id -r -d 'Write the run under a chosen session id'
complete -c maki-oss -l timeout -r -d 'run: end Maki inside the sandbox after SECS seconds'
complete -c maki-oss -l no-sync -d 'Skip the download back to the host on exit'

# image build options.
complete -c maki-oss -l maki-version -r -d 'Maki release version to build'
complete -c maki-oss -l no-git-ignore -d 'Upload everything, ignoring .gitignore'

complete -c maki-oss -s h -l help -d 'Show usage'
