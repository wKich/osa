function __oss_run --description 'Resolve and run a *-oss helper (shared by maki-oss and opencode-oss)'
    # Usage: __oss_run COMMAND OVERRIDE_VAR [ARGS...]
    # Thin wrapper around bin/COMMAND. Resolution order:
    #   1. $OVERRIDE_VAR (explicit override, for example $MAKI_OSS_BIN)
    #   2. the source repository, when this file is symlinked from it
    #   3. COMMAND on PATH
    set -l cmd $argv[1]
    set -l override_var $argv[2]
    set -e argv[1..2]

    set -l bin
    if test -n "$override_var"
        set bin $$override_var
    end

    if test -z "$bin"
        set -l self (status --current-filename)
        if test -n "$self"
            set -l resolved (path resolve $self 2>/dev/null)
            set -l candidate (path resolve (path dirname $resolved)/../../bin/$cmd 2>/dev/null)
            if test -x "$candidate"
                set bin $candidate
            end
        end
    end

    if test -z "$bin"
        set bin (command -s $cmd)
    end

    if test -z "$bin"; or not test -x "$bin"
        echo "$cmd: cannot locate bin/$cmd; set $override_var to its path" >&2
        return 127
    end

    command $bin $argv
    return $status
end
