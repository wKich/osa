function maki-oss --description 'Run Maki in an OpenShell sandbox'
    # Thin wrapper; resolution lives in functions/__oss_run.fish.
    __oss_run maki-oss MAKI_OSS_BIN $argv
    return $status
end
