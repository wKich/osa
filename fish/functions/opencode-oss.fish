function opencode-oss --description 'Run OpenCode in an OpenShell sandbox'
    # Thin wrapper around bin/opencode-oss. Resolution order:
    #   1. $OPENCODE_OSS_BIN (explicit override)
    #   2. the source repository, when this function is symlinked from it
    #   3. opencode-oss on PATH
    set -l bin $OPENCODE_OSS_BIN

    if test -z "$bin"
        set -l self (status --current-filename)
        if test -n "$self"
            set -l resolved (path resolve $self 2>/dev/null)
            set -l candidate (path resolve (path dirname $resolved)/../../bin/opencode-oss 2>/dev/null)
            if test -x "$candidate"
                set bin $candidate
            end
        end
    end

    if test -z "$bin"
        set bin (command -s opencode-oss)
    end

    if test -z "$bin"; or not test -x "$bin"
        echo "opencode-oss: cannot locate bin/opencode-oss; set OPENCODE_OSS_BIN to its path" >&2
        return 127
    end

    command $bin $argv
    return $status
end
