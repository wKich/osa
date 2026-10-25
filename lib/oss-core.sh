# shellcheck shell=sh
#
# oss-core: the agent-neutral part of the OpenShell sandbox helpers.
#
# Sourced by a front-end in bin/ after it resolves $repo_root and sets its
# identity, defaults, and agent hooks; the front-end then calls
# oss_main "$@". Sourcing this file only defines functions and state
# variables: it runs nothing.
#
# POSIX sh. See docs/helper.md for the full reference.

# Exit-code convention.
EX_USAGE=1    # bad invocation
EX_DEP=2      # missing local dependency (openshell, engine, image, policy)
EX_GATEWAY=3  # gateway or sandbox operation failed

NL='
'

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

say() { printf '%s\n' "$*"; }

warn() { printf '%s: warning: %s\n' "$PROGRAM" "$*" >&2; }

err() { printf '%s: %s\n' "$PROGRAM" "$*" >&2; }

die_usage() {
    err "$1"
    printf "Run '%s help' for usage.\n" "$PROGRAM" >&2
    exit "$EX_USAGE"
}

die_dep() {
    err "$1"
    exit "$EX_DEP"
}

die_gateway() {
    err "$1"
    exit "$EX_GATEWAY"
}

# ---------------------------------------------------------------------------
# Defaults and configuration
# ---------------------------------------------------------------------------

DEFAULT_ENGINE=docker
DEFAULT_WORKDIR=/sandbox/project

config_image=
config_policy=
config_providers=
config_cpu=
config_memory=
config_sandbox_name=
config_engine=
config_gateway=
config_workdir=
config_model=
config_tui=
config_idle_stop=

# Parse the config file as data and print `key<TAB>value` lines. The parser
# accepts `key = "value"`, comments, and blank lines, and reports unknown
# keys; the file is never sourced, so it cannot execute code.
parse_config_file() { # FILE
    awk '
        BEGIN {
            known["image"] = 1
            known["policy"] = 1
            known["providers"] = 1
            known["cpu"] = 1
            known["memory"] = 1
            known["sandbox_name"] = 1
            known["engine"] = 1
            known["gateway"] = 1
            known["workdir"] = 1
            known["model"] = 1
            known["tui"] = 1
            known["idle_stop"] = 1
            errors = 0
        }
        function problem(message) {
            printf "%s:%d: %s\n", FILENAME, NR, message > "/dev/stderr"
            errors++
        }
        {
            line = $0
            sub(/[[:space:]]+$/, "", line)
            if (line == "" || line ~ /^[[:space:]]*#/) next
            eq = index(line, "=")
            if (eq == 0) { problem("expected: key = \"value\""); next }
            key = substr(line, 1, eq - 1)
            value = substr(line, eq + 1)
            gsub(/^[[:space:]]+/, "", key)
            gsub(/[[:space:]]+$/, "", key)
            gsub(/^[[:space:]]+/, "", value)
            if (key !~ /^[a-z][a-z0-9_]*$/) { problem("invalid key <" key ">"); next }
            if (!(key in known)) { problem("unknown key <" key ">"); next }
            if (value !~ /^"/) { problem("value for <" key "> must be a quoted string"); next }
            if (value !~ /^"([^"\\]|\\.)*"/) { problem("unterminated value for <" key ">"); next }
            match(value, /^"([^"\\]|\\.)*"/)
            quoted = substr(value, RSTART + 1, RLENGTH - 2)
            rest = substr(value, RLENGTH + 1)
            gsub(/^[[:space:]]+/, "", rest)
            if (rest != "" && rest !~ /^#/) { problem("unexpected text after value for <" key ">"); next }
            if (quoted ~ /\t/) { problem("tab characters are not supported in values"); next }
            gsub(/\\"/, "\"", quoted)
            gsub(/\\\\/, "\\", quoted)
            print key "\t" quoted
        }
        END { exit (errors > 0 ? 1 : 0) }
    ' "$1"
}

# Read the config file into the config_* variables.
# shellcheck disable=SC2034  # config_tui is read by the front-end
load_config() {
    config_image=
    config_policy=
    config_providers=
    config_cpu=
    config_memory=
    config_sandbox_name=
    config_engine=
    config_gateway=
    config_workdir=
    config_model=
    config_tui=
    config_idle_stop=
    if [ ! -f "$config_file" ]; then
        return 0
    fi
    config_tmp=${TMPDIR:-/tmp}/$OSS_TMP_PREFIX-config.$$
    if ! (umask 077 && parse_config_file "$config_file" >"$config_tmp"); then
        rm -f "$config_tmp"
        err "invalid configuration in $config_file"
        exit "$EX_USAGE"
    fi
    config_unknown=
    tab=$(printf '\t')
    while IFS="$tab" read -r key value; do
        case $key in
            image)        config_image=$value ;;
            policy)       config_policy=$value ;;
            providers)    config_providers=$value ;;
            cpu)          config_cpu=$value ;;
            memory)       config_memory=$value ;;
            sandbox_name) config_sandbox_name=$value ;;
            engine)       config_engine=$value ;;
            gateway)      config_gateway=$value ;;
            workdir)      config_workdir=$value ;;
            model)        config_model=$value ;;
            tui)          config_tui=$value ;;
            idle_stop)    config_idle_stop=$value ;;
            '') ;;
            *)
                config_unknown=$key
                break
                ;;
        esac
    done <"$config_tmp"
    rm -f "$config_tmp"
    if [ -n "$config_unknown" ]; then
        err "unknown key <$config_unknown> in $config_file"
        exit "$EX_USAGE"
    fi
}

# Prints the value of the front-end's <PREFIX>_KEY environment variable, or
# nothing. KEY is always a literal from this file, never user input, so the
# eval only ever expands a fixed variable name.
env_setting() { # KEY
    eval "printf '%s' \"\${${OSS_ENV_PREFIX}_$1:-}\""
}

# Precedence: flag > environment > config file > default.
resolve_setting() {
    if [ -n "$1" ]; then
        printf '%s' "$1"
    elif [ -n "$2" ]; then
        printf '%s' "$2"
    elif [ -n "$3" ]; then
        printf '%s' "$3"
    else
        printf '%s' "$4"
    fi
}

split_csv() {
    printf '%s\n' "$1" | tr ',' '\n' \
        | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' \
        | grep -v '^$' || true
}

providers_value() {
    if [ -n "$opt_providers" ]; then
        printf '%s' "$opt_providers"
    elif [ -n "$(env_setting PROVIDERS)" ]; then
        split_csv "$(env_setting PROVIDERS)"
    elif [ -n "$config_providers" ]; then
        split_csv "$config_providers"
    fi
}

resolved_image() {
    resolve_setting "$opt_image" "$(env_setting IMAGE)" "$config_image" "$DEFAULT_IMAGE"
}

resolved_policy() {
    policy_value=$(resolve_setting "$opt_policy" "$(env_setting POLICY)" "$config_policy" "$DEFAULT_POLICY")
    case $policy_value in
        /*) ;;
        *)
            # shellcheck disable=SC2154  # set by the front-end
            if [ ! -f "$policy_value" ] && [ -f "$repo_root/$policy_value" ]; then
                policy_value=$repo_root/$policy_value
            fi
            ;;
    esac
    printf '%s' "$policy_value"
}

resolved_engine() {
    resolve_setting "$opt_engine" "$(env_setting ENGINE)" "$config_engine" "$DEFAULT_ENGINE"
}

resolved_workdir() {
    resolve_setting "$opt_workdir" "$(env_setting WORKDIR)" "$config_workdir" "$DEFAULT_WORKDIR"
}

resolved_gateway() {
    resolve_setting "$opt_gateway" "$(env_setting GATEWAY)" "$config_gateway" ""
}

resolved_model() {
    resolve_setting "$opt_model" "$(env_setting MODEL)" "$config_model" ""
}

# Positive integer seconds, or empty for no limit. `run` validates it before
# any sandbox call so an invalid value never reaches the gateway.
resolved_timeout() {
    resolve_setting "$opt_timeout" "$(env_setting TIMEOUT)" "" ""
}

# Seconds after the last session closes before the sandbox is stopped. Accepts
# N, Ns, Nm, or Nh; 0 disables the idle stop. Anything else is a usage error
# naming the key, raised before any sandbox call.
resolved_idle_stop() {
    ris_value=$(resolve_setting "$opt_idle_stop" "$(env_setting IDLE_STOP)" "$config_idle_stop" 1h)
    ris_number=${ris_value%[smh]}
    ris_unit=${ris_value#"$ris_number"}
    case $ris_number in
        ''|*[!0-9]*)
            die_usage "invalid 'idle_stop' value <$ris_value>: use seconds, optionally with an s, m, or h suffix (0 disables)"
            ;;
    esac
    while :; do
        case $ris_number in
            0?*) ris_number=${ris_number#0} ;;
            *) break ;;
        esac
    done
    case $ris_unit in
        ''|s) ris_scale=1 ;;
        m) ris_scale=60 ;;
        h) ris_scale=3600 ;;
    esac
    printf '%s' "$((ris_number * ris_scale))"
}

resolved_name() {
    resolved_name_value=$(resolve_setting \
        "$opt_name" "$(env_setting SANDBOX_NAME)" "$config_sandbox_name" "$DEFAULT_NAME")
    case $resolved_name_value in
        *'{project}'*)
            resolved_name_value=$(printf '%s' "$resolved_name_value" \
                | sed "s/{project}/$project_name/g")
            ;;
    esac
    if [ -z "$resolved_name_value" ]; then
        die_usage "resolved sandbox name is empty; check sandbox_name/--name"
    fi
    printf '%s' "$resolved_name_value"
}

# ---------------------------------------------------------------------------
# Config writing
#
# The config file is still read as data (never sourced). A writer replaces
# only the targeted line, keeps every other line verbatim, validates the
# result with the same parser, and then atomically renames the temp file.
# ---------------------------------------------------------------------------

config_escape_value() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

config_set_value() { # KEY VALUE
    config_set_key=$1
    config_set_new=$2
    config_set_dir=$(dirname -- "$config_file")
    if [ ! -d "$config_set_dir" ]; then
        mkdir -p -- "$config_set_dir" \
            || die_dep "cannot create config directory: $config_set_dir"
    fi
    config_set_tmp=$config_file.$$
    config_set_escaped=$(config_escape_value "$config_set_new")
    if [ -f "$config_file" ]; then
        awk -v key="$config_set_key" -v value="$config_set_escaped" '
            BEGIN { done = 0 }
            {
                if (!done && $0 ~ "^[[:space:]]*" key "[[:space:]]*=") {
                    print key " = \"" value "\""
                    done = 1
                    next
                }
                print
            }
            END {
                if (!done) {
                    print key " = \"" value "\""
                }
            }
        ' "$config_file" >"$config_set_tmp" \
            || { rm -f "$config_set_tmp"; die_dep "failed to rewrite $config_file"; }
    else
        {
            printf '# %s configuration. See the repository %s.\n' "$PROGRAM" "$OSS_CONFIG_EXAMPLE"
            printf '%s = "%s"\n' "$config_set_key" "$config_set_escaped"
        } >"$config_set_tmp"
    fi
    if ! parse_config_file "$config_set_tmp" >/dev/null 2>&1; then
        rm -f "$config_set_tmp"
        die_usage "refusing to write invalid configuration to $config_file"
    fi
    mv -- "$config_set_tmp" "$config_file" \
        || { rm -f "$config_set_tmp"; die_dep "cannot replace $config_file"; }
}

# Adds NAME to the config `providers` list (deduplicated) and updates the
# in-memory value. Only provider instance names are stored, never credentials.
remember_provider() { # NAME
    remember_name=$1
    if [ -n "$config_providers" ]; then
        remember_found=0
        while IFS= read -r remember_existing; do
            if [ "$remember_existing" = "$remember_name" ]; then
                remember_found=1
                break
            fi
        done <<REMEMBER_LIST
$(split_csv "$config_providers")
REMEMBER_LIST
        if [ "$remember_found" -eq 1 ]; then
            return 0
        fi
        remember_list="$config_providers,$remember_name"
    else
        remember_list=$remember_name
    fi
    config_set_value providers "$remember_list"
    config_providers=$remember_list
}

# Sets the config `model` value and updates the in-memory value.
remember_model() { # MODEL
    config_set_value model "$1"
    config_model=$1
}

# ---------------------------------------------------------------------------
# OpenShell wrappers
# ---------------------------------------------------------------------------

os() {
    if [ -n "$gateway" ]; then
        openshell -g "$gateway" "$@"
    else
        openshell "$@"
    fi
}

require_openshell() {
    if ! command -v openshell >/dev/null 2>&1; then
        die_dep "openshell CLI not found on PATH; install it from https://github.com/NVIDIA/OpenShell"
    fi
}

run_gateway() {
    run_gateway_rc=0
    os "$@" || run_gateway_rc=$?
    if [ "$run_gateway_rc" -ne 0 ]; then
        err "openshell command failed (exit status $run_gateway_rc)"
        exit "$EX_GATEWAY"
    fi
}

sandbox_phase() {
    sandbox_json=''
    if ! sandbox_json=$(os sandbox list --output json); then
        die_gateway "cannot list sandboxes; is the gateway running? Try '$PROGRAM doctor'"
    fi
    if [ "$have_jq" -eq 1 ]; then
        printf '%s' "$sandbox_json" \
            | jq -r --arg n "$1" '[.sandboxes[]? | select(.name == $n) | .phase][0] // empty'
    else
        # Line-oriented fallback: allow no space after the colon, and take
        # the first phase after the target's name so a later sandbox on the
        # same line cannot supply it.
        printf '%s' "$sandbox_json" | awk -v target="$1" '
            {
                if (!found) {
                    rest = $0
                    at = index(rest, "\"name\": \"" target "\"")
                    if (at > 0) {
                        skip = length("\"name\": \"" target "\"")
                    } else {
                        at = index(rest, "\"name\":\"" target "\"")
                        skip = length("\"name\":\"" target "\"")
                    }
                    if (at == 0) next
                    found = 1
                    rest = substr(rest, at + skip)
                    if (index(rest, "\"phase\":") == 0) next
                    line = rest
                } else {
                    line = $0
                }
                if ((at = index(line, "\"phase\":")) == 0) next
                line = substr(line, at)
                sub(/^"phase":[ ]*"/, "", line)
                sub(/".*/, "", line)
                print line
                exit
            }
        '
    fi
}

require_sandbox() {
    require_sandbox_phase=$(sandbox_phase "$1")
    if [ -z "$require_sandbox_phase" ]; then
        err "sandbox '$1' not found; run '$PROGRAM up' first"
        exit "$EX_USAGE"
    fi
}

attached_providers() {
    attached_json=''
    if ! attached_json=$(os sandbox provider list "$1" --output json); then
        die_gateway "cannot list providers attached to '$1'"
    fi
    if [ "$have_jq" -eq 1 ]; then
        printf '%s' "$attached_json" | jq -r '.providers[]?.name'
    else
        # grep -o emits one "name" match per line, so providers sharing a
        # compact-JSON line are all returned (a greedy sed keeps only the last).
        printf '%s' "$attached_json" \
            | grep -o '"name":[[:space:]]*"[^"]*"' \
            | sed 's/^"name":[[:space:]]*"\([^"]*\)"$/\1/'
    fi
}

# ---------------------------------------------------------------------------
# Safety checks
# ---------------------------------------------------------------------------

# Enables the in-sandbox policy advisor so an agent that hits a denied network
# request can submit a proposal and wait for the human decision. Fail-soft: a
# gateway without the key must not abort the session, so this warns and returns
# rather than dying.
enable_policy_advisor() { # NAME
    advisor_name=$1
    if ! os settings set "$advisor_name" --key agent_policy_proposals_enabled --value true >/dev/null 2>&1; then
        warn "could not enable the policy advisor on '$advisor_name'; agents cannot request network access"
        return 1
    fi
    return 0
}

# Prints the number of pending network-rule proposals, or nothing when the
# gateway or `rule` subcommand is unavailable. Only the `Chunk:` lines count,
# so a formatted header or a "no chunks" body yields zero.
# shellcheck disable=SC2329  # called by sync_project_back
pending_proposals_count() { # NAME
    pc_name=$1
    pc_json=''
    pc_json=$(os rule get "$pc_name" --status pending 2>/dev/null) || return 0
    [ -n "$pc_json" ] || return 0
    pc_count=$(printf '%s\n' "$pc_json" | grep -c '^  Chunk: ' 2>/dev/null) || pc_count=0
    [ -n "$pc_count" ] || pc_count=0
    printf '%s' "$pc_count"
}

# Mirrors OpenShell's own heuristic: a credential-like key contains one of
# these underscore-separated segments (API_KEY and friends span two segments).
credential_like() {
    credential_upper=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')
    credential_hay="_${credential_upper}_"
    for credential_kw in TOKEN SECRET PASSWORD CREDENTIAL ACCESS_KEY SECRET_KEY API_KEY; do
        case $credential_hay in
            *"_${credential_kw}_"*) return 0 ;;
        esac
    done
    return 1
}

env_key_allowed() {
    saved_ifs=$IFS
    IFS=$NL
    set -f
    allowed=1
    # shellcheck disable=SC2086
    for env_allowed in $opt_allow_env; do
        if [ "$env_allowed" = "$1" ]; then
            allowed=0
            break
        fi
    done
    set +f
    IFS=$saved_ifs
    return "$allowed"
}

env_refusal() { # FLAG KEY
    err "refusing $1 $2: the name looks like a credential"
    err "  Sandbox environment variables are readable by the agent; use a provider instead:"
    err "    $PROGRAM provider add my-provider --type <profile> --from-existing"
    err "    $PROGRAM provider attach my-provider"
    err "  If this value is genuinely not secret, repeat the key with --allow-env $2"
    exit "$EX_USAGE"
}

check_env_hygiene() {
    saved_ifs=$IFS
    IFS=$NL
    set -f
    # shellcheck disable=SC2086
    for env_pair in $opt_envs; do
        if [ -z "$env_pair" ]; then
            continue
        fi
        case $env_pair in
            *=*) ;;
            *)
                set +f
                IFS=$saved_ifs
                die_usage "--env expects KEY=VALUE, got '$env_pair'"
                ;;
        esac
        env_key=${env_pair%%=*}
        case $env_key in
            [A-Za-z_][A-Za-z0-9_]*) ;;
            *)
                set +f
                IFS=$saved_ifs
                die_usage "--env key must match [A-Za-z_][A-Za-z0-9_]*; got '$env_key'"
                ;;
        esac
        if credential_like "$env_key" && ! env_key_allowed "$env_key"; then
            set +f
            IFS=$saved_ifs
            env_refusal --env "$env_key"
        fi
    done
    # shellcheck disable=SC2086
    for env_pair in $opt_env_froms; do
        if [ -z "$env_pair" ]; then
            continue
        fi
        case $env_pair in
            *=*) env_key=${env_pair%%=*} env_source=${env_pair#*=} ;;
            *) env_key=$env_pair env_source=$env_pair ;;
        esac
        for env_name in "$env_key" "$env_source"; do
            case $env_name in
                [A-Za-z_][A-Za-z0-9_]*) ;;
                *)
                    set +f
                    IFS=$saved_ifs
                    die_usage "--env-from expects KEY or KEY=ENVVAR with names matching [A-Za-z_][A-Za-z0-9_]*; got '$env_pair'"
                    ;;
            esac
        done
        if credential_like "$env_key" && ! env_key_allowed "$env_key"; then
            set +f
            IFS=$saved_ifs
            env_refusal --env-from "$env_key"
        fi
        if credential_like "$env_source" && ! env_key_allowed "$env_source"; then
            set +f
            IFS=$saved_ifs
            env_refusal --env-from "$env_source"
        fi
    done
    set +f
    IFS=$saved_ifs
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cmd_doctor() {
    [ "$#" -eq 0 ] || die_usage "doctor takes no arguments"

    if [ "$have_jq" -eq 0 ]; then
        warn "jq not found; falling back to grep-based parsing"
    fi

    doctor_status=0
    have_openshell=0
    engine_ok=0
    gateway_ok=0

    if command -v openshell >/dev/null 2>&1; then
        say "ok    openshell CLI: $(command -v openshell)"
        have_openshell=1
    else
        say "fail  openshell CLI: not found on PATH"
        doctor_status=$EX_DEP
    fi

    if [ "$have_openshell" -eq 1 ]; then
        gateway_json=''
        if gateway_json=$(os status --output json); then
            connected=''
            if [ "$have_jq" -eq 1 ]; then
                connected=$(printf '%s' "$gateway_json" | jq -r '.status // empty')
            else
                connected=$(printf '%s' "$gateway_json" \
                    | sed -n 's/.*"status":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
            fi
            if [ "$connected" = connected ]; then
                say "ok    gateway: connected"
                # shellcheck disable=SC2034  # read by the front-end's agent_doctor_extra
                gateway_ok=1
            else
                say "fail  gateway: not connected (status: ${connected:-unknown})"
                if [ "$doctor_status" -eq 0 ]; then
                    doctor_status=$EX_GATEWAY
                fi
            fi
        else
            say "fail  gateway: unreachable (openshell status failed)"
            if [ "$doctor_status" -eq 0 ]; then
                doctor_status=$EX_GATEWAY
            fi
        fi
    else
        say "skip  gateway: openshell CLI unavailable"
    fi

    doctor_engine=$(resolved_engine)
    if command -v "$doctor_engine" >/dev/null 2>&1; then
        if "$doctor_engine" version >/dev/null 2>&1; then
            say "ok    container engine: $doctor_engine ($(command -v "$doctor_engine"))"
            engine_ok=1
        else
            say "fail  container engine: $doctor_engine is installed but not running"
            doctor_status=$EX_DEP
        fi
    else
        say "fail  container engine: $doctor_engine not found on PATH"
        doctor_status=$EX_DEP
    fi

    doctor_image=$(resolved_image)
    if [ "$engine_ok" -eq 1 ] && "$doctor_engine" image inspect "$doctor_image" >/dev/null 2>&1; then
        say "ok    image: $doctor_image present"
    else
        say "fail  image: $doctor_image not found (build it: $PROGRAM image build)"
        doctor_status=$EX_DEP
    fi

    doctor_policy=$(resolved_policy)
    if [ -f "$doctor_policy" ]; then
        say "ok    policy file: $doctor_policy"
    else
        say "fail  policy file: $doctor_policy not found"
        doctor_status=$EX_DEP
    fi

    doctor_providers=$(providers_value)
    if [ "$have_openshell" -eq 0 ]; then
        say "skip  providers: openshell CLI unavailable"
    elif [ -z "$doctor_providers" ]; then
        say "ok    providers: none configured"
    else
        doctor_known=''
        if ! doctor_known=$(os provider list --names 2>/dev/null); then
            doctor_known=''
        fi
        doctor_missing=''
        saved_ifs=$IFS
        IFS=$NL
        set -f
        # shellcheck disable=SC2086
        for doctor_provider in $doctor_providers; do
            if [ -z "$doctor_provider" ]; then
                continue
            fi
            if ! printf '%s\n' "$doctor_known" | grep -Fqx -- "$doctor_provider"; then
                doctor_missing="$doctor_missing $doctor_provider"
            fi
        done
        set +f
        IFS=$saved_ifs
        if [ -n "$doctor_missing" ]; then
            say "fail  providers: not found:$doctor_missing"
            if [ "$doctor_status" -eq 0 ]; then
                doctor_status=$EX_GATEWAY
            fi
        else
            say "ok    providers: $(printf '%s' "$doctor_providers" | tr '\n' ' ')"
        fi
    fi

    agent_doctor_extra

    exit "$doctor_status"
}

cmd_up() {
    [ "$#" -eq 0 ] || die_usage "up takes no arguments"
    require_openshell
    image=$(resolved_image)
    policy=$(resolved_policy)
    if [ ! -f "$policy" ]; then
        die_dep "policy file not found: $policy (pass --policy or fix the config)"
    fi
    check_env_hygiene
    name=$(resolved_name)
    phase=$(sandbox_phase "$name")
    if [ -n "$phase" ]; then
        case $phase in
            Ready|Starting|Provisioning)
                say "Sandbox '$name' already exists (phase: $phase)."
                ;;
            *)
                say "Starting sandbox '$name' (phase: $phase)..."
                run_gateway sandbox start "$name"
                ;;
        esac
    else
        say "Creating sandbox '$name' from $image..."
        run_sandbox_create "$name"
    fi
    say "Sandbox '$name' is ready. Next: $PROGRAM upload ."
}

# Builds and runs `openshell sandbox create` for the resolved settings. The
# caller prints user-facing messages; this function prints nothing itself.
run_sandbox_create() { # NAME
    check_env_hygiene
    create_name=$1
    create_image=$(resolved_image)
    create_policy=$(resolved_policy)
    create_providers=$(providers_value)
    create_cpu=$(resolve_setting "$opt_cpu" "$(env_setting CPU)" "$config_cpu" "")
    create_memory=$(resolve_setting "$opt_memory" "$(env_setting MEMORY)" "$config_memory" "")
    set -- sandbox create --name "$create_name" --from "$create_image" --policy "$create_policy" --detach
    if [ -n "$create_cpu" ]; then
        set -- "$@" --cpu "$create_cpu"
    fi
    if [ -n "$create_memory" ]; then
        set -- "$@" --memory "$create_memory"
    fi
    if [ -n "$create_providers" ]; then
        saved_ifs=$IFS
        IFS=$NL
        set -f
        # shellcheck disable=SC2086
        for create_provider in $create_providers; do
            if [ -n "$create_provider" ]; then
                set -- "$@" --provider "$create_provider"
            fi
        done
        set +f
        IFS=$saved_ifs
    fi
    saved_ifs=$IFS
    IFS=$NL
    set -f
    # shellcheck disable=SC2086
    for env_pair in $opt_envs; do
        if [ -n "$env_pair" ]; then
            set -- "$@" --env "$env_pair"
        fi
    done
    # shellcheck disable=SC2086
    for env_pair in $opt_env_froms; do
        if [ -n "$env_pair" ]; then
            set -- "$@" --env-from "$env_pair"
        fi
    done
    set +f
    IFS=$saved_ifs
    if [ "$create_allow_fail" -eq 1 ]; then
        os "$@"
    else
        run_gateway "$@"
    fi
}

# ---------------------------------------------------------------------------
# Session ensure and safe sync
#
# The bare invocation, the agent session command, and `run` share
# ensure_project_sandbox: remembered providers drive creation and attachment,
# and the project is uploaded only when the sandbox is created. On exit the
# sandbox emits a patch against the baseline it started from; the host applies
# it only when its own safety check passes. The workdir is never downloaded
# over the project automatically.
# ---------------------------------------------------------------------------

note() { printf '%s\n' "$*" >&2; }

sandbox_git_dir() { # WORKDIR
    case $1 in
        /sandbox|/sandbox/*) printf '/sandbox/%s/git' "$OSS_STATE_NAME" ;;
        *) printf '%s/%s/git' "$(dirname -- "$1")" "$OSS_STATE_NAME" ;;
    esac
}

session_state_dir() { # NAME
    printf '%s/%s/sessions/%s' "$state_base" "$OSS_CONFIG_NAME" "$1"
}

# Sandbox-side scripts. Values arrive as positional arguments, so paths with
# spaces survive. Each prints only what the host consumes; the git directory
# is outside the worktree, so no `.git` ever enters the project or the patch.
# shellcheck disable=SC2016  # expanded by the sandbox shell, not this one
SANDBOX_INIT_SCRIPT='set -e
gitdir=$1 worktree=$2
export GIT_DIR=$gitdir GIT_WORK_TREE=$worktree
export GIT_AUTHOR_NAME='"$PROGRAM"' GIT_AUTHOR_EMAIL='"$PROGRAM"'@localhost
export GIT_COMMITTER_NAME='"$PROGRAM"' GIT_COMMITTER_EMAIL='"$PROGRAM"'@localhost
mkdir -p "$gitdir"
git init -q
git add -A
tree=$(git write-tree)
commit=$(git commit-tree "$tree" -m "'"$PROGRAM"' baseline")
git update-ref refs/'"$PROGRAM"'/base "$commit"
printf "%s\n" "$tree"'

# shellcheck disable=SC2016  # expanded by the sandbox shell, not this one
SANDBOX_PROBE_SCRIPT='set -e
export GIT_DIR=$1 GIT_WORK_TREE=$2
if git rev-parse -q --verify refs/'"$PROGRAM"'/base >/dev/null 2>&1; then
    git rev-parse "refs/'"$PROGRAM"'/base^{tree}"
else
    printf "missing\n"
fi'

# shellcheck disable=SC2016  # expanded by the sandbox shell, not this one
SANDBOX_COLLECT_SCRIPT='set -e
gitdir=$1 worktree=$2
export GIT_DIR=$gitdir GIT_WORK_TREE=$worktree
export GIT_AUTHOR_NAME='"$PROGRAM"' GIT_AUTHOR_EMAIL='"$PROGRAM"'@localhost
export GIT_COMMITTER_NAME='"$PROGRAM"' GIT_COMMITTER_EMAIL='"$PROGRAM"'@localhost
git add -A
tree=$(git write-tree)
commit=$(git commit-tree "$tree" -p refs/'"$PROGRAM"'/base -m "'"$PROGRAM"' result")
git update-ref refs/'"$PROGRAM"'/result "$commit"
git diff --binary --full-index refs/'"$PROGRAM"'/base refs/'"$PROGRAM"'/result'

# shortcut: paths containing tabs or newlines are not exported on the no-git
# fallback; upgrade to -z parsing and a NUL loop if such names matter.
# shellcheck disable=SC2016  # expanded by the sandbox shell, not this one
SANDBOX_MANIFEST_SCRIPT='set -e
export GIT_DIR=$1 GIT_WORK_TREE=$2
git diff --no-renames --name-status refs/'"$PROGRAM"'/base refs/'"$PROGRAM"'/result |
while IFS="	" read -r status path; do
    if hash=$(git rev-parse "refs/'"$PROGRAM"'/result:$path" 2>/dev/null); then
        :
    else
        hash=-
    fi
    printf "%s\t%s\t%s\n" "$status" "$hash" "$path"
done'

# shellcheck disable=SC2016  # expanded by the sandbox shell, not this one
SANDBOX_ADVANCE_SCRIPT='set -e
export GIT_DIR=$1
git update-ref refs/'"$PROGRAM"'/base refs/'"$PROGRAM"'/result'

sandbox_script() { # NAME WORKDIR SCRIPT
    ss_name=$1
    ss_workdir=$2
    ss_script=$3
    os sandbox exec -n "$ss_name" --no-login-shell --workdir "$ss_workdir" -- \
        sh -c "$ss_script" "$PROGRAM-git" "$(sandbox_git_dir "$ss_workdir")" "$ss_workdir"
}

# After a successful apply the sandbox holds the same tree as the host, so the
# baseline moves forward and a later session does not replay the same patch.
# shellcheck disable=SC2329  # reached through the sync exit path
advance_sandbox_baseline() {
    if ! sandbox_script "$sync_name" "$sync_workdir" "$SANDBOX_ADVANCE_SCRIPT" >/dev/null 2>&1; then
        warn "could not advance the sandbox baseline; a later session may report the sandbox stale"
    fi
}

read_baseline() { # FILE KEY
    sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n 1
}

# Records the host tree and the sandbox tree that were in sync at upload or
# after a clean apply. A clean filter (LFS) or a submodule hashes differently
# on each side, so comparing the two trees directly calls a fresh sandbox
# stale; each side is compared with its own earlier value instead.
write_synced_marker() { # STATE_DIR HOST_TREE SANDBOX_TREE
    [ -n "$2" ] && [ -n "$3" ] || return 0
    synced_tmp=$1/synced.$$
    if ! (
        umask 077
        printf 'host_tree=%s\nsandbox_tree=%s\n' "$2" "$3" >"$synced_tmp"
    ); then
        rm -f "$synced_tmp"
        return 0
    fi
    mv -- "$synced_tmp" "$1/synced" 2>/dev/null || rm -f "$synced_tmp"
}

# Records the host tree in the state directory. A clean repository uses HEAD;
# a dirty or untracked one gets a synthetic commit built from a temporary
# index, so the user's index, branch, and working tree are untouched.
capture_host_baseline() { # STATE_DIR
    bl_mode=plain
    bl_git=0
    bl_branch=
    bl_commit=
    bl_tree=
    bl_dirty=0
    bl_base=
    bl_ok=0
    command -v git >/dev/null 2>&1 || return 0
    git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
    bl_root=$(git rev-parse --show-toplevel 2>/dev/null) || return 0
    bl_pwd=$(pwd -P)
    # The upload sends $PWD, not the repository root, so a subdirectory is
    # treated as a plain project and uses the patch check instead.
    [ "$bl_root" = "$bl_pwd" ] || return 0
    git rev-parse -q --verify HEAD >/dev/null 2>&1 || return 0
    bl_branch=$(git symbolic-ref --short -q HEAD 2>/dev/null) || bl_branch=
    bl_commit=$(git rev-parse -q --verify HEAD) || return 0
    bl_tree=$(git rev-parse -q --verify "HEAD^{tree}") || return 0
    if [ -z "$(git status --porcelain)" ]; then
        bl_mode=clean
        bl_base=$bl_commit
    else
        bl_mode=dirty
        bl_dirty=1
        bl_index=$1/baseline.index
        rm -f "$bl_index"
        if ! GIT_INDEX_FILE=$bl_index git read-tree "$bl_commit" 2>/dev/null \
            || ! GIT_INDEX_FILE=$bl_index git add -A 2>/dev/null \
            || ! bl_tree=$(GIT_INDEX_FILE=$bl_index git write-tree 2>/dev/null) \
            || ! bl_base=$(GIT_INDEX_FILE=$bl_index \
                GIT_AUTHOR_NAME=$PROGRAM GIT_AUTHOR_EMAIL=$PROGRAM@localhost \
                GIT_COMMITTER_NAME=$PROGRAM GIT_COMMITTER_EMAIL=$PROGRAM@localhost \
                git commit-tree "$bl_tree" -p "$bl_commit" -m "$PROGRAM baseline $$" 2>/dev/null); then
            rm -f "$bl_index"
            bl_mode=plain
            bl_git=0
            bl_dirty=0
            bl_tree=
            bl_base=
            warn "cannot snapshot the working tree; this session will use the patch check"
            return 0
        fi
        rm -f "$bl_index"
    fi
    bl_git=1
    bl_ok=1
}

write_session_baseline() { # DIR NAME WORKDIR SANDBOX_TREE STALE UPLOAD
    write_tmp=$1/baseline.$$
    if ! (
        umask 077
        {
            printf 'sandbox=%s\n' "$2"
            printf 'workdir=%s\n' "$3"
            printf 'mode=%s\n' "$bl_mode"
            printf 'git=%s\n' "$bl_git"
            printf 'branch=%s\n' "$bl_branch"
            printf 'commit=%s\n' "$bl_commit"
            printf 'tree=%s\n' "$bl_tree"
            printf 'base=%s\n' "$bl_base"
            printf 'dirty=%s\n' "$bl_dirty"
            printf 'sandbox_tree=%s\n' "$4"
            printf 'stale=%s\n' "$5"
            printf 'upload=%s\n' "$6"
        } >"$write_tmp"
    ); then
        warn "cannot write the session baseline in $1"
        rm -f "$write_tmp"
        return 1
    fi
    mv -- "$write_tmp" "$1/baseline" || {
        rm -f "$write_tmp"
        warn "cannot write the session baseline in $1"
        return 1
    }
    return 0
}

# After a clean apply the host and sandbox moved together, so the recorded
# pair moves with them and the next session stays on the automatic path.
# shellcheck disable=SC2329  # reached through the sync exit path
refresh_synced_marker() {
    capture_host_baseline "$sync_state_dir"
    refresh_sandbox_tree=$(sandbox_script "$sync_name" "$sync_workdir" "$SANDBOX_PROBE_SCRIPT" 2>/dev/null) || refresh_sandbox_tree=
    if [ "$bl_ok" -eq 1 ] && [ -n "$refresh_sandbox_tree" ]; then
        write_synced_marker "$sync_state_dir" "$bl_tree" "$refresh_sandbox_tree"
    fi
}

# Captures the host baseline, records or reads the sandbox baseline, and marks
# the sandbox stale when the two trees differ. Runs before Maki attaches.
prepare_session_sync() { # NAME CREATED
    prepare_name=$1
    prepare_created=$2
    sync_name=$prepare_name
    sync_workdir=$(resolved_workdir)
    sync_state_dir=$(session_state_dir "$prepare_name")
    sync_pending_blocked=0
    sync_stale=0
    sync_upload=
    bl_mode=plain
    bl_git=0
    bl_branch=
    bl_commit=
    bl_tree=
    bl_dirty=0
    bl_base=
    bl_ok=0
    synced_host_tree=
    synced_sandbox_tree=
    if [ "$opt_no_sync" -eq 1 ]; then
        return 0
    fi
    if ! (umask 077 && mkdir -p "$sync_state_dir" && chmod 700 "$sync_state_dir" 2>/dev/null); then
        warn "cannot create session state directory $sync_state_dir; changes will stay in the sandbox"
        return 0
    fi
    if [ -f "$sync_state_dir/synced" ]; then
        synced_host_tree=$(read_baseline "$sync_state_dir/synced" host_tree)
        synced_sandbox_tree=$(read_baseline "$sync_state_dir/synced" sandbox_tree)
    fi
    if [ -f "$sync_state_dir/pending" ]; then
        sync_pending_blocked=1
        note "Pending sandbox changes from an earlier session: $(read_baseline "$sync_state_dir/pending" patch)"
        note "Automatic apply is off until they are applied or discarded; remove $sync_state_dir/pending afterwards."
    fi
    capture_host_baseline "$sync_state_dir"
    sync_sandbox_tree=
    sync_probe_ok=0
    if [ "$prepare_created" -eq 1 ]; then
        if sync_sandbox_tree=$(sandbox_script "$prepare_name" "$sync_workdir" "$SANDBOX_INIT_SCRIPT" 2>/dev/null); then
            sync_probe_ok=1
        fi
    else
        if sync_probe=$(sandbox_script "$prepare_name" "$sync_workdir" "$SANDBOX_PROBE_SCRIPT" 2>/dev/null); then
            sync_probe_ok=1
            if [ "$sync_probe" = missing ]; then
                note "Recording a sandbox baseline for '$prepare_name'; changes already in the sandbox are not exported."
                if sync_sandbox_tree=$(sandbox_script "$prepare_name" "$sync_workdir" "$SANDBOX_INIT_SCRIPT" 2>/dev/null); then
                    sync_probe_ok=1
                else
                    sync_probe_ok=0
                fi
            else
                sync_sandbox_tree=$sync_probe
            fi
        fi
    fi
    if [ "$sync_probe_ok" -eq 0 ]; then
        warn "cannot read or record the sandbox baseline; automatic apply is disabled for '$prepare_name'"
    fi
    if [ "$opt_no_git_ignore" -eq 0 ] && [ "$bl_ok" -eq 1 ]; then
        # Compare each side with the recorded pair, not with the other side:
        # filters and submodules hash differently on the host and the sandbox.
        if [ "$prepare_created" -eq 1 ]; then
            # A sandbox created by this run was uploaded from this tree.
            [ "$sync_probe_ok" -eq 1 ] || sync_stale=1
        elif [ -n "$synced_host_tree" ] && [ -n "$synced_sandbox_tree" ]; then
            if [ "$bl_tree" != "$synced_host_tree" ] \
                || [ "$sync_sandbox_tree" != "$synced_sandbox_tree" ]; then
                sync_stale=1
            fi
        elif [ -z "$sync_sandbox_tree" ] || [ "$bl_tree" != "$sync_sandbox_tree" ]; then
            # No recorded pair (state from an older version): keep the direct
            # tree comparison until an upload or clean apply records one.
            sync_stale=1
        fi
    fi
    if [ "$sync_stale" -eq 0 ] && [ "$sync_probe_ok" -eq 1 ] && [ "$bl_ok" -eq 1 ] \
        && [ "$opt_no_git_ignore" -eq 0 ] && [ -n "$sync_sandbox_tree" ]; then
        write_synced_marker "$sync_state_dir" "$bl_tree" "$sync_sandbox_tree"
    fi
    if [ "$sync_stale" -eq 1 ]; then
        note "Sandbox '$prepare_name' is stale: its baseline tree differs from the host."
        note "The patch will be kept for review instead of being applied. Refresh with '$PROGRAM upload'."
    fi
    if [ "$opt_no_git_ignore" -eq 1 ]; then
        note "Automatic worktree apply is off for --no-git-ignore uploads; the patch is applied with the plain check."
        sync_upload=unfiltered
    else
        sync_upload=filtered
    fi
    write_session_baseline "$sync_state_dir" "$prepare_name" "$sync_workdir" \
        "$sync_sandbox_tree" "$sync_stale" "$sync_upload" || true
}

session_armed=0
sync_finished=0

arm_sync() {
    session_armed=1
    trap 'sync_exit_hook' EXIT
}

# shellcheck disable=SC2329  # invoked via trap
sync_exit_hook() {
    sync_hook_rc=$?
    trap - EXIT
    if [ "$session_armed" -eq 1 ]; then
        session_armed=0
        sync_project_back
    fi
    exit "$sync_hook_rc"
}

# shellcheck disable=SC2329  # reached through the sync exit path
write_pending() { # PATCH REASON
    [ -n "${sync_state_dir:-}" ] || return 0
    (
        umask 077
        printf 'patch=%s\nsandbox=%s\ncreated=%s\nreason=%s\n' \
            "$1" "${sync_name:-}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" \
            >"$sync_state_dir/pending"
    ) || warn "cannot write the pending marker in $sync_state_dir"
}

# shellcheck disable=SC2329  # reached through the sync exit path
recovery_block() { # PATCH
    recovery_name=${sync_name:-$(resolved_name)}
    recovery_workdir=${sync_workdir:-$(resolved_workdir)}
    err "sandbox changes are not in the host project; the sandbox still holds them"
    err "  sandbox:   $recovery_name"
    err "  workspace: $recovery_workdir"
    err "  inspect:   openshell sandbox connect $recovery_name"
    err "  copy one:  $PROGRAM download $recovery_workdir/PATH ./DEST"
    if [ -n "${1:-}" ] && [ -f "$1" ]; then
        err "  patch:     $1"
    fi
    err "  pending:   ${sync_state_dir:-state}/pending (remove it after resolving)"
}

# shellcheck disable=SC2329  # reached through the sync exit path
collect_sandbox_patch() { # PATCH
    collect_patch=$1
    collect_err=$sync_state_dir/collect.err
    if ! (umask 077 && : >"$collect_patch"); then
        warn "cannot write the patch file $collect_patch"
        return 1
    fi
    if ! sandbox_script "$sync_name" "$sync_workdir" "$SANDBOX_COLLECT_SCRIPT" \
        >"$collect_patch" 2>"$collect_err"; then
        collect_detail=$(head -n 3 "$collect_err" 2>/dev/null) || collect_detail=
        rm -f "$collect_patch" "$collect_err"
        warn "could not collect sandbox changes${collect_detail:+: $collect_detail}"
        return 1
    fi
    rm -f "$collect_err"
    chmod 600 "$collect_patch" 2>/dev/null || true
    return 0
}

# Collects changes, applies them when the safety check passes, and leaves the
# patch and a pending marker otherwise. Always returns 0 so it cannot change
# Maki's exit code; output stays on stderr.
# shellcheck disable=SC2329  # invoked via trap and by sync_exit_hook
sync_project_back() {
    if [ "$sync_finished" -eq 1 ]; then
        return 0
    fi
    sync_finished=1
    if [ "$opt_no_sync" -eq 1 ]; then
        note "Skipped download (--no-sync); copy changes with '$PROGRAM download'."
        return 0
    fi
    sync_name=${sync_name:-$(resolved_name)}
    sync_workdir=${sync_workdir:-$(resolved_workdir)}
    sync_state_dir=${sync_state_dir:-$(session_state_dir "$sync_name")}
    sync_stamp=$(date +%Y%m%d%H%M%S)-$$
    patch_file=$sync_state_dir/patch-$sync_stamp.patch
    if ! collect_sandbox_patch "$patch_file"; then
        write_pending "" "collection failed"
        recovery_block "$patch_file"
        announce_pending_proposals "$sync_name"
        return 0
    fi
    if [ ! -s "$patch_file" ]; then
        rm -f "$patch_file"
        note "No sandbox changes to sync."
    else
        note "Collected sandbox changes: $patch_file"
        apply_rc=0
        apply_sandbox_patch "$patch_file" || apply_rc=$?
        if [ "$apply_rc" -eq 1 ]; then
            write_pending "$patch_file" "apply failed"
            recovery_block "$patch_file"
        elif [ "$apply_rc" -eq 2 ]; then
            recovery_block "$patch_file"
        fi
    fi
    announce_pending_proposals "$sync_name"
    return 0
}

# shellcheck disable=SC2329  # reached through the sync exit path
apply_sandbox_patch() { # PATCH
    apply_patch=$1
    apply_mode=$bl_mode
    apply_stale=$sync_stale
    apply_upload=${sync_upload:-}
    if [ "$sync_pending_blocked" -eq 1 ]; then
        note "A pending patch is unresolved; keeping this patch for review."
        write_pending "$apply_patch" "pending marker"
        return 2
    fi
    if [ "$apply_stale" = 1 ]; then
        note "The sandbox baseline is stale; keeping the patch for review."
        write_pending "$apply_patch" "stale sandbox"
        return 2
    fi
    if [ "$apply_upload" != unfiltered ] \
        && { [ "$apply_mode" = clean ] || [ "$apply_mode" = dirty ]; } \
        && command -v git >/dev/null 2>&1 \
        && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        worktree_apply "$apply_patch"
        return $?
    fi
    plain_apply "$apply_patch"
}

# shellcheck disable=SC2329  # reached through the sync exit path
apply_conflict_guidance() { # PATCH WORKTREE BRANCH
    note "The sandbox patch conflicts with the host; the host project was left unchanged."
    note "  patch:    $1"
    if [ -n "${2:-}" ]; then
        note "  worktree: $2 (branch '${3:-}', may need manual conflict resolution)"
    fi
    note "Resolve there and commit, then merge or cherry-pick the branch; or apply the patch directly."
}

# Applies the patch in a temporary worktree at the recorded baseline, commits
# the result on a temporary branch, and fast-forwards only a clean, unmoved
# host. A dirty or untracked baseline never fast-forwards.
# shellcheck disable=SC2329  # reached through the sync exit path
worktree_apply() { # PATCH
    wa_patch=$1
    wa_mode=$bl_mode
    wa_branch=$bl_branch
    wa_commit=$bl_commit
    wa_base=$bl_base
    wa_id=$(date +%Y%m%d%H%M%S)-$$
    wa_name="$PROGRAM/$sync_name-$wa_id"
    wa_wt=$sync_state_dir/worktrees/$wa_id
    if [ -z "$wa_base" ]; then
        warn "the session baseline has no commit; keeping the patch"
        return 1
    fi
    mkdir -p "$sync_state_dir/worktrees" || {
        warn "cannot create the worktree directory under $sync_state_dir"
        return 1
    }
    git worktree prune >/dev/null 2>&1 || true
    if ! git worktree add -b "$wa_name" "$wa_wt" "$wa_base" >&2; then
        warn "cannot create the review worktree at $wa_wt; keeping the patch"
        return 1
    fi
    wa_applied=0
    if git -C "$wa_wt" apply --check "$wa_patch" >&2; then
        if git -C "$wa_wt" apply "$wa_patch" >&2; then
            wa_applied=1
        fi
    elif git -C "$wa_wt" apply --3way "$wa_patch" >&2; then
        wa_applied=1
    fi
    if [ "$wa_applied" -eq 0 ]; then
        apply_conflict_guidance "$wa_patch" "$wa_wt" "$wa_name"
        write_pending "$wa_patch" "conflict"
        return 2
    fi
    git -C "$wa_wt" add -A >&2 || {
        warn "cannot stage the result in $wa_wt; the patch is kept"
        return 1
    }
    wa_tree=$(git -C "$wa_wt" write-tree) || {
        warn "cannot write the result tree in $wa_wt; the patch is kept"
        return 1
    }
    wa_result=$(GIT_AUTHOR_NAME=$PROGRAM GIT_AUTHOR_EMAIL=$PROGRAM@localhost \
        GIT_COMMITTER_NAME=$PROGRAM GIT_COMMITTER_EMAIL=$PROGRAM@localhost \
        git -C "$wa_wt" commit-tree "$wa_tree" -p "$wa_base" -m "$PROGRAM: apply sandbox changes") || {
        warn "cannot commit the result in $wa_wt; the patch is kept"
        return 1
    }
    if ! git -C "$wa_wt" update-ref HEAD "$wa_result" >&2; then
        warn "cannot commit the result in $wa_wt; the patch is kept"
        return 1
    fi
    if [ "$wa_mode" != clean ] || [ -z "$wa_branch" ]; then
        note "Sandbox changes committed on branch '$wa_name' (worktree: $wa_wt)."
        note "Uncommitted host work was not committed. Apply the agent changes with:"
        note "  git cherry-pick $wa_result"
        note "If cherry-pick refuses because a changed path is untracked, run: git add -N <path>"
        note "Or apply the patch directly: git apply '$wa_patch'"
        advance_sandbox_baseline
        write_pending "$wa_patch" "dirty baseline"
        return 2
    fi
    wa_now_branch=$(git symbolic-ref --short -q HEAD 2>/dev/null) || wa_now_branch=
    wa_now_head=$(git rev-parse -q --verify HEAD 2>/dev/null) || wa_now_head=
    wa_now_dirty=$(git status --porcelain)
    if [ "$wa_now_branch" != "$wa_branch" ] || [ "$wa_now_head" != "$wa_commit" ] || [ -n "$wa_now_dirty" ]; then
        note "The host moved or has uncommitted changes; it was not fast-forwarded."
        note "  branch:   $wa_name (worktree: $wa_wt)"
        note "  review:   git -C '$wa_wt' show $wa_result"
        note "  merge:    git merge $wa_name"
        note "  patch:    $wa_patch"
        advance_sandbox_baseline
        write_pending "$wa_patch" "host moved"
        return 2
    fi
    if ! git merge --ff-only "$wa_result" >&2; then
        warn "fast-forward failed; branch '$wa_name' and worktree '$wa_wt' are kept"
        write_pending "$wa_patch" "fast-forward failed"
        return 2
    fi
    git worktree remove "$wa_wt" >/dev/null 2>&1 || true
    git branch -d "$wa_name" >/dev/null 2>&1 || true
    advance_sandbox_baseline
    refresh_synced_marker
    rm -f "$sync_state_dir/pending"
    note "Applied sandbox changes to branch '$wa_branch'."
    return 0
}

# Applies the patch in place after `git apply --check`, or with `patch` when
# the host has no git. A failed check leaves every file untouched.
# shellcheck disable=SC2329  # reached through the sync exit path
plain_apply() { # PATCH
    plain_patch=$1
    if command -v git >/dev/null 2>&1; then
        if ! git apply --check "$plain_patch" >&2; then
            note "The sandbox patch does not apply cleanly; $PWD was left unchanged."
            note "  patch:  $plain_patch"
            note "  review: git apply --3way '$plain_patch'"
            write_pending "$plain_patch" "conflict"
            return 2
        fi
        if ! git apply "$plain_patch" >&2; then
            warn "applying the sandbox patch failed; $PWD was left unchanged"
            return 1
        fi
        advance_sandbox_baseline
        rm -f "$sync_state_dir/pending"
        note "Applied sandbox changes to $PWD."
        return 0
    fi
    if grep -Eq '^(GIT binary patch|Binary files .* differ)$' "$plain_patch"; then
        export_review_files "$plain_patch"
        return $?
    fi
    if ! command -v patch >/dev/null 2>&1; then
        warn "neither git nor patch is available on the host; keeping the patch"
        return 1
    fi
    if ! patch -p1 --dry-run --forward <"$plain_patch" >&2; then
        note "The sandbox patch does not apply cleanly; $PWD was left unchanged."
        note "  patch:  $plain_patch"
        note "  review: patch -p1 < '$plain_patch'"
        write_pending "$plain_patch" "conflict"
        return 2
    fi
    if ! patch -p1 --forward <"$plain_patch" >&2; then
        warn "applying the sandbox patch failed; $PWD was left unchanged"
        return 1
    fi
    advance_sandbox_baseline
    rm -f "$sync_state_dir/pending"
    note "Applied sandbox changes to $PWD."
    return 0
}

# No-git binary fallback: the sandbox reports changed paths and hashes, and
# only those files are copied into a review directory outside the project.
# shellcheck disable=SC2329  # reached through the sync exit path
export_review_files() { # PATCH
    export_patch=$1
    export_dir=$sync_state_dir/review-$sync_stamp
    export_manifest=$export_dir/manifest
    if ! mkdir -p "$export_dir"; then
        warn "cannot create the review directory $export_dir"
        return 1
    fi
    if ! sandbox_script "$sync_name" "$sync_workdir" "$SANDBOX_MANIFEST_SCRIPT" \
        >"$export_manifest" 2>/dev/null; then
        warn "cannot read the changed-file manifest from the sandbox"
        rm -rf "$export_dir"
        return 1
    fi
    chmod 600 "$export_manifest" 2>/dev/null || true
    export_failed=0
    while IFS=$TAB read -r export_status _ export_path; do
        [ -n "$export_path" ] || continue
        case $export_path in
            /*|..|../*|*/..|*/../*)
                warn "refusing unexpected path in the sandbox manifest: $export_path"
                export_failed=1
                break
                ;;
        esac
        case $export_status in
            D*) continue ;;
        esac
        export_dest=$export_dir/files/$export_path
        if ! mkdir -p "$(dirname -- "$export_dest")" \
            || ! os sandbox download "$sync_name" "$sync_workdir/$export_path" "$export_dest" >&2; then
            export_failed=1
            break
        fi
    done <"$export_manifest"
    if [ "$export_failed" -eq 1 ]; then
        warn "could not export every changed file; the project was left unchanged"
        return 1
    fi
    note "The host has no git; changed files were exported for review: $export_dir"
    note "  manifest: $export_manifest"
    write_pending "$export_patch" "binary export"
    return 2
}

# After a session, surface any network-rule proposals the agent filed so a
# denial never disappears silently. Fail-soft: the count or the `rule`
# subcommand may be unavailable, and that must not mask Maki's exit code.
# shellcheck disable=SC2329  # called by sync_project_back
announce_pending_proposals() { # NAME
    app_name=$1
    app_count=''
    app_count=$(pending_proposals_count "$app_name" 2>/dev/null) || app_count=''
    case $app_count in
        ''|0) return 0 ;;
    esac
    note "$app_count pending network-rule proposal(s) for '$app_name'. Review: $PROGRAM policy review"
    return 0
}

# Fails before any sandbox mutation when no provider is remembered; on a TTY
# it runs the provider setup wizard inline and continues.
ensure_provider_list() {
    ensure_known_providers=$(providers_value)
    if [ -z "$ensure_known_providers" ] && is_interactive; then
        say "No provider is configured yet; starting provider setup."
        cmd_provider_setup
        load_config
        ensure_known_providers=$(providers_value)
    fi
    if [ -z "$ensure_known_providers" ]; then
        err "no provider is configured; run '$PROGRAM provider setup' first"
        exit "$EX_USAGE"
    fi
    ensure_gateway_providers=''
    if ! ensure_gateway_providers=$(os provider list --names 2>/dev/null); then
        die_gateway "cannot list providers; is the gateway running? Try '$PROGRAM doctor'"
    fi
    saved_ifs=$IFS
    IFS=$NL
    set -f
    # shellcheck disable=SC2086
    for ensure_provider in $ensure_known_providers; do
        if [ -z "$ensure_provider" ]; then
            continue
        fi
        if ! printf '%s\n' "$ensure_gateway_providers" | grep -Fqx -- "$ensure_provider"; then
            set +f
            IFS=$saved_ifs
            err "provider '$ensure_provider' is not known to the gateway; run '$PROGRAM provider setup'"
            exit "$EX_USAGE"
        fi
    done
    set +f
    IFS=$saved_ifs
}

wait_for_sandbox_ready() { # NAME
    wait_phase=$(sandbox_phase "$1")
    wait_attempts=0
    while [ "$wait_phase" != Ready ]; do
        case $wait_phase in
            Starting|Provisioning) ;;
            '')
                die_gateway "sandbox '$1' disappeared while waiting for readiness"
                ;;
            *)
                die_gateway "sandbox '$1' is in phase '$wait_phase'; run '$PROGRAM status' and '$PROGRAM logs' to investigate"
                ;;
        esac
        wait_attempts=$((wait_attempts + 1))
        if [ "$wait_attempts" -gt 60 ]; then
            die_gateway "sandbox '$1' is still '$wait_phase' after 120 seconds"
        fi
        sleep 2
        wait_phase=$(sandbox_phase "$1")
    done
}

ensure_attach_missing() { # NAME
    ensure_attach_providers=$(providers_value)
    [ -n "$ensure_attach_providers" ] || return 0
    ensure_attached=$(attached_providers "$1")
    saved_ifs=$IFS
    IFS=$NL
    set -f
    # shellcheck disable=SC2086
    for ensure_provider in $ensure_attach_providers; do
        if [ -z "$ensure_provider" ]; then
            continue
        fi
        if ! printf '%s\n' "$ensure_attached" | grep -Fqx -- "$ensure_provider"; then
            note "Attaching provider '$ensure_provider'..."
            run_gateway sandbox provider attach "$1" "$ensure_provider" --wait
        fi
    done
    set +f
    IFS=$saved_ifs
}

ensure_sandbox_created=0
# Set to 1 around `sandbox create` so a lost race (the name already exists)
# returns control instead of exiting; the caller re-checks and reuses.
create_allow_fail=0

# A reused sandbox still holds an earlier copy of the project. The exit sync
# no longer overlays it: changes come back as a patch that is applied only
# when the sandbox baseline matches the host.
announce_sandbox_reuse() { # NAME
    note "Reusing '$1' without uploading; on exit, changes are collected as a patch and applied only if its baseline matches the host."
}

ensure_project_sandbox() {
    ensure_provider_list
    name=$(resolved_name)
    phase=$(sandbox_phase "$name")
    if [ -n "$phase" ]; then
        announce_sandbox_reuse "$name"
        case $phase in
            Ready)
                note "Reusing sandbox '$name'."
                ;;
            Stopped|Completed|Error)
                note "Starting sandbox '$name' (phase: $phase)..."
                run_gateway sandbox start "$name"
                wait_for_sandbox_ready "$name"
                ;;
            *)
                note "Waiting for sandbox '$name' (phase: $phase)..."
                wait_for_sandbox_ready "$name"
                ;;
        esac
    else
        ensure_policy=$(resolved_policy)
        if [ ! -f "$ensure_policy" ]; then
            die_dep "policy file not found: $ensure_policy (pass --policy or fix the config)"
        fi
        note "Creating sandbox '$name'..."
        create_rc=0
        create_allow_fail=1
        run_sandbox_create "$name" || create_rc=$?
        create_allow_fail=0
        if [ "$create_rc" -ne 0 ]; then
            # Another run may have won the race; its sandbox is the same
            # project directory, so reuse beats a hard gateway failure.
            phase=$(sandbox_phase "$name")
            if [ -z "$phase" ]; then
                err "openshell sandbox create failed (exit status $create_rc)"
                exit "$EX_GATEWAY"
            fi
            announce_sandbox_reuse "$name"
            note "Sandbox '$name' was created by a concurrent run (phase: $phase); reusing it."
        else
            ensure_sandbox_created=1
        fi
        wait_for_sandbox_ready "$name"
    fi
    if [ "$ensure_sandbox_created" -eq 1 ]; then
        workdir=$(resolved_workdir)
        note "Uploading the project to '$name:$workdir'..."
        set -- sandbox upload
        if [ "$opt_no_git_ignore" -eq 1 ]; then
            set -- "$@" --no-git-ignore
        fi
        set -- "$@" "$name" . "$workdir"
        run_gateway "$@"
    fi
    # Enable the advisor before Maki attaches so the agent can submit a
    # network-rule proposal and wait for a human decision. Covers both the
    # created and reused paths; `up` never reaches this function.
    enable_policy_advisor "$name" || true
    prepare_session_sync "$name" "$ensure_sandbox_created"
    ensure_attach_missing "$name"
}

# ---------------------------------------------------------------------------
# Session idle stop
#
# A session spawns a detached watcher before the sandbox ensure. The watcher
# waits for the helper process to exit however it ends (a closed terminal
# skips the EXIT trap), stamps the close, sleeps the idle period, and stops
# the sandbox only when its stamp is still the latest and no agent process
# runs inside. Every session start and close rewrites the stamp, so the last
# one owns the clock. The watcher has no terminal: decisions go to idle.log.
# ---------------------------------------------------------------------------

IDLE_POLL_SECS=2

# Prints `busy` when a process named $OSS_AGENT_PROCESS runs in the sandbox,
# else `idle`.
# comm, not cmdline, so the scan never matches its own `sh -c`.
# shellcheck disable=SC2016  # expanded by the sandbox shell, not this one
IDLE_SCAN_SCRIPT='for f in /proc/[0-9]*/comm; do
    c=
    { read -r c <"$f"; } 2>/dev/null || continue
    if [ "$c" = '"$OSS_AGENT_PROCESS"' ]; then printf "busy\n"; exit 0; fi
done
printf "idle\n"'

idle_token() {
    printf '%s.%s' "$(date +%s)" "$1"
}

write_idle_stamp() { # DIR TOKEN
    printf '%s\n' "$2" >"$1/idle.$$"
    mv -f "$1/idle.$$" "$1/idle"
}

read_idle_stamp() { # DIR
    cat "$1/idle" 2>/dev/null || true
}

idle_log() { # DIR EVENT
    printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$2" >>"$1/idle.log" 2>/dev/null || true
}

# Writes the start stamp and spawns the watcher for this helper process.
# SECS 0 disables it: no stamp, no watcher.
arm_idle_stop() { # SECS
    ais_secs=$1
    [ "$ais_secs" -gt 0 ] || return 0
    ais_name=$(resolved_name)
    ais_dir=$(session_state_dir "$ais_name")
    mkdir -p "$ais_dir"
    write_idle_stamp "$ais_dir" "$(idle_token "$$")"
    # shellcheck disable=SC2154  # set by the front-end
    set -- "$script_dir/${script##*/}" __idle-watch "$ais_name" "$$" "$ais_secs"
    if [ -n "$gateway" ]; then
        set -- "$@" --gateway "$gateway"
    fi
    nohup "$@" </dev/null >/dev/null 2>&1 &
    idle_log "$ais_dir" "armed secs=$ais_secs session=$$ watcher=$!"
}

cmd_idle_watch() { # NAME PID SECS
    [ "$#" -eq 3 ] || die_usage "usage: $PROGRAM __idle-watch NAME PID SECS"
    iw_name=$1
    iw_pid=$2
    iw_secs=$3
    iw_dir=$(session_state_dir "$iw_name")
    while kill -0 "$iw_pid" 2>/dev/null; do
        sleep "$IDLE_POLL_SECS"
    done
    iw_token=$(idle_token "$$")
    write_idle_stamp "$iw_dir" "$iw_token"
    idle_log "$iw_dir" "closed session=$iw_pid"
    sleep "$iw_secs"
    if [ "$(read_idle_stamp "$iw_dir")" != "$iw_token" ]; then
        idle_log "$iw_dir" "superseded session=$iw_pid"
        return 0
    fi
    iw_scan=$(os sandbox exec -n "$iw_name" --no-login-shell -- \
        sh -c "$IDLE_SCAN_SCRIPT" "$PROGRAM-idle" 2>/dev/null) || iw_scan=
    case $iw_scan in
        idle) ;;
        busy)
            idle_log "$iw_dir" "busy session=$iw_pid"
            return 0
            ;;
        *)
            idle_log "$iw_dir" "scan-failed session=$iw_pid"
            return 0
            ;;
    esac
    if os sandbox stop "$iw_name" >/dev/null 2>&1; then
        idle_log "$iw_dir" "stopped session=$iw_pid"
    else
        idle_log "$iw_dir" "stop-failed session=$iw_pid"
    fi
}

# Agent argv. A hook adds words with argv_add; the core expands the list with
# eval "set -- $agent_argv". Each word is single-quoted by parameter expansion
# alone (no subshell), so quotes and trailing newlines in a prompt survive.
agent_argv=

argv_add() { # WORD...
    for argv_word in "$@"; do
        argv_rest=$argv_word
        argv_quoted=
        while :; do
            case $argv_rest in
                *\'*)
                    argv_head=${argv_rest%%\'*}
                    argv_quoted="$argv_quoted$argv_head'\\''"
                    argv_rest=${argv_rest#*\'}
                    ;;
                *)
                    argv_quoted=$argv_quoted$argv_rest
                    break
                    ;;
            esac
        done
        agent_argv="$agent_argv '$argv_quoted'"
    done
}

# Interactive session: the bare invocation, and the front-end's session
# command, attach the agent on the TTY inside the ensured sandbox.
# shellcheck disable=SC2120  # "$@" is the agent argv, set inside
cmd_session() {
    session_idle_stop=$(resolved_idle_stop)
    agent_check_session_flags interactive
    require_openshell
    arm_idle_stop "$session_idle_stop"
    ensure_project_sandbox
    name=$(resolved_name)
    workdir=$(resolved_workdir)
    model=$(resolved_model)
    arm_sync
    session_interrupted=0
    trap 'session_interrupted=1' INT TERM
    session_rc=0
    agent_argv=
    agent_interactive_argv
    eval "set -- $agent_argv"
    os sandbox exec -n "$name" --tty --workdir "$workdir" -- "$@" || session_rc=$?
    trap - INT TERM
    if [ "$session_interrupted" -eq 1 ] && [ "$session_rc" -eq 0 ]; then
        session_rc=130
    fi
    exit "$session_rc"
}

# In-sandbox wrapper for `run --timeout`: $1 tag, $2 seconds, then the
# command. The shell's own environment predates the export, and the tag is
# unset before the sweep, so the sweep never matches itself. A caller stops
# the run early by creating /tmp/<tmp prefix>-stop/<tag>: only this shell can
# read its children's environment (each `sandbox exec` is its own isolation
# domain), so the stop has to happen here.
# shellcheck disable=SC2016  # expanded by the sandbox shell, not this one
RUN_TIMEOUT_WRAPPER='tag=$1; secs=$2; shift 2
stop=/tmp/'"$OSS_TMP_PREFIX"'-stop/$tag
rm -f "$stop"
export '"$OSS_ENV_PREFIX"'_RUN_TAG="$tag"
timeout --kill-after=10 "$secs" "$@" &
child=$!
while kill -0 "$child" 2>/dev/null; do
    if [ -e "$stop" ]; then kill -TERM "$child" 2>/dev/null; break; fi
    sleep 1
done
wait "$child"
rc=$?
unset '"$OSS_ENV_PREFIX"'_RUN_TAG
for d in /proc/[0-9]*; do
    if grep -qzx "'"$OSS_ENV_PREFIX"'_RUN_TAG=$tag" "$d/environ" 2>/dev/null; then
        kill -KILL "${d#/proc/}" 2>/dev/null
    fi
done
rm -f "$stop"
exit "$rc"'

cmd_run() {
    [ "$#" -ge 1 ] || die_usage "usage: $PROGRAM run \"<prompt>\" [--model provider/model]"
    run_timeout=$(resolved_timeout)
    case $run_timeout in
        '') ;;
        *[!0-9]*|0*) die_usage "--timeout must be a positive number of seconds, got '$run_timeout'" ;;
    esac
    run_tag_env=$(env_setting RUN_TAG)
    case $run_tag_env in
        *[!A-Za-z0-9._-]*) die_usage "${OSS_ENV_PREFIX}_RUN_TAG may only contain letters, digits, '.', '_', and '-'" ;;
    esac
    session_idle_stop=$(resolved_idle_stop)
    agent_check_session_flags headless
    require_openshell
    arm_idle_stop "$session_idle_stop"
    # Ensure messages go to stderr so stdout carries only the agent's output.
    ensure_project_sandbox >&2
    name=$(resolved_name)
    workdir=$(resolved_workdir)
    # shellcheck disable=SC2034  # read by the front-end's argv hooks
    model=$(resolved_model)
    prompt=$*
    arm_sync
    session_interrupted=0
    trap 'session_interrupted=1' INT TERM
    run_rc=0
    agent_argv=
    agent_headless_argv "$prompt"
    eval "set -- $agent_argv"
    # The limit is enforced inside the sandbox: neither the gateway's exec
    # --timeout nor killing the exec client stops the remote process
    # (OpenShell 0.1.5). GNU timeout ends the agent, but its tool commands run
    # in their own sessions and outlive it, so every process that inherited
    # the run's tag is killed afterwards. The tag is not a secret and is
    # exported inside the sandbox, never passed with --env.
    if [ -n "$run_timeout" ]; then
        # A caller may choose the tag (<PREFIX>_RUN_TAG) to stop the run
        # early through the wrapper's stop file.
        run_tag=${run_tag_env:-$PROGRAM-$$-$(date +%s)}
        set -- sh -c "$RUN_TIMEOUT_WRAPPER" "$PROGRAM-run" "$run_tag" "$run_timeout" "$@"
    fi
    case $(agent_exec_stdin) in
        null)
            os sandbox exec -n "$name" --no-login-shell --workdir "$workdir" -- "$@" \
                </dev/null || run_rc=$?
            ;;
        *)
            os sandbox exec -n "$name" --no-login-shell --workdir "$workdir" -- "$@" || run_rc=$?
            ;;
    esac
    trap - INT TERM
    if [ "$session_interrupted" -eq 1 ] && [ "$run_rc" -eq 0 ]; then
        run_rc=130
    fi
    exit "$run_rc"
}

cmd_upload() {
    [ "$#" -le 2 ] || die_usage "usage: $PROGRAM upload [LOCAL_PATH] [SANDBOX_DEST]"
    require_openshell
    name=$(resolved_name)
    require_sandbox "$name"
    src=${1:-.}
    dest=${2:-$(resolved_workdir)}
    set -- sandbox upload
    if [ "$opt_no_git_ignore" -eq 1 ]; then
        set -- "$@" --no-git-ignore
    fi
    set -- "$@" "$name" "$src" "$dest"
    run_gateway "$@"
    say "Uploaded '$src' to '$name:$dest'."
    if [ "$dest" = "$(resolved_workdir)" ]; then
        upload_state=$(session_state_dir "$name")
        if (umask 077 && mkdir -p "$upload_state" && chmod 700 "$upload_state" 2>/dev/null); then
            if upload_sandbox_tree=$(sandbox_script "$name" "$dest" "$SANDBOX_INIT_SCRIPT" 2>/dev/null); then
                # The user explicitly refreshed the sandbox, so any earlier
                # pending patch no longer blocks automatic apply.
                rm -f "$upload_state/pending"
                note "Recorded a new sandbox baseline for '$name'."
                capture_host_baseline "$upload_state"
                if [ "$bl_ok" -eq 1 ] && [ "$opt_no_git_ignore" -eq 0 ]; then
                    write_synced_marker "$upload_state" "$bl_tree" "$upload_sandbox_tree"
                fi
            else
                warn "uploaded, but could not record the sandbox baseline for '$name'"
            fi
        else
            warn "uploaded, but cannot create the session state directory $upload_state"
        fi
    fi
}

cmd_download() {
    if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
        die_usage "usage: $PROGRAM download [SANDBOX_PATH] DEST"
    fi
    require_openshell
    name=$(resolved_name)
    require_sandbox "$name"
    if [ "$#" -eq 1 ]; then
        spath=$(resolved_workdir)
        dest=$1
    else
        spath=$1
        dest=$2
    fi
    run_gateway sandbox download "$name" "$spath" "$dest"
    say "Downloaded '$name:$spath' to '$dest'."
}

cmd_status() {
    [ "$#" -eq 0 ] || die_usage "status takes no arguments"
    require_openshell
    name=$(resolved_name)
    phase=$(sandbox_phase "$name")
    if [ -z "$phase" ]; then
        say "Sandbox:   $name"
        say "Exists:    no"
        exit "$EX_USAGE"
    fi
    image=$(resolved_image)
    providers=$(attached_providers "$name")
    providers=$(printf '%s' "$providers" | paste -sd',' -)
    say "Sandbox:   $name"
    say "Exists:    yes"
    say "Phase:     $phase"
    say "Image:     $image (configured)"
    say "Providers: ${providers:-none}"
}

cmd_list() {
    [ "$#" -eq 0 ] || die_usage "list takes no arguments"
    require_openshell
    run_gateway sandbox list
}

cmd_logs() {
    [ "$#" -eq 0 ] || die_usage "logs takes no arguments"
    require_openshell
    name=$(resolved_name)
    set -- logs "$name"
    if [ "$opt_tail" -eq 1 ]; then
        set -- "$@" --tail
    fi
    if [ -n "$opt_since" ]; then
        set -- "$@" --since "$opt_since"
    fi
    if [ -n "$opt_source" ]; then
        set -- "$@" --source "$opt_source"
    fi
    if [ -n "$opt_level" ]; then
        set -- "$@" --level "$opt_level"
    fi
    if [ -n "$opt_lines" ]; then
        set -- "$@" -n "$opt_lines"
    fi
    run_gateway "$@"
}

cmd_start() {
    [ "$#" -eq 0 ] || die_usage "start takes no arguments"
    require_openshell
    name=$(resolved_name)
    run_gateway sandbox start "$name"
    say "Sandbox '$name' started."
}

cmd_stop() {
    [ "$#" -eq 0 ] || die_usage "stop takes no arguments"
    require_openshell
    name=$(resolved_name)
    run_gateway sandbox stop "$name"
    say "Sandbox '$name' stopped."
}

cmd_rm() {
    [ "$#" -eq 0 ] || die_usage "rm takes no arguments"
    require_openshell
    name=$(resolved_name)
    phase=$(sandbox_phase "$name")
    if [ -z "$phase" ]; then
        err "sandbox '$name' not found"
        exit "$EX_USAGE"
    fi
    if [ "$opt_yes" -eq 0 ]; then
        if [ -t 0 ]; then
            printf "Delete sandbox '%s'? [y/N] " "$name"
            read -r answer || answer=
            case $answer in
                y|Y|yes|YES) ;;
                *)
                    say "Aborted."
                    exit "$EX_USAGE"
                    ;;
            esac
        else
            err "refusing to delete sandbox '$name': stdin is not a terminal; pass --yes"
            exit "$EX_USAGE"
        fi
    fi
    say "Deleting sandbox '$name'..."
    run_gateway sandbox delete "$name"
}

cmd_policy_show() {
    [ "$#" -eq 0 ] || die_usage "policy show takes no arguments"
    require_openshell
    if [ "$opt_full" -eq 1 ] && [ "$opt_base" -eq 1 ]; then
        die_usage "policy show: --full and --base are mutually exclusive"
    fi
    if [ "$opt_full" -eq 1 ]; then
        set -- policy get --full
    elif [ "$opt_base" -eq 1 ]; then
        set -- policy get --base
    else
        set -- policy get --base
    fi
    if [ "$opt_global" -eq 1 ]; then
        set -- "$@" --global
    else
        name=$(resolved_name)
        require_sandbox "$name"
        set -- "$@" "$name"
    fi
    run_gateway "$@"
}

cmd_policy_edit() {
    [ "$#" -eq 0 ] || die_usage "policy edit takes no arguments"
    policy=$(resolved_policy)
    if [ ! -f "$policy" ]; then
        die_dep "policy file not found: $policy"
    fi
    editor=${EDITOR:-vi}
    # $editor may carry arguments (for example "code -w"), so word splitting is
    # intentional here.
    # shellcheck disable=SC2086
    $editor "$policy"
}

cmd_policy_apply() {
    [ "$#" -eq 0 ] || die_usage "policy apply takes no arguments"
    require_openshell
    policy=$(resolved_policy)
    if [ ! -f "$policy" ]; then
        die_dep "policy file not found: $policy"
    fi
    set -- policy set --policy "$policy"
    if [ "$opt_global" -eq 1 ]; then
        set -- "$@" --global
        if [ "$opt_yes" -eq 1 ]; then
            set -- "$@" --yes
        fi
    else
        name=$(resolved_name)
        require_sandbox "$name"
        if [ "$opt_wait" -eq 1 ]; then
            set -- "$@" --wait
        fi
        set -- "$@" "$name"
    fi
    run_gateway "$@"
    say "Policy applied from '$policy'."
}

# `policy review|approve|reject` act on network-rule proposals the
# agent filed (via the policy advisor) or OpenShell drafted from a denial.
# They are thin passthroughs to `openshell rule`; the human stays the only
# approver and there is deliberately no bulk or automatic approval.

cmd_policy_review() {
    [ "$#" -eq 0 ] || die_usage "policy review takes no arguments"
    require_openshell
    name=$(resolved_name)
    require_sandbox "$name"
    run_gateway rule get "$name" --status pending
}

cmd_policy_approve() {
    [ "$#" -eq 1 ] || die_usage "usage: $PROGRAM policy approve CHUNK_ID [--yes]"
    require_openshell
    name=$(resolved_name)
    require_sandbox "$name"
    chunk_id=$1
    if [ "$opt_yes" -eq 0 ]; then
        if [ -t 0 ]; then
            printf "Approve proposal %s on '%s'? [y/N] " "$chunk_id" "$name"
            read -r answer || answer=
            case $answer in
                y|Y|yes|YES) ;;
                *)
                    say "Aborted."
                    exit "$EX_USAGE"
                    ;;
            esac
        else
            err "refusing to approve proposal '$chunk_id': stdin is not a terminal; pass --yes"
            exit "$EX_USAGE"
        fi
    fi
    run_gateway rule approve "$name" --chunk-id "$chunk_id"
    say "Approved proposal '$chunk_id' on '$name'."
}

cmd_policy_reject() {
    [ "$#" -eq 1 ] || die_usage "usage: $PROGRAM policy reject CHUNK_ID --reason \"<text>\""
    require_openshell
    name=$(resolved_name)
    require_sandbox "$name"
    chunk_id=$1
    if [ -z "$opt_reason" ]; then
        die_usage "policy reject requires --reason (the agent receives it and can narrow its request)"
    fi
    run_gateway rule reject "$name" --chunk-id "$chunk_id" --reason "$opt_reason"
    say "Rejected proposal '$chunk_id' on '$name'."
}

cmd_provider_add() {
    [ "$#" -eq 1 ] || die_usage "usage: $PROGRAM provider add NAME --type TYPE [--from-existing]"
    provider=$1
    if [ -z "$opt_type" ]; then
        die_usage "provider add requires --type (a provider profile id)"
    fi
    saved_ifs=$IFS
    IFS=$NL
    set -f
    # shellcheck disable=SC2086
    for credential in $opt_credentials; do
        case $credential in
            *=*)
                set +f
                IFS=$saved_ifs
                die_usage "--credential takes the KEY name only; inline KEY=VALUE is not accepted (use --from-existing)"
                ;;
        esac
    done
    set +f
    IFS=$saved_ifs
    set -- provider create --name "$provider" --type "$opt_type"
    if [ "$opt_from_existing" -eq 1 ]; then
        set -- "$@" --from-existing
    fi
    if [ "$opt_runtime_credentials" -eq 1 ]; then
        set -- "$@" --runtime-credentials
    fi
    if [ "$opt_global_profile" -eq 1 ]; then
        set -- "$@" --global-profile
    fi
    saved_ifs=$IFS
    IFS=$NL
    set -f
    # shellcheck disable=SC2086
    for credential in $opt_credentials; do
        if [ -n "$credential" ]; then
            set -- "$@" --credential "$credential"
        fi
    done
    # shellcheck disable=SC2086
    for config_pair in $opt_configs; do
        if [ -n "$config_pair" ]; then
            set -- "$@" --config "$config_pair"
        fi
    done
    set +f
    IFS=$saved_ifs
    run_gateway "$@"
    say "Provider '$provider' created."
    remember_provider "$provider"
    say "Remembered provider '$provider' in $config_file."
}

cmd_provider_attach() {
    [ "$#" -eq 1 ] || die_usage "usage: $PROGRAM provider attach PROVIDER [--wait]"
    provider=$1
    require_openshell
    name=$(resolved_name)
    require_sandbox "$name"
    set -- sandbox provider attach "$name" "$provider"
    if [ "$opt_wait" -eq 1 ]; then
        set -- "$@" --wait
    fi
    run_gateway "$@"
    say "Provider '$provider' attached to '$name'."
}

cmd_provider_list() {
    [ "$#" -eq 0 ] || die_usage "provider list takes no arguments"
    require_openshell
    run_gateway provider list
}

# ---------------------------------------------------------------------------
# provider setup: stored credentials -> profile -> provider -> attach
#
# Reads credentials from the Maki (~/.local/state/maki/auth) and OpenCode
# (~/.local/share/opencode/auth.json) stores, or from a JSON file, a host
# environment variable, or a hidden prompt. Credential values are only ever
# exported into the environment of the openshell child process: never placed
# in argv, files, or output.
# ---------------------------------------------------------------------------

setup_tmp=
# shellcheck disable=SC2329  # invoked via trap
setup_cleanup() {
    if [ -n "$setup_tmp" ] && [ -d "$setup_tmp" ]; then
        rm -rf "$setup_tmp"
    fi
}

# Interactive when stdin is a terminal. <PREFIX>_INTERACTIVE=1 treats piped
# stdin as interactive for scripted runs (tests, `printf ... | <program>`).
is_interactive() {
    if [ -t 0 ]; then
        return 0
    fi
    if [ -n "$(env_setting INTERACTIVE)" ]; then
        return 0
    fi
    return 1
}

reply=
ask() {
    printf '%s' "$1"
    if ! IFS= read -r reply; then
        err "input ended before the prompt was answered"
        exit "$EX_USAGE"
    fi
}

# Hidden input: stty -echo only on a real terminal; piped input is read as is.
ask_hidden() {
    printf '%s' "$1"
    if [ -t 0 ] && stty -echo 2>/dev/null; then
        if ! IFS= read -r reply; then
            stty echo 2>/dev/null || true
            err "input ended before the prompt was answered"
            exit "$EX_USAGE"
        fi
        stty echo 2>/dev/null || true
        printf '\n'
        return 0
    fi
    if ! IFS= read -r reply; then
        err "input ended before the prompt was answered"
        exit "$EX_USAGE"
    fi
}

confirm() {
    ask "$1"
    case ${reply:-} in
        y|Y|yes|YES) return 0 ;;
        *) return 1 ;;
    esac
}

auth_label() {
    case $1 in
        api) printf 'api-key' ;;
        *) printf '%s' "$1" ;;
    esac
}

first_line() {
    printf '%s\n' "$1" | head -n 1
}

valid_kebab() {
    case $1 in
        ''|*[!a-z0-9-]*|-*|*--*|*-) return 1 ;;
    esac
    return 0
}

valid_env_name() {
    case $1 in
        [A-Za-z_][A-Za-z0-9_]*) return 0 ;;
    esac
    return 1
}

valid_host() {
    case $1 in
        ''|*[!A-Za-z0-9.-]*|.*|*.|*..*) return 1 ;;
    esac
    return 0
}

valid_api_path() {
    case $1 in
        '') return 0 ;;
        /*) ;;
        *) return 1 ;;
    esac
    case $1 in
        *[!A-Za-z0-9._/*-]*) return 1 ;;
    esac
    return 0
}

# Prints the string value of a single-level JSON key, or nothing.
json_string_field() { # FILE KEY
    if [ "$have_jq" -eq 1 ]; then
        jq -r --arg k "$2" '
            if (has($k) and (.[$k] | type) == "string") then .[$k] else empty end
        ' "$1" 2>/dev/null || true
    else
        sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" 2>/dev/null \
            | head -n 1
    fi
}

# Prints the string value at a dotted field path. jq handles nested paths;
# the fallback covers single-level keys only and fails for nested ones.
json_path_field() { # FILE PATH
    json_path_file=$1
    json_path_key=$2
    if [ "$have_jq" -eq 1 ]; then
        jq -r --arg p "$json_path_key" '
            ($p | split(".")) as $keys
            | try (getpath($keys) | if type == "string" then . else empty end) catch empty
        ' "$json_path_file" 2>/dev/null || true
        return 0
    fi
    case $json_path_key in
        .*) json_path_key=${json_path_key#.} ;;
    esac
    case $json_path_key in
        *.*)
            warn "jq is not installed; nested field paths are not supported"
            return 1
            ;;
    esac
    sed -n 's/.*"'"$json_path_key"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
        "$json_path_file" 2>/dev/null | head -n 1
}

# Classifies a standalone credential object without reading the value.
classify_credential_file() { # FILE -> api | oauth | unknown
    if [ "$have_jq" -eq 1 ]; then
        jq -r '
            if ((has("api_key") and (.api_key | type) == "string")
                or (has("key") and (.key | type) == "string")) then "api"
            elif (has("access") or has("refresh")
                or has("access_token") or has("refresh_token")) then "oauth"
            else "unknown" end
        ' "$1" 2>/dev/null || printf 'unknown\n'
    else
        if grep -q '"api_key"[[:space:]]*:' "$1" 2>/dev/null \
            || grep -q '"key"[[:space:]]*:' "$1" 2>/dev/null; then
            printf 'api\n'
        elif grep -q '"access"[[:space:]]*:' "$1" 2>/dev/null \
            || grep -q '"refresh"[[:space:]]*:' "$1" 2>/dev/null; then
            printf 'oauth\n'
        else
            printf 'unknown\n'
        fi
    fi
}

# Auth type of one OpenCode store entry, without reading the value.
opencode_entry_type() { # SLUG
    if [ "$have_jq" -eq 1 ]; then
        jq -r --arg s "$1" '
            (.[$s] // empty)
            | (.type // (if has("key") then "api"
                elif (has("access") or has("refresh")) then "oauth"
                else "unknown" end))
        ' "$opencode_auth_file" 2>/dev/null || printf 'unknown\n'
    else
        awk -v slug="$1" '
            $0 ~ ("^[[:space:]]*\"" slug "\"[[:space:]]*:") { inside = 1; next }
            inside && /"type"[[:space:]]*:/ {
                line = $0
                sub(/.*"type"[[:space:]]*:[[:space:]]*"/, "", line)
                sub(/".*/, "", line)
                print line
                exit
            }
        ' "$opencode_auth_file" 2>/dev/null
    fi
}

store_credential_file() { # STORE SLUG
    case $1 in
        maki)
            if [ -f "$maki_auth_dir/$2.json" ]; then
                printf '%s\n' "$maki_auth_dir/$2.json"
            elif [ -f "$maki_auth_dir/plugins/$2.json" ]; then
                printf '%s\n' "$maki_auth_dir/plugins/$2.json"
            fi
            ;;
        opencode)
            if [ -f "$opencode_auth_file" ]; then
                printf '%s\n' "$opencode_auth_file"
            fi
            ;;
    esac
}

opencode_value_fallback() { # SLUG FILE
    awk -v slug="$1" '
        $0 ~ ("^[[:space:]]*\"" slug "\"[[:space:]]*:") { inside = 1; next }
        inside && /"key"[[:space:]]*:/ {
            line = $0
            sub(/.*"key"[[:space:]]*:[[:space:]]*"/, "", line)
            sub(/".*/, "", line)
            print line
            exit
        }
        inside && /^[[:space:]]*}[[:space:]]*,?[[:space:]]*$/ { inside = 0 }
    ' "$2" 2>/dev/null
}

# Prints the credential value for an API-key store entry.
credential_value_for() { # STORE SLUG FILE
    case $1 in
        maki)
            credential_value=$(json_string_field "$3" api_key)
            if [ -z "$credential_value" ]; then
                credential_value=$(json_string_field "$3" key)
            fi
            ;;
        opencode)
            if [ "$have_jq" -eq 1 ]; then
                credential_value=$(jq -r --arg s "$2" '(.[$s] // empty) | (.key // empty)' "$3" 2>/dev/null || true)
            else
                credential_value=$(opencode_value_fallback "$2" "$3")
            fi
            ;;
        *)
            credential_value=
            ;;
    esac
    if [ -z "$credential_value" ]; then
        return 1
    fi
    printf '%s\n' "$credential_value"
}

# Appends "store<TAB>slug<TAB>auth<TAB>file" lines; never reads values.
scan_stores() { # OUT
    scan_out=$1
    : >"$scan_out"
    for scan_dir in "$maki_auth_dir" "$maki_auth_dir/plugins"; do
        if [ ! -d "$scan_dir" ]; then
            continue
        fi
        for scan_file in "$scan_dir"/*.json; do
            if [ ! -f "$scan_file" ]; then
                continue
            fi
            scan_slug=$(basename -- "$scan_file" .json)
            scan_auth=$(classify_credential_file "$scan_file")
            printf 'maki\t%s\t%s\t%s\n' "$scan_slug" "$scan_auth" "$scan_file" >>"$scan_out"
        done
    done
    if [ -f "$opencode_auth_file" ]; then
        if [ "$have_jq" -eq 1 ]; then
            jq -r --arg f "$opencode_auth_file" '
                to_entries[]
                | ["opencode", .key,
                    ((.value.type // "unknown")
                     | if . == "api" or . == "api_key" then "api"
                       elif . == "oauth" then "oauth"
                       else "unknown" end),
                    $f]
                | @tsv
            ' "$opencode_auth_file" 2>/dev/null >>"$scan_out" || true
        else
            awk -v file="$opencode_auth_file" '
                /^[[:space:]]*"[^"]+"[[:space:]]*:[[:space:]]*\{/ {
                    slug = $0
                    sub(/^[[:space:]]*"/, "", slug)
                    sub(/".*/, "", slug)
                    next
                }
                slug != "" && /"type"[[:space:]]*:/ {
                    line = $0
                    sub(/.*"type"[[:space:]]*:[[:space:]]*"/, "", line)
                    sub(/".*/, "", line)
                    type = "unknown"
                    if (line == "oauth") type = "oauth"
                    else if (line == "api" || line == "api_key") type = "api"
                    printf "opencode\t%s\t%s\t%s\n", slug, type, file
                    slug = ""
                }
            ' "$opencode_auth_file" >>"$scan_out"
        fi
    fi
    return 0
}

list_count=0
list_credentials() { # FILE [STORE_FILTER]
    list_file=$1
    list_filter=${2:-}
    list_count=0
    # shellcheck disable=SC2034  # the file column is only displayed elsewhere
    while IFS=$TAB read -r list_store list_slug list_auth list_file_column; do
        if [ -z "$list_store" ]; then
            continue
        fi
        if [ -n "$list_filter" ] && [ "$list_store" != "$list_filter" ]; then
            continue
        fi
        list_count=$((list_count + 1))
        say "  $list_count. $list_store:$list_slug ($(auth_label "$list_auth"))"
    done <"$list_file"
}

select_credential() { # FILE FILTER NUMBER
    select_file=$1
    select_filter=${2:-}
    select_want=$3
    select_index=0
    while IFS=$TAB read -r select_store select_slug select_auth select_file_column; do
        if [ -z "$select_store" ]; then
            continue
        fi
        if [ -n "$select_filter" ] && [ "$select_store" != "$select_filter" ]; then
            continue
        fi
        select_index=$((select_index + 1))
        if [ "$select_index" -eq "$select_want" ]; then
            selected_store=$select_store
            selected_slug=$select_slug
            selected_auth=$select_auth
            selected_file=$select_file_column
            return 0
        fi
    done <"$select_file"
    return 1
}

unsupported_credential() { # STORE SLUG AUTH
    err "credential '$1:$2' is '$3', which this workflow does not support"
    err "  API-key credentials are the supported path; for OAuth guidance see docs/migrating-providers.md"
    exit "$EX_USAGE"
}

interactive_generic_source() {
    while :; do
        say "Credential source:"
        say "  1. JSON file (field path)"
        say "  2. Environment variable"
        say "  3. Hidden prompt"
        ask "Select 1-3, or q to quit: "
        case ${reply:-} in
            1)
                ask "Path to JSON file: "
                source_file=${reply:-}
                if [ ! -f "$source_file" ]; then
                    say "File not found: $source_file"
                    continue
                fi
                ask "Field path [.api_key]: "
                source_field=${reply:-}
                if [ -z "$source_field" ]; then
                    source_field=.api_key
                fi
                if ! cred_value=$(json_path_field "$source_file" "$source_field"); then
                    say "Nested field paths need jq; install jq and retry."
                    continue
                fi
                if [ -z "$cred_value" ]; then
                    say "No string value at '$source_field' in $source_file."
                    continue
                fi
                source_kind='file'
                source_slug=
                return 0
                ;;
            2)
                ask "Environment variable name: "
                source_env=${reply:-}
                if ! valid_env_name "$source_env"; then
                    say "Invalid variable name."
                    continue
                fi
                cred_value=$(printenv "$source_env" || true)
                if [ -z "$cred_value" ]; then
                    say "Variable '$source_env' is not set."
                    continue
                fi
                source_kind='env'
                source_slug=
                return 0
                ;;
            3)
                ask_hidden "Credential value (input hidden): "
                if [ -z "${reply:-}" ]; then
                    say "No value entered."
                    continue
                fi
                cred_value=$reply
                source_kind=prompt
                source_slug=
                return 0
                ;;
            q|Q|quit)
                return 1
                ;;
            *)
                say "Enter 1, 2, 3, or q."
                ;;
        esac
    done
}

# Picks a stored credential interactively (optionally from one store).
interactive_source() { # [STORE_FILTER]
    interactive_filter=${1:-}
    scan_stores "$stores_file"
    interactive_visible=0
    # shellcheck disable=SC2034
    while IFS=$TAB read -r int_store int_store_column int_slug_column int_auth_column; do
        if [ -z "$int_store" ]; then
            continue
        fi
        if [ -n "$interactive_filter" ] && [ "$int_store" != "$interactive_filter" ]; then
            continue
        fi
        interactive_visible=$((interactive_visible + 1))
    done <"$stores_file"

    if [ "$interactive_visible" -eq 0 ]; then
        if [ -n "$interactive_filter" ]; then
            err "no $interactive_filter credentials found"
            return 1
        fi
        say "No stored credentials detected."
    fi

    while :; do
        if [ "$interactive_visible" -gt 0 ]; then
            say "Detected credentials:"
            list_credentials "$stores_file" "$interactive_filter"
            ask "Select 1-$list_count, or g for another source, q to quit: "
        else
            ask "Use another source? [g=generic, q=quit]: "
        fi
        case ${reply:-} in
            q|Q|quit)
                return 1
                ;;
            g|G|generic)
                if interactive_generic_source; then
                    return 0
                fi
                ;;
            ''|*[!0-9]*)
                say "Enter a number, g, or q."
                ;;
            *)
                if [ "$interactive_visible" -eq 0 ] \
                    || [ "$reply" -lt 1 ] || [ "$reply" -gt "$list_count" ]; then
                    say "Enter a number between 1 and $list_count."
                    continue
                fi
                if ! select_credential "$stores_file" "$interactive_filter" "$reply"; then
                    say "Invalid selection."
                    continue
                fi
                if [ "$selected_auth" != api ]; then
                    unsupported_credential "$selected_store" "$selected_slug" "$selected_auth"
                fi
                if ! cred_value=$(credential_value_for "$selected_store" "$selected_slug" "$selected_file"); then
                    err "cannot read an API key for '$selected_store:$selected_slug' from $selected_file"
                    exit "$EX_USAGE"
                fi
                source_kind=store
                source_store=$selected_store
                source_slug=$selected_slug
                return 0
                ;;
        esac
    done
}

profile_field() { # FILE KEY
    sed -n "s/^$2:[[:space:]]*//p" "$1" | head -n 1
}

# First env var of the first credential's env_vars list.
profile_env_var() { # FILE
    sed -n 's/^[[:space:]]*env_vars:[[:space:]]*\[\([^]]*\)\].*/\1/p' "$1" \
        | head -n 1 | cut -d, -f1 | tr -d '[:space:]'
}

catalog_lookup() { # STORE SLUG -> profile id
    if [ ! -f "$OSS_CATALOG_FILE" ]; then
        return 0
    fi
    # shellcheck disable=SC2034  # the note column is prose for humans
    while IFS=$TAB read -r catalog_store catalog_slug catalog_id catalog_file_column; do
        case $catalog_store in
            ''|'#'*) continue ;;
        esac
        if [ "$catalog_store" = "$1" ] && [ "$catalog_slug" = "$2" ]; then
            printf '%s\n' "$catalog_id"
            return 0
        fi
    done <"$OSS_CATALOG_FILE"
}

generate_custom_profile() { # TEMPLATE ID ENV HOST PATH
    awk -v id="$2" -v env="$3" -v host="$4" -v path="$5" -v agent="$OSS_AGENT_NAME" '
        /^id:[[:space:]]/ {
            print "id: " id
            next
        }
        /^display_name:[[:space:]]/ {
            print "display_name: " id
            next
        }
        /^description:[[:space:]]/ {
            print "description: Custom inference API for the " agent " coding agent"
            next
        }
        /^[[:space:]]+env_vars:[[:space:]]*\[/ {
            line = $0
            sub(/\[[^]]*\]/, "[" env "]", line)
            print line
            next
        }
        /^[[:space:]]+-[[:space:]]+host:[[:space:]]/ {
            print "  - host: " host
            if (path != "") {
                print "    path: " path
            }
            next
        }
        { print }
    ' "$1"
}

profile_exists_in_gateway() { # ID
    profile_list_json=$(os profile list --type provider -o json --global 2>/dev/null) || return 1
    if [ "$have_jq" -eq 1 ]; then
        printf '%s' "$profile_list_json" | jq -e --arg id "$1" 'any(.[]; .id == $id)' >/dev/null 2>&1
    else
        printf '%s' "$profile_list_json" | grep -q "\"id\"[[:space:]]*:[[:space:]]*\"$1\""
    fi
}

# Runs an openshell command with the credential in the child environment
# only. The subshell keeps the assignment out of the wizard's environment and
# the value out of argv.
run_credential_env() { # VAR VALUE COMMAND...
    credential_env_name=$1
    credential_env_value=$2
    shift 2
    credential_rc=0
    (
        export "$credential_env_name=$credential_env_value"
        run_gateway "$@"
    ) || credential_rc=$?
    if [ "$credential_rc" -ne 0 ]; then
        exit "$credential_rc"
    fi
}

cmd_provider_setup() {
    [ "$#" -eq 0 ] || die_usage "provider setup takes no arguments"
    if [ "$have_jq" -eq 0 ]; then
        warn "jq not found; JSON stores are read with a limited fallback"
    fi

    setup_tmp=$(mktemp -d "${TMPDIR:-/tmp}/$OSS_TMP_PREFIX-setup.XXXXXX")
    stores_file=$setup_tmp/credentials.tsv

    source_kind=
    source_store=
    source_slug=
    source_file=
    source_field=
    source_env=
    cred_value=

    if [ -n "$opt_from" ]; then
        [ -z "$opt_file" ] || die_usage "provider setup accepts one credential source: --from, --file, or --env"
        [ -z "$opt_envs" ] || die_usage "provider setup accepts one credential source: --from, --file, or --env"
        source_kind=store
        source_store=$opt_from
        case $source_store in
            maki|opencode) ;;
            *) die_usage "provider setup --from expects maki or opencode, got '$source_store'" ;;
        esac
        case $opt_credentials in
            *'='*)
                die_usage "--credential takes the SLUG name only; inline KEY=VALUE is not accepted"
                ;;
        esac
        source_slug=$(first_line "$opt_credentials")
        if [ -z "$source_slug" ]; then
            if ! is_interactive; then
                die_usage "provider setup --from $source_store needs --credential SLUG when stdin is not a terminal"
            fi
            if ! interactive_source "$source_store"; then
                say "Aborted."
                exit "$EX_USAGE"
            fi
        else
            source_file=$(store_credential_file "$source_store" "$source_slug")
            if [ -z "$source_file" ]; then
                err "no '$source_slug' credential in the $source_store store"
                exit "$EX_USAGE"
            fi
            case $source_store in
                maki) source_auth=$(classify_credential_file "$source_file") ;;
                opencode) source_auth=$(opencode_entry_type "$source_slug") ;;
            esac
            if [ "$source_auth" != api ]; then
                unsupported_credential "$source_store" "$source_slug" "$source_auth"
            fi
            if ! cred_value=$(credential_value_for "$source_store" "$source_slug" "$source_file"); then
                err "cannot read an API key for '$source_store:$source_slug' from $source_file"
                exit "$EX_USAGE"
            fi
        fi
    elif [ -n "$opt_file" ]; then
        [ -z "$opt_envs" ] || die_usage "provider setup accepts one credential source: --from, --file, or --env"
        source_kind='file'
        if [ ! -f "$opt_file" ]; then
            die_usage "provider setup --file: not a file: $opt_file"
        fi
        source_field=${opt_field:-.api_key}
        if ! cred_value=$(json_path_field "$opt_file" "$source_field"); then
            die_usage "cannot read '$source_field' from $opt_file without jq; install jq or use a single-level field"
        fi
        if [ -z "$cred_value" ]; then
            err "no string value at '$source_field' in $opt_file"
            exit "$EX_USAGE"
        fi
    elif [ -n "$opt_envs" ]; then
        source_kind='env'
        source_env=$(first_line "$opt_envs")
        if ! valid_env_name "$source_env"; then
            die_usage "provider setup --env expects an environment variable name, got '$source_env'"
        fi
        cred_value=$(printenv "$source_env" || true)
        if [ -z "$cred_value" ]; then
            err "environment variable '$source_env' is not set (or empty)"
            exit "$EX_USAGE"
        fi
    else
        if ! is_interactive; then
            die_usage "provider setup needs a credential source: --from STORE --credential SLUG, --file PATH [--field PATH], or --env VAR (stdin is not a terminal)"
        fi
        if ! interactive_source; then
            say "Aborted."
            exit "$EX_USAGE"
        fi
    fi

    profile_file=
    profile_id=
    profile_env=
    if [ -n "$opt_profile" ]; then
        profile_file=$opt_profile
        if [ ! -f "$profile_file" ]; then
            die_dep "profile file not found: $profile_file"
        fi
        profile_id=$(profile_field "$profile_file" id)
        if [ -z "$profile_id" ]; then
            die_usage "cannot read a profile id from $profile_file"
        fi
    elif [ "$source_kind" = store ]; then
        catalog_id=$(catalog_lookup "$source_store" "$source_slug")
        if [ -n "$catalog_id" ]; then
            profile_id=$catalog_id
            profile_file=$profiles_dir/$profile_id.yaml
            if [ ! -f "$profile_file" ]; then
                die_dep "catalog maps $source_store:$source_slug to '$profile_id', but $profile_file is missing"
            fi
            say "Using curated profile '$profile_id'."
        fi
    fi

    if [ -z "$profile_file" ]; then
        if ! is_interactive; then
            die_usage "no curated profile matches this credential; custom profiles need an interactive terminal (or pass --profile FILE)"
        fi
        template_file=$profiles_dir/template.yaml
        if [ ! -f "$template_file" ]; then
            die_dep "missing profile template: $template_file"
        fi
        custom_default_id=
        if [ -n "$source_slug" ]; then
            custom_default_id=$OSS_CUSTOM_PROFILE_PREFIX$source_slug
        fi
        say "No curated profile matches; entering custom provider setup."
        while :; do
            if [ -n "$custom_default_id" ]; then
                ask "Provider id (kebab-case) [$custom_default_id]: "
                custom_id=${reply:-$custom_default_id}
            else
                ask "Provider id (kebab-case): "
                custom_id=${reply:-}
            fi
            if valid_kebab "$custom_id"; then
                break
            fi
            say "Use lowercase letters, digits, and single hyphens (for example: my-provider)."
        done
        case $custom_id in
            "$OSS_CUSTOM_PROFILE_PREFIX"*) custom_env_default=$(printf '%s' "${custom_id#"$OSS_CUSTOM_PROFILE_PREFIX"}" | tr 'a-z-' 'A-Z_')_API_KEY ;;
            *) custom_env_default=$(printf '%s' "$custom_id" | tr 'a-z-' 'A-Z_')_API_KEY ;;
        esac
        while :; do
            ask "Credential env var [$custom_env_default]: "
            custom_env=${reply:-$custom_env_default}
            if valid_env_name "$custom_env"; then
                break
            fi
            say "Use letters, digits, and underscores; start with a letter or underscore."
        done
        while :; do
            ask "Endpoint host (for example api.example.com): "
            custom_host=${reply:-}
            if valid_host "$custom_host"; then
                break
            fi
            say "Enter a hostname such as api.example.com."
        done
        custom_path=
        ask "API path prefix (optional, for example /v1): "
        custom_path=${reply:-}
        while ! valid_api_path "$custom_path"; do
            say "Paths must start with / and use letters, digits, . _ / * - only."
            ask "API path prefix (optional, for example /v1): "
            custom_path=${reply:-}
        done
        custom_target=$helper_profiles_dir/$custom_id.yaml
        custom_write=1
        if [ -e "$custom_target" ]; then
            if [ "$opt_yes" -eq 1 ]; then
                say "Overwriting existing generated profile $custom_target."
            elif confirm "Profile '$custom_target' exists. Overwrite? [y/N] "; then
                :
            else
                say "Keeping existing profile $custom_target."
                custom_write=0
            fi
        fi
        if [ "$custom_write" -eq 1 ]; then
            mkdir -p -- "$helper_profiles_dir"
            ( umask 077; generate_custom_profile "$template_file" "$custom_id" "$custom_env" "$custom_host" "$custom_path" >"$custom_target" )
            if [ ! -s "$custom_target" ]; then
                die_dep "failed to generate profile $custom_target from $template_file"
            fi
            chmod 600 "$custom_target" 2>/dev/null || true
            say "Generated profile $custom_target."
        fi
        profile_file=$custom_target
        profile_id=$custom_id
    fi

    profile_env=$(profile_env_var "$profile_file")
    if [ -z "$profile_env" ]; then
        die_usage "cannot read a credential env var from $profile_file (expected: env_vars: [NAME])"
    fi

    provider_name=${opt_name:-$profile_id}
    require_openshell

    if ! os provider list --names >"$setup_tmp/providers.txt" 2>/dev/null; then
        die_gateway "cannot list providers; is the gateway running? Try '$PROGRAM doctor'"
    fi
    provider_exists=0
    if grep -Fqx -- "$provider_name" "$setup_tmp/providers.txt"; then
        provider_exists=1
    fi
    if [ "$provider_exists" -eq 1 ] && [ "$opt_yes" -eq 0 ] && ! is_interactive; then
        die_usage "provider '$provider_name' already exists; pass --yes to update it (stdin is not a terminal)"
    fi

    say "Linting profile '$profile_id'..."
    run_gateway profile lint -f "$profile_file"
    if profile_exists_in_gateway "$profile_id"; then
        say "Profile '$profile_id' is already imported."
    else
        say "Importing profile '$profile_id' globally..."
        run_gateway profile import -f "$profile_file" --global
    fi

    if [ "$provider_exists" -eq 1 ]; then
        update_now=0
        if [ "$opt_yes" -eq 1 ]; then
            update_now=1
        elif is_interactive \
            && confirm "Provider '$provider_name' already exists. Update it from the local credential? [y/N] "; then
            update_now=1
        fi
        if [ "$update_now" -eq 1 ]; then
            run_credential_env "$profile_env" "$cred_value" provider update "$provider_name" --from-existing
            say "Provider '$provider_name' updated."
        else
            say "Keeping existing provider '$provider_name'."
        fi
    else
        run_credential_env "$profile_env" "$cred_value" provider create \
            --name "$provider_name" --type "$profile_id" --from-existing --global-profile
        say "Provider '$provider_name' created."
    fi

    remember_provider "$provider_name"
    say "Remembered provider '$provider_name' in $config_file."

    sandbox_name=$(resolved_name)
    sandbox_step_phase=$(sandbox_phase "$sandbox_name")
    if [ -z "$sandbox_step_phase" ]; then
        if [ "${opt_attach:-}" = 1 ]; then
            warn "sandbox '$sandbox_name' not found; skipping attach (run '$PROGRAM up' first)"
        fi
    else
        attach_now=0
        if [ "${opt_attach:-}" = 1 ]; then
            attach_now=1
        elif [ "${opt_attach:-}" = 0 ]; then
            attach_now=0
        elif is_interactive \
            && confirm "Attach provider '$provider_name' to sandbox '$sandbox_name'? [y/N] "; then
            attach_now=1
        fi
        if [ "$attach_now" -eq 1 ]; then
            run_gateway sandbox provider attach "$sandbox_name" "$provider_name" --wait
            say "Provider '$provider_name' attached to '$sandbox_name'."
        fi
    fi

    if is_interactive; then
        ask "Default model for sessions (provider/model, Enter to skip): "
        if [ -n "${reply:-}" ]; then
            remember_model "$reply"
            say "Default model set to '$reply'."
        fi
    fi

    agent_setup_hint "$profile_id"

    unset cred_value
    say ""
    say "Next steps:"
    say "  start a session:               $PROGRAM (from the project directory)"
    say "  attach to an existing sandbox: $PROGRAM provider attach $provider_name"
    say "  pick a model headless:         $PROGRAM run --model <provider/model> \"...\""
}

# ---------------------------------------------------------------------------
# Argument parsing
#
# Options may appear before or after the command and its arguments. After
# parsing, the positional parameters hold the command followed by its
# arguments. `--` ends option parsing; use it for values that start with `-`.
# ---------------------------------------------------------------------------

opt_name=
opt_image=
opt_policy=
opt_cpu=
opt_memory=
opt_engine=
opt_gateway=
opt_workdir=
opt_providers=
opt_envs=
opt_env_froms=
opt_allow_env=
opt_credentials=
opt_configs=
opt_yes=0
opt_reason=
opt_full=0
opt_base=0
opt_global=0
opt_wait=0
opt_tail=0
opt_since=
opt_source=
opt_level=
opt_lines=
opt_type=
opt_from_existing=0
opt_runtime_credentials=0
opt_global_profile=0
opt_no_git_ignore=0
opt_no_sync=0
opt_from=
opt_file=
opt_field=
opt_profile=
opt_model=
opt_continue=0
opt_resume=
opt_session_id=
opt_timeout=
opt_idle_stop=
opt_attach=
opt_help=0

append_list() {
    # $1 is the current list name's value, $2 the new item; prints the merge.
    if [ -n "$1" ]; then
        printf '%s\n%s' "$1" "$2"
    else
        printf '%s' "$2"
    fi
}

# Computes the state that depends on the environment and the front-end
# settings, and installs the setup cleanup traps. Called by oss_main.
oss_init() {
    TAB=$(printf '\t')

    config_home=${XDG_CONFIG_HOME:-${HOME:-/tmp}/.config}
    config_file=$config_home/$OSS_CONFIG_NAME/config.toml

    project_basename=$(basename -- "$PWD")
    project_name=$(printf '%s' "$project_basename" | tr -c 'A-Za-z0-9_.-' '-')
    project_name=$(printf '%s' "$project_name" | sed 's/--*/-/g; s/^-//; s/-$//')
    if [ -z "$project_name" ]; then
        project_name=project
    fi

    have_jq=0
    if command -v jq >/dev/null 2>&1; then
        have_jq=1
    fi

    state_base=${XDG_STATE_HOME:-${HOME:-/tmp}/.local/state}

    profiles_dir=$OSS_PROFILES_DIR
    helper_profiles_dir=${XDG_CONFIG_HOME:-${HOME:-/tmp}/.config}/$OSS_CONFIG_NAME/profiles
    maki_auth_dir=${HOME:-/tmp}/.local/state/maki/auth
    opencode_auth_file=${HOME:-/tmp}/.local/share/opencode/auth.json

    # Signals must stop the program, not just clean up: an EXIT-only handler
    # replaced the default termination and let the wizard run on after Ctrl-C.
    trap setup_cleanup EXIT
    trap 'setup_cleanup; exit 130' INT
    trap 'setup_cleanup; exit 143' TERM
}

# Parses the options, loads the config, and dispatches the command.
oss_main() {
    oss_init

    OPT_ARGC=$#
    # The loop below rotates command words to the end of argv, so a value flag in
    # the last position would pull a command word back in as its own value. Catch
    # a trailing --resume/--session-id before that rotation starts.
    for opt_trailing in "$@"; do :; done
    case ${opt_trailing:-} in
        --resume|-r) die_usage "option $opt_trailing requires a value" ;;
        --session-id) die_usage "option --session-id requires a value" ;;
        --timeout) die_usage "option --timeout requires a value" ;;
        --idle-stop) die_usage "option --idle-stop requires a value" ;;
    esac
    OPT_I=0
    while [ "$OPT_I" -lt "$OPT_ARGC" ]; do
        OPT=$1
        shift
        OPT_I=$((OPT_I + 1))
        case $OPT in
            --name)
                [ "$#" -gt 0 ] || die_usage "option --name requires a value"
                opt_name=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --image)
                [ "$#" -gt 0 ] || die_usage "option --image requires a value"
                opt_image=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --policy)
                [ "$#" -gt 0 ] || die_usage "option --policy requires a value"
                opt_policy=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --cpu)
                [ "$#" -gt 0 ] || die_usage "option --cpu requires a value"
                opt_cpu=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --memory)
                [ "$#" -gt 0 ] || die_usage "option --memory requires a value"
                opt_memory=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --engine)
                [ "$#" -gt 0 ] || die_usage "option --engine requires a value"
                opt_engine=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --gateway)
                [ "$#" -gt 0 ] || die_usage "option --gateway requires a value"
                opt_gateway=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --workdir)
                [ "$#" -gt 0 ] || die_usage "option --workdir requires a value"
                opt_workdir=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --provider)
                [ "$#" -gt 0 ] || die_usage "option --provider requires a value"
                opt_providers=$(append_list "$opt_providers" "$1")
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --env)
                [ "$#" -gt 0 ] || die_usage "option --env requires a value"
                opt_envs=$(append_list "$opt_envs" "$1")
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --env-from)
                [ "$#" -gt 0 ] || die_usage "option --env-from requires a value"
                opt_env_froms=$(append_list "$opt_env_froms" "$1")
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --allow-env)
                [ "$#" -gt 0 ] || die_usage "option --allow-env requires a value"
                opt_allow_env=$(append_list "$opt_allow_env" "$1")
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --credential)
                [ "$#" -gt 0 ] || die_usage "option --credential requires a value"
                opt_credentials=$(append_list "$opt_credentials" "$1")
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --config)
                [ "$#" -gt 0 ] || die_usage "option --config requires a value"
                opt_configs=$(append_list "$opt_configs" "$1")
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --type)
                [ "$#" -gt 0 ] || die_usage "option --type requires a value"
                opt_type=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --from)
                [ "$#" -gt 0 ] || die_usage "option --from requires a value"
                opt_from=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --file)
                [ "$#" -gt 0 ] || die_usage "option --file requires a value"
                opt_file=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --field)
                [ "$#" -gt 0 ] || die_usage "option --field requires a value"
                opt_field=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --profile)
                [ "$#" -gt 0 ] || die_usage "option --profile requires a value"
                opt_profile=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --model)
                [ "$#" -gt 0 ] || die_usage "option --model requires a value"
                opt_model=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            -c|--continue)
                opt_continue=1
                ;;
            -r|--resume)
                [ "$#" -gt 0 ] || die_usage "option $OPT requires a value"
                [ -n "$1" ] || die_usage "option $OPT requires a non-empty value"
                opt_resume=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --timeout)
                [ "$#" -gt 0 ] || die_usage "option --timeout requires a value"
                opt_timeout=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --idle-stop)
                [ "$#" -gt 0 ] || die_usage "option --idle-stop requires a value"
                opt_idle_stop=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --session-id)
                [ "$#" -gt 0 ] || die_usage "option --session-id requires a value"
                [ -n "$1" ] || die_usage "option --session-id requires a non-empty value"
                # shellcheck disable=SC2034  # read by the front-end's argv hooks
                opt_session_id=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --since)
                [ "$#" -gt 0 ] || die_usage "option --since requires a value"
                opt_since=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --source)
                [ "$#" -gt 0 ] || die_usage "option --source requires a value"
                opt_source=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --level)
                [ "$#" -gt 0 ] || die_usage "option --level requires a value"
                opt_level=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            -n|--lines)
                [ "$#" -gt 0 ] || die_usage "option $OPT requires a value"
                opt_lines=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --yes) opt_yes=1 ;;
            --reason)
                [ "$#" -gt 0 ] || die_usage "option --reason requires a value"
                opt_reason=$1
                shift
                OPT_I=$((OPT_I + 1))
                ;;
            --full) opt_full=1 ;;
            --base) opt_base=1 ;;
            --global) opt_global=1 ;;
            --wait) opt_wait=1 ;;
            --tail) opt_tail=1 ;;
            --from-existing) opt_from_existing=1 ;;
            --runtime-credentials) opt_runtime_credentials=1 ;;
            --global-profile) opt_global_profile=1 ;;
            --attach) opt_attach=1 ;;
            --no-attach) opt_attach=0 ;;
            --no-git-ignore) opt_no_git_ignore=1 ;;
            --no-sync) opt_no_sync=1 ;;
            -h|--help) opt_help=1 ;;
            --)
                unprocessed=$((OPT_ARGC - OPT_I))
                moved=0
                while [ "$moved" -lt "$unprocessed" ]; do
                    set -- "$@" "$1"
                    shift
                    moved=$((moved + 1))
                done
                OPT_I=$OPT_ARGC
                ;;
            -*)
                if ! agent_parse_option "$OPT" "$@"; then
                    die_usage "unknown option: $OPT"
                fi
                OPT_N=0
                # shellcheck disable=SC2154  # set by the front-end's agent_parse_option
                while [ "$OPT_N" -lt "$agent_opt_values" ]; do
                    shift
                    OPT_I=$((OPT_I + 1))
                    OPT_N=$((OPT_N + 1))
                done
                ;;
            *)
                set -- "$@" "$OPT"
                ;;
        esac
    done

    if [ "$opt_help" -eq 1 ]; then
        agent_usage
        exit 0
    fi

    # --continue and --resume name different sessions; upstream's precedence when
    # both are passed is unspecified, so refuse the pair instead of guessing.
    if [ "$opt_continue" -eq 1 ] && [ -n "$opt_resume" ]; then
        die_usage "--continue cannot be combined with --resume"
    fi

    load_config
    gateway=$(resolved_gateway)

    # Bare invocation is the one-command session: ensure the sandbox and attach
    # the agent. Explicit commands fall through to the dispatcher below.
    if [ "$#" -eq 0 ]; then
        # shellcheck disable=SC2119  # the session builds its own argv
        cmd_session
    fi

    cmd=$1
    shift

    case $cmd in
        doctor)
            cmd_doctor "$@"
            ;;
        init|up)
            cmd_up "$@"
            ;;
        run)
            cmd_run "$@"
            ;;
        __idle-watch)
            cmd_idle_watch "$@"
            ;;
        upload)
            cmd_upload "$@"
            ;;
        download)
            cmd_download "$@"
            ;;
        status)
            cmd_status "$@"
            ;;
        list)
            cmd_list "$@"
            ;;
        logs)
            cmd_logs "$@"
            ;;
        policy)
            if [ "$#" -eq 0 ]; then
                die_usage "policy requires a subcommand: show, edit, apply, review, approve, reject"
            fi
            sub=$1
            shift
            case $sub in
                show) cmd_policy_show "$@" ;;
                edit) cmd_policy_edit "$@" ;;
                apply) cmd_policy_apply "$@" ;;
                review) cmd_policy_review "$@" ;;
                approve) cmd_policy_approve "$@" ;;
                reject) cmd_policy_reject "$@" ;;
                *) die_usage "unknown policy subcommand: $sub" ;;
            esac
            ;;
        provider)
            if [ "$#" -eq 0 ]; then
                die_usage "provider requires a subcommand: add, attach, list, setup"
            fi
            sub=$1
            shift
            case $sub in
                add) cmd_provider_add "$@" ;;
                attach) cmd_provider_attach "$@" ;;
                list) cmd_provider_list "$@" ;;
                setup) cmd_provider_setup "$@" ;;
                *) die_usage "unknown provider subcommand: $sub" ;;
            esac
            ;;
        start)
            cmd_start "$@"
            ;;
        stop)
            cmd_stop "$@"
            ;;
        rm)
            cmd_rm "$@"
            ;;
        help)
            agent_usage
            ;;
        *)
            agent_dispatch "$cmd" "$@"
            ;;
    esac

    exit 0
}
