# Fish completions for opencode-oss.

complete -c opencode-oss -f

# Subcommands.
complete -c opencode-oss -n __fish_use_subcommand -a doctor -d 'Check prerequisites'
complete -c opencode-oss -n __fish_use_subcommand -a image -d 'Build the sandbox image'
complete -c opencode-oss -n __fish_use_subcommand -a init -d 'Create or start the sandbox'
complete -c opencode-oss -n __fish_use_subcommand -a up -d 'Create or start the sandbox'
complete -c opencode-oss -n __fish_use_subcommand -a opencode -d 'Ensure the sandbox and attach the OpenCode TUI'
complete -c opencode-oss -n __fish_use_subcommand -a run -d 'Run OpenCode headless'
complete -c opencode-oss -n __fish_use_subcommand -a upload -d 'Refresh the workspace, or copy a path as-is'
complete -c opencode-oss -n __fish_use_subcommand -a download -d 'Copy files out of the sandbox'
complete -c opencode-oss -n __fish_use_subcommand -a status -d 'Show the project sandbox'
complete -c opencode-oss -n __fish_use_subcommand -a list -d 'List sandboxes on the gateway'
complete -c opencode-oss -n __fish_use_subcommand -a logs -d 'Show sandbox logs'
complete -c opencode-oss -n __fish_use_subcommand -a policy -d 'Work with the sandbox policy'
complete -c opencode-oss -n __fish_use_subcommand -a provider -d 'Work with provider credentials'
complete -c opencode-oss -n __fish_use_subcommand -a mcp -d 'Report MCP server readiness'
complete -c opencode-oss -n __fish_use_subcommand -a start -d 'Start the sandbox'
complete -c opencode-oss -n __fish_use_subcommand -a stop -d 'Stop the sandbox'
complete -c opencode-oss -n __fish_use_subcommand -a rm -d 'Delete the sandbox'
complete -c opencode-oss -n __fish_use_subcommand -a fish -d 'Install or remove the fish plugin'
complete -c opencode-oss -n __fish_use_subcommand -a help -d 'Show usage'

# Nested subcommands.
complete -c opencode-oss -n '__fish_seen_subcommand_from image' -a build -d 'Build the OpenCode image'
complete -c opencode-oss -n '__fish_seen_subcommand_from policy' -a show -d 'Show the policy'
complete -c opencode-oss -n '__fish_seen_subcommand_from policy' -a edit -d 'Edit the policy file'
complete -c opencode-oss -n '__fish_seen_subcommand_from policy' -a apply -d 'Apply the policy file'
complete -c opencode-oss -n '__fish_seen_subcommand_from policy' -a review -d 'List pending network-rule proposals'
complete -c opencode-oss -n '__fish_seen_subcommand_from policy' -a approve -d 'Approve one proposal (confirmation required)'
complete -c opencode-oss -n '__fish_seen_subcommand_from policy' -a reject -d 'Reject one proposal (--reason sent to agent)'
complete -c opencode-oss -n '__fish_seen_subcommand_from provider' -a add -d 'Create a provider'
complete -c opencode-oss -n '__fish_seen_subcommand_from provider' -a attach -d 'Attach a provider to the sandbox'
complete -c opencode-oss -n '__fish_seen_subcommand_from provider' -a list -d 'List providers on the gateway'
complete -c opencode-oss -n '__fish_seen_subcommand_from provider' -a setup -d 'Set up a provider from a stored credential'
complete -c opencode-oss -n '__fish_seen_subcommand_from mcp' -a status -d 'Report MCP server readiness in the sandbox'
complete -c opencode-oss -n '__fish_seen_subcommand_from fish' -a install -d 'Install the fish plugin'
complete -c opencode-oss -n '__fish_seen_subcommand_from fish' -a uninstall -d 'Remove the fish plugin'

# Common options.
complete -c opencode-oss -l name -r -d 'Sandbox name'
complete -c opencode-oss -l image -r -d 'Sandbox image reference'
complete -c opencode-oss -l policy -r -F -d 'Policy YAML file'
complete -c opencode-oss -l provider -r -d 'Attach a provider at creation'
complete -c opencode-oss -l cpu -r -d 'CPU limit (for example 2, 500m)'
complete -c opencode-oss -l memory -r -d 'Memory limit (for example 4Gi)'
complete -c opencode-oss -l engine -r -a 'docker podman' -d 'Container engine'
complete -c opencode-oss -l gateway -r -d 'OpenShell gateway name'
complete -c opencode-oss -l workdir -r -d 'In-sandbox project directory'
complete -c opencode-oss -l env -r -d 'Non-secret KEY=VALUE, or host var for setup'
complete -c opencode-oss -l env-from -r -d 'Sandbox KEY from the caller environment (KEY or KEY=ENVVAR)'
complete -c opencode-oss -l allow-env -r -d 'Allow a credential-like --env key'
complete -c opencode-oss -l yes -d 'Skip the confirmation prompt'

# logs options.
complete -c opencode-oss -l tail -d 'Stream live logs'
complete -c opencode-oss -l since -r -d 'Only logs since this duration (5m, 1h)'
complete -c opencode-oss -l source -r -a 'gateway sandbox all' -d 'Log source'
complete -c opencode-oss -l level -r -a 'error warn info debug trace' -d 'Minimum log level'
complete -c opencode-oss -s n -l lines -r -d 'Number of log lines'

# policy options.
complete -c opencode-oss -l full -d 'Include the effective policy'
complete -c opencode-oss -l base -d 'Show the base policy'
complete -c opencode-oss -l global -d 'Use the gateway-global policy'
complete -c opencode-oss -l wait -d 'Wait for the change to apply'
complete -c opencode-oss -l reason -r -d 'Rejection reason for policy reject (sent to the agent)'

# provider options.
complete -c opencode-oss -l type -r -a 'opencode-anthropic opencode-openrouter opencode-deepseek opencode-synthetic opencode-openai opencode-opencode opencode-opencode-go opencode-zai-coding opencode-kimi-for-coding opencode-minimax-coding-plan opencode-nano-gpt opencode-xiaomi-token-plan-sgp' -d 'Provider profile type'
complete -c opencode-oss -l credential -r -d 'Credential key (add) or store slug (setup)'
complete -c opencode-oss -l config -r -d 'Provider config KEY=VALUE'
complete -c opencode-oss -l from-existing -d 'Read credentials from existing local state'
complete -c opencode-oss -l runtime-credentials -d 'Resolve credentials at runtime'
complete -c opencode-oss -l global-profile -d 'Use a platform-scoped profile'

# provider setup options.
complete -c opencode-oss -l from -r -a 'maki opencode' -d 'Credential store for provider setup'
complete -c opencode-oss -l file -r -F -d 'JSON credential file for provider setup'
complete -c opencode-oss -l field -r -d 'JSON field path (default: .api_key)'
complete -c opencode-oss -l profile -r -F -d 'Provider profile file for provider setup'
complete -c opencode-oss -l attach -d 'Attach the provider to the project sandbox'
complete -c opencode-oss -l no-attach -d 'Never attach, even interactively'

# run and session options.
complete -c opencode-oss -l model -r -d 'Model for sessions and run (provider/model)'
complete -c opencode-oss -s c -l continue -d 'Continue the most recent session'
complete -c opencode-oss -s r -l resume -r -d 'Continue a specific session id'
complete -c opencode-oss -l session-id -r -d 'Use session ID, creating it if missing'
complete -c opencode-oss -l timeout -r -d 'run: end OpenCode inside the sandbox after SECS seconds'
complete -c opencode-oss -l no-sync -d 'Skip collecting changes on exit'
complete -c opencode-oss -l discard -d 'Replace a parked workspace (upload refresh) or delete it (rm)'
complete -c opencode-oss -l idle-stop -r -d 'Stop the sandbox this long after the last session closes (0 disables)'

# image build options.
complete -c opencode-oss -l opencode-version -r -d 'OpenCode version build argument for image build'

# upload options.
complete -c opencode-oss -l no-git-ignore -d 'Upload everything, ignoring .gitignore'

complete -c opencode-oss -s h -l help -d 'Show usage'
