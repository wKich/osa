function opencode-oss --description 'Run OpenCode in an OpenShell sandbox'
    # Thin wrapper; resolution lives in functions/__oss_run.fish.
    __oss_run opencode-oss OPENCODE_OSS_BIN $argv
    return $status
end
