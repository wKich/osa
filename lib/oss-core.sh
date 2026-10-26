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

# The shared state root and its published contract, also read by bin/osa.
# shellcheck source-path=SCRIPTDIR source=osa-state.sh disable=SC2154  # repo_root comes from the front-end
. "$repo_root/lib/osa-state.sh"

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
# OpenShell 0.1.5 rejects sandbox names longer than 19 characters (DNS-1123 label).
SANDBOX_NAME_MAX=19

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

CONFIG_KEYS='image policy providers cpu memory sandbox_name engine gateway workdir model tui idle_stop'


parse_config_file() { # FILE
    parse_flat_file "$1" "$CONFIG_KEYS${OSS_AGENT_CONFIG_KEYS:+ $OSS_AGENT_CONFIG_KEYS}"
}

# True when KEY is one of the front-end's own config keys
# (OSS_AGENT_CONFIG_KEYS), loaded into config_agent_<KEY>.
agent_config_key() { # KEY
    case " ${OSS_AGENT_CONFIG_KEYS:-} " in
        *" $1 "*) return 0 ;;
    esac
    return 1
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
    for config_agent_name in ${OSS_AGENT_CONFIG_KEYS:-}; do
        eval "config_agent_$config_agent_name="
    done
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
                # parse_flat_file allows only [a-z][a-z0-9_]* keys, so the
                # eval only ever names a fixed-pattern variable.
                if agent_config_key "$key"; then
                    eval "config_agent_$key=\$value"
                    continue
                fi
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

# Precedence: flag > environment > config > the name registered for this
# project folder > the default pattern. {hash} expands first; a pattern that
# carries it needs no second hash when {project} is shortened.
resolved_name() {
    rn_template=$(resolve_setting \
        "$opt_name" "$(env_setting SANDBOX_NAME)" "$config_sandbox_name" "")
    if [ -z "$rn_template" ]; then
        rn_template=$(registry_lookup_name)
    fi
    if [ -z "$rn_template" ]; then
        rn_template=$DEFAULT_NAME
    fi
    rn_hashed=0
    case $rn_template in
        *'{hash}'*)
            rn_hashed=1
            rn_template=$(printf '%s' "$rn_template" | sed "s/{hash}/$project_hash/g")
            ;;
    esac
    rn_name=$rn_template
    case $rn_template in
        *'{project}'*)
            # Fit {project} into the room the rest of the pattern leaves under
            # OpenShell's limit. A shortened project keeps a stable hash so
            # long names that share a prefix do not collide.
            rn_fixed=$(printf '%s' "$rn_template" | sed 's/{project}//g')
            rn_count=$(printf '%s' "$rn_template" | awk '{ print gsub(/\{project\}/, "") }')
            rn_budget=$(( (SANDBOX_NAME_MAX - ${#rn_fixed}) / rn_count ))
            if [ "$rn_budget" -lt 1 ]; then
                die_usage "sandbox name pattern '$rn_template' is longer than $SANDBOX_NAME_MAX characters; shorten sandbox_name/--name"
            fi
            rn_project=$project_name
            if [ "$rn_hashed" -eq 1 ] && [ "${#rn_project}" -gt "$rn_budget" ]; then
                rn_project=$(printf '%s' "$rn_project" | cut -c1-"$rn_budget" | sed 's/-*$//')
            elif [ "${#rn_project}" -gt "$rn_budget" ]; then
                if [ "$rn_budget" -lt 6 ]; then
                    die_usage "sandbox name pattern '$rn_template' leaves only $rn_budget character(s) for {project}; shorten sandbox_name/--name"
                fi
                rn_keep=$(printf '%s' "$rn_project" | cut -c1-"$((rn_budget - 5))")
                rn_keep=$(printf '%s' "$rn_keep" | sed 's/-*$//')
                rn_hash=$(printf '%s' "$rn_project" | cksum | awk '{ printf "%04x", $1 % 65536 }')
                if [ -z "$rn_keep" ]; then
                    rn_project=$rn_hash
                else
                    rn_project=$rn_keep-$rn_hash
                fi
            fi
            rn_name=$(printf '%s' "$rn_template" | sed "s/{project}/$rn_project/g")
            ;;
    esac
    if [ -z "$rn_name" ]; then
        die_usage "resolved sandbox name is empty; check sandbox_name/--name"
    fi
    case $rn_name in
        *[!a-z0-9-]*)
            die_usage "invalid sandbox name '$rn_name': use lowercase letters, digits, and hyphens"
            ;;
        -*|*-)
            die_usage "invalid sandbox name '$rn_name': do not start or end with a hyphen"
            ;;
    esac
    if [ "${#rn_name}" -gt "$SANDBOX_NAME_MAX" ]; then
        die_usage "sandbox name '$rn_name' is ${#rn_name} characters; OpenShell allows at most $SANDBOX_NAME_MAX"
    fi
    printf '%s' "$rn_name"
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

sandbox_id() { # NAME
    sandbox_id_name=$1
    sandbox_id_json=''
    if sandbox_id_json=$(os sandbox get "$sandbox_id_name" --output json 2>/dev/null); then
        if [ "$have_jq" -eq 1 ]; then
            printf '%s' "$sandbox_id_json" | jq -r '.id // empty'
        else
            printf '%s' "$sandbox_id_json" \
                | sed -n 's/.*"id":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
        fi
        return 0
    fi
    # Older gateways may not accept --output json for a single sandbox; the
    # table form still names the Id.
    sandbox_id_table=''
    sandbox_id_table=$(os sandbox get "$sandbox_id_name" 2>/dev/null) || return 0
    printf '%s\n' "$sandbox_id_table" \
        | sed -n 's/^[[:space:]]*Id:[[:space:]]*//p' | head -n 1
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
    registry_guard "$name"
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
    registry_update "$name" "$(sandbox_id "$name")" 0 0
    say "Sandbox '$name' is ready. Next: $PROGRAM (the session refreshes the workspace)."
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
    printf '%s/sessions/%s' "$state_root" "$1"
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
mkdir -p "$gitdir" "$worktree"
git init -q
git add -A
tree=$(git write-tree)
commit=$(git commit-tree "$tree" -m "'"$PROGRAM"' baseline")
git update-ref refs/'"$PROGRAM"'/base "$commit"
printf "%s\n" "$tree"'

# shellcheck disable=SC2016  # expanded by the sandbox shell, not this one
SANDBOX_PROBE_SCRIPT='set -e
gitdir=$1 worktree=$2
export GIT_DIR=$gitdir GIT_WORK_TREE=$worktree
if ! git rev-parse -q --verify refs/'"$PROGRAM"'/base >/dev/null 2>&1; then
    printf "missing\n"
    exit 0
fi
index=$gitdir/tree-index.$$
rm -f "$index"
if ! GIT_INDEX_FILE=$index git add -A 2>/dev/null; then
    rm -f "$index"
    printf "missing\n"
    exit 0
fi
tree=$(GIT_INDEX_FILE=$index git write-tree)
rm -f "$index"
printf "%s\n" "$tree"'

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

# shellcheck disable=SC2016  # expanded by the sandbox shell, not this one
SANDBOX_RESULT_TREE_SCRIPT='set -e
export GIT_DIR=$1
git rev-parse -q --verify refs/'"$PROGRAM"'/result^{tree} 2>/dev/null || true'

# shellcheck disable=SC2016  # expanded by the sandbox shell, not this one
SANDBOX_TREE_EMPTY_SCRIPT='set -e
export GIT_DIR=$1
tree=$3
if [ -z "$tree" ] || [ -z "$(git ls-tree -r --name-only "$tree" 2>/dev/null | head -n 1)" ]; then
    printf "empty\n"
else
    printf "nonempty\n"
fi'

# shellcheck disable=SC2016  # expanded by the sandbox shell, not this one
SANDBOX_WORKDIR_NONEMPTY_SCRIPT='set -e
worktree=$2
if [ -n "$(find "$worktree" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
    printf "nonempty\n"
else
    printf "empty\n"
fi'

# shellcheck disable=SC2016  # expanded by the sandbox shell, not this one
SANDBOX_PRUNE_SCRIPT='set -e
worktree=$2
manifest=$3
while IFS= read -r path; do
    case $path in
        ""|/*|..|../*|*/..|*/../*) continue ;;
    esac
    target=$worktree/$path
    if [ -f "$target" ] || [ -L "$target" ]; then
        rm -f -- "$target"
    fi
done < "$manifest"
rm -f -- "$manifest"'

sandbox_script() { # NAME WORKDIR SCRIPT
    ss_name=$1
    ss_workdir=$2
    ss_script=$3
    os sandbox exec -n "$ss_name" --no-login-shell --workdir "$ss_workdir" -- \
        sh -c "$ss_script" "$PROGRAM-git" "$(sandbox_git_dir "$ss_workdir")" "$ss_workdir"
}

sandbox_script_extra() { # NAME WORKDIR SCRIPT EXTRA
    sse_name=$1
    sse_workdir=$2
    sse_script=$3
    sse_extra=$4
    os sandbox exec -n "$sse_name" --no-login-shell --workdir "$sse_workdir" -- \
        sh -c "$sse_script" "$PROGRAM-git" "$(sandbox_git_dir "$sse_workdir")" \
        "$sse_workdir" "$sse_extra"
}

# Creates the workdir before an exec that needs --workdir. A sandbox created
# by a concurrent run, or by `up` before the first refresh, may not have it.
sandbox_mkdir() { # NAME WORKDIR
    # shellcheck disable=SC2016  # expanded by the sandbox shell, not this one
    os sandbox exec -n "$1" --no-login-shell -- \
        sh -c 'mkdir -p "$1"' "$PROGRAM-git" "$2" >/dev/null 2>&1
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

# ---------------------------------------------------------------------------
# Project registry (the contract and its helpers are in lib/osa-state.sh)
# ---------------------------------------------------------------------------

registry_file() { # NAME
    printf '%s/%s.toml' "$registry_dir" "$1"
}

# Prints the sandbox name registered for this project folder and agent.
registry_lookup_name() {
    [ -d "$registry_dir" ] || return 0
    for rl_file in "$registry_dir"/*.toml; do
        [ -f "$rl_file" ] || continue
        [ "$(flat_value "$rl_file" agent)" = "$OSS_AGENT_TAG" ] || continue
        [ "$(flat_value "$rl_file" host_path)" = "$project_path" ] || continue
        flat_value "$rl_file" sandbox_name
        return 0
    done
}

# Refuses, before any gateway call, a sandbox name that another project folder
# already owns: sharing it would mix two projects' sync state.
registry_guard() { # NAME
    rg_path=$(flat_value "$(registry_file "$1")" host_path)
    if [ -n "$rg_path" ] && [ "$rg_path" != "$project_path" ]; then
        die_usage "sandbox name '$1' is registered to $rg_path; choose another name with --name"
    fi
}

# Creates or updates this project's registry entry for NAME. SANDBOX_ID
# replaces the recorded ID when given; SESSION=1 stamps last_session;
# FINGERPRINT=1 records the current host fingerprint (omitted for a plain
# folder). An entry owned by another folder is never rewritten. Failures warn
# and never stop the caller.
registry_update() { # NAME SANDBOX_ID SESSION FINGERPRINT
    ru_file=$(registry_file "$1")
    ru_id=$2
    ru_created=
    ru_last=
    ru_fp=
    if [ -f "$ru_file" ]; then
        ru_owner=$(flat_value "$ru_file" host_path)
        if [ -n "$ru_owner" ] && [ "$ru_owner" != "$project_path" ]; then
            return 0
        fi
        ru_created=$(flat_value "$ru_file" created)
        ru_last=$(flat_value "$ru_file" last_session)
        ru_fp=$(flat_value "$ru_file" fingerprint)
        if [ -z "$ru_id" ]; then
            ru_id=$(flat_value "$ru_file" sandbox_id)
        fi
    fi
    ru_now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    if [ -z "$ru_created" ]; then
        ru_created=$ru_now
    fi
    if [ "$3" -eq 1 ]; then
        ru_last=$ru_now
    fi
    if [ "$4" -eq 1 ]; then
        ru_fp=$(project_fingerprint "$project_path")
    fi
    if ! (umask 077 && mkdir -p "$registry_dir"); then
        warn "cannot create the project registry in $registry_dir"
        return 0
    fi
    set -- "$ru_file" version "$STATE_VERSION" agent "$OSS_AGENT_TAG" \
        host_path "$project_path" project "$project_name" sandbox_name "$1" \
        sandbox_id "$ru_id" created "$ru_created" last_session "$ru_last"
    if [ -n "$ru_fp" ]; then
        set -- "$@" fingerprint "$ru_fp"
    fi
    flat_write "$@" || warn "cannot write the registry entry $ru_file"
}

registry_remove() { # NAME
    rm -f "$(registry_file "$1")"
}


archive_state_dir() { # STATE_DIR REASON
    archive_dir=$1
    archive_reason=$2
    [ -d "$archive_dir" ] || return 0
    archive_stamp=$(date +%Y%m%d%H%M%S)-$$
    archive_dest=$archive_dir.archive-$archive_stamp
    if ! mv -- "$archive_dir" "$archive_dest" 2>/dev/null; then
        warn "cannot archive the previous sandbox state at $archive_dir ($archive_reason)"
        return 1
    fi
    if ! (umask 077 && mkdir -p "$archive_dir" && chmod 700 "$archive_dir" 2>/dev/null); then
        warn "archived the previous state to $archive_dest but cannot recreate $archive_dir"
        return 1
    fi
    note "Archived the previous sandbox state to $archive_dest ($archive_reason)."
    return 0
}

# Records the host tree, the sandbox tree, and the sandbox instance that were
# in sync at upload or after a clean apply. A clean filter (LFS) or a submodule
# hashes differently on each side, so comparing the two trees directly calls a
# fresh sandbox stale; each side is compared with its own earlier value.
write_synced_marker() { # STATE_DIR HOST_TREE SANDBOX_TREE [SANDBOX_ID]
    [ -n "$3" ] || return 0
    synced_tmp=$1/synced.$$
    if ! (
        umask 077
        {
            printf 'host_tree=%s\n' "${2:-}"
            printf 'sandbox_tree=%s\n' "$3"
            printf 'sandbox_id=%s\n' "${4:-}"
        } >"$synced_tmp"
    ); then
        rm -f "$synced_tmp"
        return 0
    fi
    mv -- "$synced_tmp" "$1/synced" 2>/dev/null || { rm -f "$synced_tmp"; return 0; }
    # A recorded pair is a sync point: the host fingerprint moves with it.
    registry_update "$(basename -- "$1")" "${4:-}" 0 1
}

# Writes the path list of TREE to STATE_DIR/host_manifest. The list travels
# with the tree so a later refresh can prune tracked deletions without
# depending on a possibly garbage-collected tree object.
write_host_manifest() { # STATE_DIR TREE
    whm_dir=$1
    whm_tree=$2
    [ -n "$whm_tree" ] || return 0
    whm_tmp=$whm_dir/host_manifest.$$
    if (umask 077 && git ls-tree -r --name-only "$whm_tree" >"$whm_tmp" 2>/dev/null); then
        mv -- "$whm_tmp" "$whm_dir/host_manifest" 2>/dev/null || rm -f "$whm_tmp"
    else
        rm -f "$whm_tmp"
    fi
}

# Builds a tree for a project the helper treats as plain (not a repository
# root, or no HEAD yet) so freshness and pruning still work when git exists.
capture_plain_tree() { # STATE_DIR
    cpt_state=$1
    cpt_dir=${TMPDIR:-/tmp}/$OSS_TMP_PREFIX-tree.$$
    rm -rf "$cpt_dir"
    if ! (umask 077 && git init -q "$cpt_dir" 2>/dev/null); then
        rm -rf "$cpt_dir"
        return 0
    fi
    cpt_index=$cpt_dir/index
    cpt_tree=
    if GIT_DIR=$cpt_dir/.git GIT_WORK_TREE=$PWD GIT_INDEX_FILE=$cpt_index \
        git add -A 2>/dev/null; then
        cpt_tree=$(GIT_DIR=$cpt_dir/.git GIT_INDEX_FILE=$cpt_index \
            git write-tree 2>/dev/null) || cpt_tree=
    fi
    if [ -n "$cpt_tree" ]; then
        bl_mode=plain
        bl_git=1
        bl_tree=$cpt_tree
        bl_dirty=0
        bl_base=
        bl_ok=1
        cpt_manifest=$cpt_state/host_manifest.$$
        if (umask 077 && GIT_DIR=$cpt_dir/.git \
            git ls-tree -r --name-only "$cpt_tree" >"$cpt_manifest" 2>/dev/null); then
            mv -- "$cpt_manifest" "$cpt_state/host_manifest" 2>/dev/null \
                || rm -f "$cpt_manifest"
        else
            rm -f "$cpt_manifest"
        fi
    fi
    rm -rf "$cpt_dir"
    return 0
}

# Records the host tree in the state directory. A clean repository uses HEAD;
# a dirty or untracked one gets a synthetic commit built from a temporary
# index, so the user's index, branch, and working tree are untouched. A plain
# project uses a temporary repository when git is available; otherwise the
# freshness check falls back to the recorded sandbox tree.
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
    if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        capture_plain_tree "$1"
        return 0
    fi
    bl_root=$(git rev-parse --show-toplevel 2>/dev/null) || bl_root=
    bl_pwd=$(pwd -P)
    # The upload sends $PWD, not the repository root, so a subdirectory is
    # treated as a plain project and uses the patch check instead.
    if [ -z "$bl_root" ] || [ "$bl_root" != "$bl_pwd" ]; then
        capture_plain_tree "$1"
        return 0
    fi
    if ! git rev-parse -q --verify HEAD >/dev/null 2>&1; then
        capture_plain_tree "$1"
        return 0
    fi
    bl_branch=$(git symbolic-ref --short -q HEAD 2>/dev/null) || bl_branch=
    bl_commit=$(git rev-parse -q --verify HEAD) || bl_commit=
    bl_tree=$(git rev-parse -q --verify "HEAD^{tree}") || bl_tree=
    if [ -z "$bl_commit" ] || [ -z "$bl_tree" ]; then
        capture_plain_tree "$1"
        return 0
    fi
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
            capture_plain_tree "$1"
            [ "$bl_ok" -eq 1 ] \
                || warn "cannot snapshot the working tree; this session will use the patch check"
            return 0
        fi
        rm -f "$bl_index"
    fi
    bl_git=1
    bl_ok=1
    write_host_manifest "$1" "$bl_tree"
}

write_session_baseline() { # DIR NAME WORKDIR SANDBOX_TREE STATE STALE UPLOAD SANDBOX_ID
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
            printf 'state=%s\n' "$5"
            printf 'stale=%s\n' "$6"
            printf 'upload=%s\n' "$7"
            printf 'sandbox_id=%s\n' "${8:-}"
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
    if [ -n "$refresh_sandbox_tree" ]; then
        write_synced_marker "$sync_state_dir" "$bl_tree" "$refresh_sandbox_tree" "${sync_sandbox_id:-}"
    fi
}

# Copies the host manifest that capture_host_baseline just wrote to the
# manifest that belongs to the newly recorded pair. The next refresh uses it
# to prune files the host deleted.
record_host_manifest() { # STATE_DIR
    rhm_dir=$1
    [ -f "$rhm_dir/host_manifest" ] || return 0
    rhm_tmp=$rhm_dir/manifest.$$
    if (umask 077 && cp "$rhm_dir/host_manifest" "$rhm_tmp" 2>/dev/null); then
        mv -- "$rhm_tmp" "$rhm_dir/manifest" 2>/dev/null || rm -f "$rhm_tmp"
    else
        rm -f "$rhm_tmp"
    fi
}

# Removes tracked files that the previous refresh put in the sandbox but the
# host no longer has. Ignored sandbox artifacts are not in the old manifest,
# so they survive. Paths with tabs or newlines keep the existing manifest
# limitation.
prune_old_paths() { # NAME WORKDIR STATE_DIR
    pop_name=$1
    pop_workdir=$2
    pop_dir=$3
    pop_current=$pop_dir/host_manifest
    [ -f "$pop_current" ] || return 0
    pop_old_list=$pop_dir/prune-old.$$
    pop_new_list=$pop_dir/prune-new.$$
    pop_list=$pop_dir/prune-list.$$
    if [ -f "$pop_dir/manifest" ]; then
        LC_ALL=C sort "$pop_dir/manifest" >"$pop_old_list" 2>/dev/null \
            || : >"$pop_old_list"
    elif [ -n "$synced_host_tree" ] \
        && git cat-file -e "$synced_host_tree" 2>/dev/null; then
        if ! git ls-tree -r --name-only "$synced_host_tree" 2>/dev/null \
            | LC_ALL=C sort >"$pop_old_list"; then
            : >"$pop_old_list"
        fi
    else
        rm -f "$pop_old_list" "$pop_new_list" "$pop_list"
        return 0
    fi
    LC_ALL=C sort "$pop_current" >"$pop_new_list" 2>/dev/null \
        || : >"$pop_new_list"
    comm -23 "$pop_old_list" "$pop_new_list" >"$pop_list" 2>/dev/null \
        || : >"$pop_list"
    if [ -s "$pop_list" ]; then
        chmod 600 "$pop_list" 2>/dev/null || true
        pop_dest=$(dirname -- "$pop_workdir")/$OSS_TMP_PREFIX-prune.$$
        if os sandbox upload "$pop_name" "$pop_list" "$pop_dest" >/dev/null 2>&1; then
            if ! sandbox_script_extra "$pop_name" "$pop_workdir" \
                "$SANDBOX_PRUNE_SCRIPT" "$pop_dest" >/dev/null 2>&1; then
                warn "could not prune tracked files removed on the host"
            fi
        else
            warn "could not send the tracked-deletion list to the sandbox"
        fi
    fi
    rm -f "$pop_old_list" "$pop_new_list" "$pop_list"
    return 0
}

refresh_sandbox_workspace() { # NAME WORKDIR STATE_DIR
    rsw_name=$1
    rsw_workdir=$2
    rsw_dir=$3
    if [ "$opt_no_git_ignore" -eq 0 ]; then
        prune_old_paths "$rsw_name" "$rsw_workdir" "$rsw_dir" || true
    fi
    note "Refreshing the workspace from the host..."
    set -- sandbox upload
    if [ "$opt_no_git_ignore" -eq 1 ]; then
        set -- "$@" --no-git-ignore
    fi
    set -- "$@" "$rsw_name" . "$rsw_workdir"
    run_gateway "$@"
    if ! rsw_tree=$(sandbox_script "$rsw_name" "$rsw_workdir" \
        "$SANDBOX_INIT_SCRIPT" 2>/dev/null); then
        warn "uploaded, but could not record the sandbox baseline for '$rsw_name'"
        return 1
    fi
    record_host_manifest "$rsw_dir"
    write_synced_marker "$rsw_dir" "$bl_tree" "$rsw_tree" "$sync_sandbox_id"
    sync_sandbox_tree=$rsw_tree
    note "Refreshed the workspace from the host."
    return 0
}

# A retained patch whose change is already in the host tree no longer needs
# review. Only git can check the reverse cleanly; without git the notice stays.
retained_patch_applied() { # PATCH
    [ -n "$1" ] && [ -f "$1" ] || return 1
    command -v git >/dev/null 2>&1 || return 1
    git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1
    git apply --reverse --check "$1" >/dev/null 2>&1
}

# A retained marker covers the sandbox when its result tree matches (or when
# it predates result trees). Otherwise it is only an advisory notice.
retained_covers_sandbox() {
    [ "$sync_pending_kind" = retained ] || return 1
    [ -z "$sync_pending_result_tree" ] \
        || [ "$sync_pending_result_tree" = "$sync_sandbox_tree" ]
}

# Classifies the workspace from the recorded pair and the current trees.
# Sets sync_state and sync_needs_refresh; never writes.
sync_classify() {
    sync_state=clean
    sync_needs_refresh=0
    if [ "$sync_pending_kind" = parked ]; then
        sync_state=parked
        return 0
    fi
    if [ "$sync_created" -eq 1 ]; then
        sync_state=behind
        sync_needs_refresh=1
        return 0
    fi
    if [ "$sync_probe_ok" -eq 0 ]; then
        sync_state=parked
        return 0
    fi
    if [ "$sync_pending_kind" = retained ] \
        && [ -n "$sync_pending_result_tree" ] \
        && [ "$sync_pending_result_tree" = "$sync_sandbox_tree" ]; then
        sync_state=retained
        sync_needs_refresh=1
        return 0
    fi
    if [ "$bl_ok" -eq 1 ]; then
        if [ -z "$synced_host_tree" ] || [ -z "$synced_sandbox_tree" ]; then
            if [ "$sync_sandbox_tree" = "$bl_tree" ]; then
                sync_state=clean
                if retained_covers_sandbox; then
                    sync_state=retained
                fi
            elif [ "$sync_sandbox_empty" -eq 1 ]; then
                sync_state=behind
                sync_needs_refresh=1
            else
                sync_state=parked
            fi
            return 0
        fi
        if [ "$sync_sandbox_tree" != "$synced_sandbox_tree" ]; then
            if [ "$sync_pending_kind" = retained ] \
                && [ -n "$sync_pending_result_tree" ] \
                && [ "$sync_pending_result_tree" = "$sync_sandbox_tree" ]; then
                sync_state=retained
                sync_needs_refresh=1
            else
                sync_state=parked
            fi
            return 0
        fi
        if [ "$bl_tree" != "$synced_host_tree" ]; then
            sync_state=behind
            sync_needs_refresh=1
        else
            sync_state=clean
            if retained_covers_sandbox; then
                sync_state=retained
            fi
        fi
        return 0
    fi
    # The host has no tree (no git). Compare the sandbox with its own last
    # value; a sandbox that did not move is safe to refresh from the host.
    if [ -z "$synced_sandbox_tree" ]; then
        sync_state=clean
        if retained_covers_sandbox; then
            sync_state=retained
        fi
        return 0
    fi
    if [ "$sync_sandbox_tree" != "$synced_sandbox_tree" ]; then
        if [ "$sync_pending_kind" = retained ] \
            && [ -n "$sync_pending_result_tree" ] \
            && [ "$sync_pending_result_tree" = "$sync_sandbox_tree" ]; then
            sync_state=retained
            sync_needs_refresh=1
        else
            sync_state=parked
        fi
        return 0
    fi
    sync_state=behind
    sync_needs_refresh=1
}

# Captures the host baseline, records or reads the sandbox baseline, classifies
# the workspace, refreshes it when safe, and blocks a parked one. Runs before
# Maki attaches.
prepare_session_sync() { # NAME CREATED
    prepare_name=$1
    prepare_created=$2
    sync_name=$prepare_name
    sync_workdir=$(resolved_workdir)
    sync_state_dir=$(session_state_dir "$prepare_name")
    sync_blocked=0
    sync_state=clean
    sync_needs_refresh=0
    sync_stale=0
    sync_upload=filtered
    sync_pending_patch=
    sync_pending_kind=
    sync_pending_result_tree=
    sync_pending_id=
    sync_sandbox_id=
    sync_sandbox_tree=
    sync_probe_ok=0
    sync_sandbox_empty=0
    sync_result_tree=
    synced_host_tree=
    synced_sandbox_tree=
    synced_sandbox_id=
    sync_created=$prepare_created
    bl_mode=plain
    bl_git=0
    bl_branch=
    bl_commit=
    bl_tree=
    bl_dirty=0
    bl_base=
    bl_ok=0
    if ! (umask 077 && mkdir -p "$sync_state_dir" && chmod 700 "$sync_state_dir" 2>/dev/null); then
        warn "cannot create session state directory $sync_state_dir; changes will stay in the sandbox"
        return 0
    fi
    # A new sandbox instance cannot own the previous instance's unresolved
    # patch or recorded trees. Archive that state before reading it.
    if [ "$prepare_created" -eq 1 ] \
        && { [ -f "$sync_state_dir/pending" ] \
            || [ -f "$sync_state_dir/synced" ] \
            || [ -f "$sync_state_dir/baseline" ]; }; then
        archive_state_dir "$sync_state_dir" "new sandbox instance" || true
    fi
    sync_sandbox_id=$(sandbox_id "$prepare_name")
    if [ -f "$sync_state_dir/synced" ]; then
        synced_host_tree=$(read_baseline "$sync_state_dir/synced" host_tree)
        synced_sandbox_tree=$(read_baseline "$sync_state_dir/synced" sandbox_tree)
        synced_sandbox_id=$(read_baseline "$sync_state_dir/synced" sandbox_id)
    fi
    if [ -z "$synced_sandbox_id" ] && [ -f "$sync_state_dir/baseline" ]; then
        synced_sandbox_id=$(read_baseline "$sync_state_dir/baseline" sandbox_id)
    fi
    if [ -n "$sync_sandbox_id" ] && [ -n "$synced_sandbox_id" ] \
        && [ "$sync_sandbox_id" != "$synced_sandbox_id" ]; then
        archive_state_dir "$sync_state_dir" "sandbox id changed" || true
        synced_host_tree=
        synced_sandbox_tree=
        synced_sandbox_id=
    fi
    if [ -f "$sync_state_dir/pending" ]; then
        sync_pending_patch=$(flat_value "$sync_state_dir/pending" patch)
        sync_pending_kind=$(flat_value "$sync_state_dir/pending" kind)
        sync_pending_result_tree=$(flat_value "$sync_state_dir/pending" result_tree)
        sync_pending_id=$(flat_value "$sync_state_dir/pending" sandbox_id)
        if [ -z "$sync_pending_kind" ]; then
            if [ -n "$sync_pending_patch" ] && [ -s "$sync_pending_patch" ]; then
                sync_pending_kind=retained
            else
                sync_pending_kind=parked
            fi
        fi
        if [ -n "$sync_pending_id" ] && [ -n "$sync_sandbox_id" ] \
            && [ "$sync_pending_id" != "$sync_sandbox_id" ]; then
            note "Ignoring a pending marker from a previous sandbox instance."
            rm -f "$sync_state_dir/pending"
            sync_pending_patch=
            sync_pending_kind=
            sync_pending_result_tree=
            sync_pending_id=
        fi
    fi
    capture_host_baseline "$sync_state_dir"
    if [ "$prepare_created" -eq 1 ]; then
        sync_probe_ok=1
    else
        sandbox_mkdir "$prepare_name" "$sync_workdir" || true
        if sync_probe=$(sandbox_script "$prepare_name" "$sync_workdir" \
            "$SANDBOX_PROBE_SCRIPT" 2>/dev/null); then
            sync_probe_ok=1
            if [ "$sync_probe" = missing ]; then
                note "Adopting the sandbox workspace as the baseline for '$prepare_name'."
                if sync_sandbox_tree=$(sandbox_script "$prepare_name" "$sync_workdir" \
                    "$SANDBOX_INIT_SCRIPT" 2>/dev/null); then
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
        warn "cannot read or record the sandbox baseline for '$prepare_name'"
    fi
    if [ "$opt_no_git_ignore" -eq 1 ]; then
        sync_upload=unfiltered
        note "Automatic worktree apply is off for --no-git-ignore uploads; the patch is applied with the plain check."
    fi
    if [ -z "$synced_sandbox_tree" ] && [ -z "$sync_pending_kind" ] \
        && [ -f "$sync_state_dir/baseline" ]; then
        synced_sandbox_tree=$(read_baseline "$sync_state_dir/baseline" sandbox_tree)
    fi
    if [ "$bl_ok" -eq 1 ] && [ "$sync_probe_ok" -eq 1 ] \
        && [ -z "$synced_sandbox_tree" ] && [ -n "$sync_sandbox_tree" ] \
        && [ "$sync_sandbox_tree" != "$bl_tree" ]; then
        case $(sandbox_script_extra "$prepare_name" "$sync_workdir" \
            "$SANDBOX_TREE_EMPTY_SCRIPT" "$sync_sandbox_tree" 2>/dev/null) in
            empty) sync_sandbox_empty=1 ;;
        esac
    fi
    sync_classify
    # A retained patch whose change is already in the host tree no longer needs
    # review. Clearing it also lets a refresh overwrite the covered output.
    if [ "$sync_state" = retained ] && retained_patch_applied "$sync_pending_patch"; then
        note "The retained patch is already applied; clearing the notice."
        rm -f "$sync_state_dir/pending"
        sync_pending_kind=
        sync_pending_result_tree=
        sync_pending_id=
        if [ "$bl_ok" -eq 1 ] && [ "$bl_tree" = "$sync_sandbox_tree" ]; then
            sync_state=clean
            sync_needs_refresh=0
            # The sandbox already holds the applied result; move its base so
            # the exit collection does not report the same change again.
            advance_sandbox_baseline
        else
            sync_state=behind
            sync_needs_refresh=1
        fi
    fi
    if [ "$sync_state" = parked ]; then
        sync_stale=1
        note "Workspace '$prepare_name' is parked: it holds changes with no durable patch."
        write_pending "${sync_pending_patch:-}" "workspace parked" "parked" \
            "${sync_sandbox_tree:-}" || true
        recovery_block "parked" "${sync_pending_patch:-}"
        write_session_baseline "$sync_state_dir" "$prepare_name" "$sync_workdir" \
            "${sync_sandbox_tree:-}" "parked" "$sync_stale" "$sync_upload" "$sync_sandbox_id" || true
        sync_blocked=1
        return 0
    fi
    if [ "$sync_needs_refresh" -eq 1 ] || [ "$prepare_created" -eq 1 ]; then
        if ! refresh_sandbox_workspace "$prepare_name" "$sync_workdir" "$sync_state_dir"; then
            sync_state=parked
            sync_stale=1
            write_pending "" "refresh failed" "parked" ""
            recovery_block "parked" ""
            write_session_baseline "$sync_state_dir" "$prepare_name" "$sync_workdir" \
                "" "parked" "$sync_stale" "$sync_upload" "$sync_sandbox_id" || true
            sync_blocked=1
            return 0
        fi
        sync_state=clean
        if [ "$sync_pending_kind" = retained ]; then
            sync_state=retained
            note "Retained patch for review: $sync_pending_patch"
        fi
    else
        if [ "$sync_probe_ok" -eq 1 ] && [ -n "$sync_sandbox_tree" ] \
            && { [ -z "$synced_sandbox_tree" ] || [ -z "$synced_host_tree" ]; }; then
            write_synced_marker "$sync_state_dir" "$bl_tree" "$sync_sandbox_tree" \
                "$sync_sandbox_id"
            record_host_manifest "$sync_state_dir"
        fi
        note "Workspace is already current; the baseline matches the host."
        if [ "$sync_state" = retained ] && [ -n "$sync_pending_patch" ]; then
            note "Retained patch for review: $sync_pending_patch"
        fi
    fi
    write_session_baseline "$sync_state_dir" "$prepare_name" "$sync_workdir" \
        "${sync_sandbox_tree:-}" "$sync_state" "$sync_stale" "$sync_upload" \
        "$sync_sandbox_id" || true
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
write_pending() { # PATCH REASON [KIND] [RESULT_TREE]
    [ -n "${sync_state_dir:-}" ] || return 0
    wp_patch=${1:-}
    wp_reason=${2:-}
    wp_kind=${3:-}
    wp_result_tree=${4:-}
    case $wp_kind in
        retained|parked) ;;
        *)
            if [ -n "$wp_patch" ] && [ -s "$wp_patch" ]; then
                wp_kind=retained
            else
                wp_kind=parked
            fi
            ;;
    esac
    flat_write "$sync_state_dir/pending" version "$STATE_VERSION" kind "$wp_kind" \
        patch "$wp_patch" sandbox "${sync_name:-}" sandbox_id "${sync_sandbox_id:-}" \
        created "$(date -u +%Y-%m-%dT%H:%M:%SZ)" reason "$wp_reason" \
        result_tree "$wp_result_tree" \
        || warn "cannot write the pending marker in $sync_state_dir"
    sync_pending_patch=$wp_patch
    sync_pending_kind=$wp_kind
    sync_pending_result_tree=$wp_result_tree
    sync_pending_id=${sync_sandbox_id:-}
}

# shellcheck disable=SC2329  # reached through the sync exit path
recovery_block() { # KIND [PATCH]
    recovery_kind=${1:-parked}
    recovery_patch=${2:-}
    recovery_name=${sync_name:-$(resolved_name)}
    recovery_workdir=${sync_workdir:-$(resolved_workdir)}
    if [ "$recovery_kind" = retained ]; then
        note "The sandbox patch is retained for review; the workspace can be refreshed."
        note "  sandbox:   $recovery_name"
        note "  workspace: $recovery_workdir"
        note "  inspect:   openshell sandbox connect $recovery_name"
        note "  copy one:  $PROGRAM download $recovery_workdir/PATH ./DEST"
        note "  download:  $PROGRAM download $recovery_workdir ./DEST"
        if [ -n "$recovery_patch" ]; then
            note "  patch:     $recovery_patch"
            note "  review:    git apply --3way '$recovery_patch'"
        fi
        note "  next:      $PROGRAM (the next session refreshes from the host)"
        return 0
    fi
    err "sandbox changes are not in the host project; the workspace is parked"
    err "  sandbox:   $recovery_name"
    err "  workspace: $recovery_workdir"
    err "  inspect:   openshell sandbox connect $recovery_name"
    err "  copy one:  $PROGRAM download $recovery_workdir/PATH ./DEST"
    err "  download:  $PROGRAM download $recovery_workdir ./DEST"
    if [ -n "$recovery_patch" ] && [ -f "$recovery_patch" ]; then
        err "  patch:     $recovery_patch"
    fi
    err "  discard:   $PROGRAM upload --discard   (or $PROGRAM rm --discard)"
    err "  pending:   ${sync_state_dir:-state}/pending"
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
    sync_result_tree=$(sandbox_script "$sync_name" "$sync_workdir" \
        "$SANDBOX_RESULT_TREE_SCRIPT" 2>/dev/null) || sync_result_tree=
    return 0
}

# Collects changes, applies them when the safety check passes, and leaves a
# retained or parked marker otherwise. Always returns 0 so it cannot change
# Maki's exit code; output stays on stderr.
# shellcheck disable=SC2329  # invoked via trap and by sync_exit_hook
sync_project_back() {
    if [ "$sync_finished" -eq 1 ]; then
        return 0
    fi
    sync_finished=1
    sync_name=${sync_name:-$(resolved_name)}
    sync_workdir=${sync_workdir:-$(resolved_workdir)}
    sync_state_dir=${sync_state_dir:-$(session_state_dir "$sync_name")}
    if [ "$opt_no_sync" -eq 1 ]; then
        write_pending "" "no-sync" "parked" ""
        note "Skipped download (--no-sync); the workspace is parked."
        recovery_block "parked" ""
        announce_pending_proposals "$sync_name"
        return 0
    fi
    sync_stamp=$(date +%Y%m%d%H%M%S)-$$
    patch_file=$sync_state_dir/patch-$sync_stamp.patch
    if ! collect_sandbox_patch "$patch_file"; then
        write_pending "" "collection failed" "parked" ""
        recovery_block "parked" "$patch_file"
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
            write_pending "$patch_file" "apply failed" "retained" "$sync_result_tree"
            recovery_block "retained" "$patch_file"
        elif [ "$apply_rc" -eq 2 ]; then
            recovery_block "${sync_pending_kind:-retained}" "$patch_file"
        fi
    fi
    announce_pending_proposals "$sync_name"
    return 0
}

# shellcheck disable=SC2329  # reached through the sync exit path
apply_sandbox_patch() { # PATCH
    apply_patch=$1
    apply_mode=$bl_mode
    apply_upload=${sync_upload:-}
    if [ "${sync_state:-}" = parked ]; then
        note "The workspace is parked; keeping this patch for review."
        write_pending "$apply_patch" "parked" "parked" "$sync_result_tree"
        return 2
    fi
    if [ "${sync_probe_ok:-1}" -eq 0 ]; then
        note "Cannot verify the sandbox baseline; keeping this patch for review."
        write_pending "$apply_patch" "unverified baseline" "retained" "$sync_result_tree"
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
        write_pending "$wa_patch" "conflict" "retained" "$sync_result_tree"
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
        write_pending "$wa_patch" "dirty baseline" "retained" "$sync_result_tree"
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
        write_pending "$wa_patch" "host moved" "retained" "$sync_result_tree"
        return 2
    fi
    if ! git merge --ff-only "$wa_result" >&2; then
        warn "fast-forward failed; branch '$wa_name' and worktree '$wa_wt' are kept"
        write_pending "$wa_patch" "fast-forward failed" "retained" "$sync_result_tree"
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
            write_pending "$plain_patch" "conflict" "retained" "$sync_result_tree"
            return 2
        fi
        if ! git apply "$plain_patch" >&2; then
            warn "applying the sandbox patch failed; $PWD was left unchanged"
            return 1
        fi
        advance_sandbox_baseline
        refresh_synced_marker
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
        write_pending "$plain_patch" "conflict" "retained" "$sync_result_tree"
        return 2
    fi
    if ! patch -p1 --forward <"$plain_patch" >&2; then
        warn "applying the sandbox patch failed; $PWD was left unchanged"
        return 1
    fi
    advance_sandbox_baseline
    refresh_synced_marker
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
    write_pending "$export_patch" "binary export" "retained" "$sync_result_tree"
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

# A reused sandbox still holds an earlier copy of the project. The prepare
# routine refreshes it when the host moved and leaves it alone when the trees
# already match.
announce_sandbox_reuse() { # NAME
    note "Reusing '$1'; changes are collected as a patch on exit, and the workspace is checked before Maki runs."
}

ensure_project_sandbox() {
    ensure_provider_list
    name=$(resolved_name)
    registry_guard "$name"
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
    # Enable the advisor before Maki attaches so the agent can submit a
    # network-rule proposal and wait for a human decision. Covers both the
    # created and reused paths; `up` never reaches this function.
    enable_policy_advisor "$name" || true
    # Register before the sync so a first upload can record its fingerprint.
    registry_update "$name" "" 1 0
    prepare_session_sync "$name" "$ensure_sandbox_created"
    if [ -n "${sync_sandbox_id:-}" ]; then
        registry_update "$name" "$sync_sandbox_id" 0 0
    fi
    if [ "${sync_blocked:-0}" -eq 1 ]; then
        exit "$EX_USAGE"
    fi
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

# Agent argv and exec env. A hook adds words with argv_add and non-secret
# per-exec environment values with env_add; the core expands both lists with
# eval "set -- ...". Each word is single-quoted by parameter expansion alone
# (no subshell), so quotes and trailing newlines in a prompt survive.
agent_argv=
agent_env=

# Sets oss_quoted to WORD with every single quote escaped for '...'.
oss_quote() { # WORD
    argv_rest=$1
    oss_quoted=
    while :; do
        case $argv_rest in
            *\'*)
                argv_head=${argv_rest%%\'*}
                oss_quoted="$oss_quoted$argv_head'\\''"
                argv_rest=${argv_rest#*\'}
                ;;
            *)
                oss_quoted=$oss_quoted$argv_rest
                break
                ;;
        esac
    done
}

argv_add() { # WORD...
    for argv_word in "$@"; do
        oss_quote "$argv_word"
        agent_argv="$agent_argv '$oss_quoted'"
    done
}

# Adds `--env KEY=VALUE` to the agent's `sandbox exec`. Only for non-secret
# values: the key goes through the same credential-name guard as --env.
env_add() { # KEY=VALUE
    case $1 in
        *=*) ;;
        *) die_usage "agent exec environment expects KEY=VALUE, got '$1'" ;;
    esac
    env_add_key=${1%%=*}
    case $env_add_key in
        ''|[!A-Za-z_]*|*[!A-Za-z0-9_]*)
            die_usage "agent exec environment key must match [A-Za-z_][A-Za-z0-9_]*; got '$env_add_key'"
            ;;
    esac
    if credential_like "$env_add_key" && ! env_key_allowed "$env_add_key"; then
        env_refusal --env "$env_add_key"
    fi
    oss_quote "$1"
    agent_env="$agent_env '--env' '$oss_quoted'"
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
    agent_env=
    agent_exec_env interactive
    eval "set -- $agent_env -- $agent_argv"
    os sandbox exec -n "$name" --tty --workdir "$workdir" "$@" || session_rc=$?
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
    agent_env=
    agent_exec_env headless
    eval "set -- $agent_env -- \"\$@\""
    case $(agent_exec_stdin) in
        null)
            os sandbox exec -n "$name" --no-login-shell --workdir "$workdir" "$@" \
                </dev/null || run_rc=$?
            ;;
        *)
            os sandbox exec -n "$name" --no-login-shell --workdir "$workdir" "$@" || run_rc=$?
            ;;
    esac
    trap - INT TERM
    if [ "$session_interrupted" -eq 1 ] && [ "$run_rc" -eq 0 ]; then
        run_rc=130
    fi
    exit "$run_rc"
}

cmd_upload() {
    [ "$#" -le 2 ] || die_usage "usage: $PROGRAM upload [--discard] [LOCAL_PATH] [SANDBOX_DEST]"
    require_openshell
    name=$(resolved_name)
    require_sandbox "$name"
    src=${1:-.}
    dest=${2:-$(resolved_workdir)}
    workdir=$(resolved_workdir)
    upload_state=$(session_state_dir "$name")
    if ! (umask 077 && mkdir -p "$upload_state" && chmod 700 "$upload_state" 2>/dev/null); then
        warn "cannot create the session state directory $upload_state"
    fi
    upload_patch=
    upload_kind=
    if [ -f "$upload_state/pending" ]; then
        upload_patch=$(flat_value "$upload_state/pending" patch)
        upload_kind=$(flat_value "$upload_state/pending" kind)
        if [ -z "$upload_kind" ]; then
            if [ -n "$upload_patch" ] && [ -s "$upload_patch" ]; then
                upload_kind=retained
            else
                upload_kind=parked
            fi
        fi
    fi
    if [ "$upload_kind" = parked ] && [ "$opt_discard" -eq 0 ]; then
        err "the workspace is parked; download its changes or pass --discard to replace them"
        err "  download: $PROGRAM download $workdir ./DEST"
        err "  discard:  $PROGRAM upload --discard"
        exit "$EX_USAGE"
    fi
    sync_name=$name
    sync_workdir=$workdir
    sync_state_dir=$upload_state
    sync_sandbox_id=$(sandbox_id "$name")
    sync_sandbox_tree=
    sync_probe_ok=0
    sync_pending_patch=$upload_patch
    sync_pending_kind=$upload_kind
    sync_pending_result_tree=$(flat_value "$upload_state/pending" result_tree)
    synced_host_tree=$(read_baseline "$upload_state/synced" host_tree)
    synced_sandbox_tree=$(read_baseline "$upload_state/synced" sandbox_tree)
    capture_host_baseline "$upload_state"
    if [ "$dest" = "$workdir" ]; then
        refresh_sandbox_workspace "$name" "$workdir" "$upload_state"
        say "Uploaded '$src' to '$name:$dest'."
    else
        set -- sandbox upload
        if [ "$opt_no_git_ignore" -eq 1 ]; then
            set -- "$@" --no-git-ignore
        fi
        set -- "$@" "$name" "$src" "$dest"
        run_gateway "$@"
        say "Uploaded '$src' to '$name:$dest'."
        if upload_tree=$(sandbox_script "$name" "$workdir" "$SANDBOX_INIT_SCRIPT" 2>/dev/null); then
            record_host_manifest "$upload_state"
            write_synced_marker "$upload_state" "$bl_tree" "$upload_tree" "$sync_sandbox_id"
            note "Recorded a new sandbox baseline for '$name'."
        else
            warn "uploaded, but could not record the sandbox baseline for '$name'"
        fi
    fi
    if [ "$upload_kind" = parked ] && [ "$opt_discard" -eq 1 ]; then
        rm -f "$upload_state/pending"
        note "Discarded the parked workspace state."
    elif [ "$upload_kind" = retained ]; then
        note "A retained patch is still available for review: ${upload_patch:-$upload_state/pending}"
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

# Prints a status line, except for `__status-json`, which prints one JSON
# object at the end instead.
status_say() {
    [ "${status_json:-0}" -eq 1 ] || say "$@"
}

cmd_status() {
    [ "$#" -eq 0 ] || die_usage "status takes no arguments"
    require_openshell
    name=$(resolved_name)
    phase=$(sandbox_phase "$name")
    if [ -z "$phase" ]; then
        if [ "${status_json:-0}" -eq 1 ]; then
            printf '{"sandbox":%s,"exists":false}\n' "$(json_str "$name")"
            return 0
        fi
        say "Sandbox:   $name"
        say "Exists:    no"
        exit "$EX_USAGE"
    fi
    image=$(resolved_image)
    providers=$(attached_providers "$name")
    providers=$(printf '%s' "$providers" | paste -sd',' -)
    status_say "Sandbox:   $name"
    status_say "Exists:    yes"
    status_say "Phase:     $phase"
    status_say "Image:     $image (configured)"
    status_say "Providers: ${providers:-none}"

    status_dir=$(session_state_dir "$name")
    status_tmp=${TMPDIR:-/tmp}/$OSS_TMP_PREFIX-status.$$
    rm -rf "$status_tmp"
    mkdir -p "$status_tmp"
    capture_host_baseline "$status_tmp"
    status_bl_ok=$bl_ok
    status_bl_tree=$bl_tree
    synced_host_tree=$(read_baseline "$status_dir/synced" host_tree)
    synced_sandbox_tree=$(read_baseline "$status_dir/synced" sandbox_tree)
    status_synced_id=$(read_baseline "$status_dir/synced" sandbox_id)
    sync_pending_patch=$(flat_value "$status_dir/pending" patch)
    sync_pending_kind=$(flat_value "$status_dir/pending" kind)
    sync_pending_result_tree=$(flat_value "$status_dir/pending" result_tree)
    if [ -z "$sync_pending_kind" ] && [ -f "$status_dir/pending" ]; then
        if [ -n "$sync_pending_patch" ] && [ -s "$sync_pending_patch" ]; then
            sync_pending_kind=retained
        else
            sync_pending_kind=parked
        fi
    fi
    sync_sandbox_id=$(sandbox_id "$name")
    if [ -n "$sync_sandbox_id" ] && [ -n "$status_synced_id" ] \
        && [ "$sync_sandbox_id" != "$status_synced_id" ]; then
        synced_host_tree=
        synced_sandbox_tree=
    fi
    sync_sandbox_tree=
    sync_probe_ok=0
    sync_sandbox_empty=0
    sync_created=0
    bl_ok=$status_bl_ok
    bl_tree=$status_bl_tree
    if [ "$phase" = Ready ]; then
        status_probe=$(sandbox_script "$name" "$(resolved_workdir)" \
            "$SANDBOX_PROBE_SCRIPT" 2>/dev/null) || status_probe=
        case $status_probe in
            missing)
                status_workdir_state=$(sandbox_script "$name" "$(resolved_workdir)" \
                    "$SANDBOX_WORKDIR_NONEMPTY_SCRIPT" 2>/dev/null) || status_workdir_state=
                if [ "$status_workdir_state" = empty ]; then
                    sync_probe_ok=1
                    sync_sandbox_tree=
                    sync_sandbox_empty=1
                fi
                ;;
            '')
                ;;
            *)
                sync_probe_ok=1
                sync_sandbox_tree=$status_probe
                ;;
        esac
    fi
    if [ "$sync_probe_ok" -eq 1 ] && [ "$bl_ok" -eq 1 ] \
        && [ -z "$synced_sandbox_tree" ] && [ -n "$sync_sandbox_tree" ] \
        && [ "$sync_sandbox_tree" != "$bl_tree" ]; then
        case $(sandbox_script_extra "$name" "$(resolved_workdir)" \
            "$SANDBOX_TREE_EMPTY_SCRIPT" "$sync_sandbox_tree" 2>/dev/null) in
            empty) sync_sandbox_empty=1 ;;
        esac
    fi
    if [ "$sync_probe_ok" -eq 1 ]; then
        sync_classify
        status_state=$sync_state
    else
        status_state=$(read_baseline "$status_dir/baseline" state)
        case $status_state in
            clean|behind|retained|parked) ;;
            *)
                if [ "$sync_pending_kind" = parked ]; then
                    status_state=parked
                elif [ "$sync_pending_kind" = retained ]; then
                    status_state=retained
                else
                    status_state=behind
                fi
                ;;
        esac
        if [ "$status_state" = clean ] && [ "$status_bl_ok" -eq 1 ] \
            && [ -n "$synced_host_tree" ] \
            && [ "$status_bl_tree" != "$synced_host_tree" ]; then
            status_state=behind
        fi
        if [ "$sync_pending_kind" = parked ]; then
            status_state=parked
        fi
    fi
    status_say "Sync:      $status_state"
    status_next=$PROGRAM
    status_patch=
    case $status_state in
        parked)
            status_next="$PROGRAM download $(resolved_workdir) ./DEST"
            status_say "Next:      $status_next"
            status_say "Discard:   $PROGRAM upload --discard (or $PROGRAM rm --discard)"
            status_patch=$sync_pending_patch
            ;;
        retained)
            status_say "Next:      $PROGRAM (refreshes before the next session)"
            status_patch=$sync_pending_patch
            ;;
        behind)
            status_say "Next:      $PROGRAM (refreshes the workspace)"
            ;;
        *)
            status_say "Next:      $PROGRAM"
            ;;
    esac
    if [ -n "$status_patch" ]; then
        status_say "Patch:     $status_patch"
    fi
    rm -rf "$status_tmp"
    if [ "${status_json:-0}" -eq 1 ]; then
        printf '{"sandbox":%s,"exists":true,"phase":%s,"image":%s,"providers":%s,"sync":%s,"patch":%s,"next":%s}\n' \
            "$(json_str "$name")" "$(json_str "$phase")" "$(json_str "$image")" \
            "$(json_str "$providers")" "$(json_str "$status_state")" \
            "$(json_str "$status_patch")" "$(json_str "$status_next")"
    fi
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
    rm_state=$(session_state_dir "$name")
    rm_patch=$(flat_value "$rm_state/pending" patch)
    rm_kind=$(flat_value "$rm_state/pending" kind)
    if [ -z "$rm_kind" ] && [ -f "$rm_state/pending" ]; then
        if [ -n "$rm_patch" ] && [ -s "$rm_patch" ]; then
            rm_kind=retained
        else
            rm_kind=parked
        fi
    fi
    if [ "$rm_kind" = parked ] && [ "$opt_discard" -eq 0 ]; then
        err "the workspace is parked; download its changes or pass --discard to delete them"
        err "  download: $PROGRAM download $(resolved_workdir) ./DEST"
        err "  discard:  $PROGRAM rm --yes --discard"
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
    if [ -d "$rm_state" ]; then
        archive_state_dir "$rm_state" "sandbox deleted" || true
    fi
    registry_remove "$name"
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
# MCP readiness: mcp status and the doctor section
#
# Compares the servers enabled in the host's agent config
# ($OSS_HOST_MCP_CONFIG) against the sandbox's baked config
# ($OSS_SANDBOX_MCP_CONFIG) and reports the gates that decide whether each
# server works in the sandbox. The front-end's agent_mcp_servers FILE parses
# one config into `name<TAB>transport<TAB>enabled<TAB>host<TAB>argv0` lines
# and fails when the file cannot be parsed. Read-only: it never mutates the
# sandbox, the gateway, or any profile, and never parses or prints a
# credential value.
# ---------------------------------------------------------------------------

# Prints the per-server gate table for sandbox $1 and sets mcp_any (any
# enabled server on either side) and mcp_failed (servers with a failing
# gate). Returns 1 when gateway data cannot be read at all.
mcp_readiness_report() { # NAME
    mcp_name=$1
    mcp_tmp=${TMPDIR:-/tmp}/$OSS_TMP_PREFIX-mcp.$$
    mcp_any=0
    mcp_failed=0
    mcp_unreadable_host=0
    mcp_unreadable_sandbox=0
    agent_mcp_servers "$OSS_HOST_MCP_CONFIG" >"$mcp_tmp.host" || mcp_unreadable_host=1
    # An unreadable sandbox config counts as absent: the gate then names the
    # environment image that supplies the server, not a base-image rebuild.
    os sandbox exec -n "$mcp_name" --no-login-shell -- cat "$OSS_SANDBOX_MCP_CONFIG" \
        >"$mcp_tmp.config" 2>/dev/null || :
    agent_mcp_servers "$mcp_tmp.config" >"$mcp_tmp.sandbox" || mcp_unreadable_sandbox=1
    # A file that exists but does not parse is reported as unreadable rather
    # than read as "no servers", which would invent gate results.
    if [ "$mcp_unreadable_host" -eq 1 ] || [ "$mcp_unreadable_sandbox" -eq 1 ]; then
        if [ "$mcp_unreadable_host" -eq 1 ]; then
            say "  unreadable: host config $OSS_HOST_MCP_CONFIG (cannot parse it)"
        fi
        if [ "$mcp_unreadable_sandbox" -eq 1 ]; then
            say "  unreadable: sandbox config $OSS_SANDBOX_MCP_CONFIG (cannot parse it)"
        fi
        mcp_any=1
        mcp_failed=1
        rm -f -- "$mcp_tmp".host "$mcp_tmp".config "$mcp_tmp".sandbox
        return 0
    fi
    if ! mcp_attached=$(attached_providers "$mcp_name"); then
        rm -f -- "$mcp_tmp".host "$mcp_tmp".config "$mcp_tmp".sandbox
        return 1
    fi
    mcp_policy=$(os policy get "$mcp_name" --full 2>/dev/null) || mcp_policy=
    {
        cat "$mcp_tmp.host"
        cat "$mcp_tmp.sandbox"
    } | awk -F'\t' '$3 == "true" && !seen[$1]++ { print $1 }' >"$mcp_tmp.list"
    while IFS= read -r mcp_server; do
        if [ -z "$mcp_server" ]; then
            continue
        fi
        mcp_any=1
        mcp_h=$(awk -F'\t' -v s="$mcp_server" '$1 == s { print; exit }' "$mcp_tmp.host")
        mcp_s=$(awk -F'\t' -v s="$mcp_server" '$1 == s { print; exit }' "$mcp_tmp.sandbox")
        mcp_sandbox_gate=ok
        [ -n "$mcp_s" ] || mcp_sandbox_gate=missing
        mcp_endpoint_host=
        if [ -n "$mcp_s" ]; then
            mcp_endpoint_host=$(printf '%s\n' "$mcp_s" | cut -f4)
        elif [ -n "$mcp_h" ]; then
            mcp_endpoint_host=$(printf '%s\n' "$mcp_h" | cut -f4)
        fi
        mcp_provider=$OSS_MCP_PROVIDER_PREFIX$mcp_server
        mcp_transport=$(printf '%s\n%s\n' "$mcp_h" "$mcp_s" | awk -F'\t' '$2 == "http" { print "http"; exit }')
        mcp_provider_gate=ok
        if ! printf '%s\n' "$mcp_attached" | grep -Fqx -- "$mcp_provider"; then
            mcp_provider_gate=missing
        fi
        if [ "$mcp_transport" != http ]; then
            # stdio (or unparseable): the transport itself decides nothing.
            # Gates are config present, the runtime argv[0] resolvable in the
            # sandbox (checked read-only on the same exec path as the config
            # read), and provider attached. No endpoint gate: a stdio command
            # names no URL, and the attached profile carries the endpoint.
            mcp_argv0=$(printf '%s\n%s\n' "$mcp_s" "$mcp_h" | awk -F'\t' '$5 != "" { print $5; exit }')
            mcp_runtime_gate=missing
            if [ -n "$mcp_argv0" ] \
                && os sandbox exec -n "$mcp_name" --no-login-shell -- command -v "$mcp_argv0" \
                    >/dev/null 2>&1; then
                mcp_runtime_gate=ok
            fi
            if [ "$mcp_sandbox_gate" = ok ] && [ "$mcp_runtime_gate" = ok ] \
                && [ "$mcp_provider_gate" = ok ]; then
                say "  $mcp_server: sandbox=ok runtime=ok provider=ok transport=stdio"
                continue
            fi
            mcp_failed=$((mcp_failed + 1))
            say "  $mcp_server: sandbox=$mcp_sandbox_gate runtime=$mcp_runtime_gate provider=$mcp_provider_gate transport=stdio"
            mcp_build_fix=0
            if [ "$mcp_sandbox_gate" = missing ]; then
                say "    fix: build and select $OSS_MCP_FIX_IMAGE that declares '$mcp_server' (see $OSS_MCP_FIX_DOC)"
                mcp_build_fix=1
            fi
            if [ "$mcp_runtime_gate" = missing ] && [ "$mcp_build_fix" -eq 0 ]; then
                say "    fix: build and select $OSS_MCP_FIX_IMAGE that provides the runtime '$mcp_argv0' for '$mcp_server' (see $OSS_MCP_FIX_DOC)"
            fi
            if [ "$mcp_provider_gate" = missing ]; then
                say "    fix: $PROGRAM provider attach $mcp_provider"
            fi
            continue
        fi
        mcp_endpoint_gate=ok
        if [ -z "$mcp_endpoint_host" ] \
            || ! printf '%s\n' "$mcp_policy" | grep -Fq -- "$mcp_endpoint_host"; then
            mcp_endpoint_gate=missing
        fi
        if [ "$mcp_sandbox_gate" = ok ] && [ "$mcp_provider_gate" = ok ] \
            && [ "$mcp_endpoint_gate" = ok ]; then
            say "  $mcp_server: sandbox=$mcp_sandbox_gate provider=ok endpoint=ok transport=http"
            continue
        fi
        mcp_failed=$((mcp_failed + 1))
        say "  $mcp_server: sandbox=$mcp_sandbox_gate provider=$mcp_provider_gate endpoint=$mcp_endpoint_gate transport=http"
        if [ "$mcp_sandbox_gate" = missing ]; then
            say "    fix: build and select $OSS_MCP_FIX_IMAGE that declares '$mcp_server' (see $OSS_MCP_FIX_DOC)"
        fi
        if [ "$mcp_provider_gate" = missing ]; then
            say "    fix: $PROGRAM provider attach $mcp_provider"
        fi
        if [ "$mcp_endpoint_gate" = missing ]; then
            say "    fix: the endpoint for '$mcp_endpoint_host' comes from the provider profile; run '$PROGRAM provider attach $mcp_provider' or import a profile that declares it"
        fi
    done <"$mcp_tmp.list"
    rm -f -- "$mcp_tmp".host "$mcp_tmp".config "$mcp_tmp".sandbox "$mcp_tmp".list
    return 0
}

cmd_mcp_status() {
    [ "$#" -eq 0 ] || die_usage "mcp status takes no arguments"
    require_openshell
    name=$(resolved_name)
    phase=$(sandbox_phase "$name")
    if [ -z "$phase" ]; then
        say "No sandbox '$name' for this project; run '$PROGRAM up' first."
        exit 0
    fi
    say "MCP readiness for sandbox '$name':"
    if ! mcp_readiness_report "$name"; then
        die_gateway "cannot read MCP readiness from the gateway; try '$PROGRAM doctor'"
    fi
    if [ "$mcp_any" -eq 0 ]; then
        say "  no MCP servers configured (host or sandbox declares no enabled server)."
        exit 0
    fi
    if [ "$mcp_failed" -gt 0 ]; then
        exit "$EX_GATEWAY"
    fi
}

# The doctor's MCP section, for a front-end's agent_doctor_extra.
doctor_mcp_section() {
    # MCP readiness is informational: MCP is not a prerequisite for running
    # the agent, so the exit code stays decided by the checks above. It also
    # needs a reachable gateway, so it is skipped when the CLI or gateway is
    # down.
    say ""
    say "MCP readiness (informational):"
    if [ "$have_openshell" -eq 0 ] || [ "$gateway_ok" -eq 0 ]; then
        say "  skipped (gateway unavailable)"
    else
        doctor_name=$(resolved_name)
        doctor_phase=$(sandbox_phase "$doctor_name")
        if [ -z "$doctor_phase" ]; then
            say "  no sandbox '$doctor_name' (run '$PROGRAM up' first)"
        elif ! mcp_readiness_report "$doctor_name"; then
            say "  cannot read MCP readiness from the gateway"
        elif [ "$mcp_any" -eq 0 ]; then
            say "  none configured"
        fi
    fi
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
    # A front-end whose credential is not a single stored value (a login that
    # yields several tokens and a refresh configuration) runs its own setup.
    if command -v agent_provider_setup >/dev/null 2>&1; then
        agent_provider_setup
        return
    fi
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
            agent_missing_env_hint "$source_env"
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
    # A generic credential (file, env var, prompt) may still belong to a
    # curated profile; the front-end decides, or leaves agent_profile_id empty
    # for custom setup.
    if [ -z "$profile_file" ] && [ "$source_kind" != store ]; then
        agent_profile_id=
        agent_generic_profile "$source_kind" "$source_env"
        if [ -n "$agent_profile_id" ]; then
            profile_id=$agent_profile_id
            profile_file=$profiles_dir/$profile_id.yaml
            if [ ! -f "$profile_file" ]; then
                die_dep "curated profile '$profile_id' is missing: $profile_file"
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
opt_discard=0
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
    # Optional agent hooks: a front-end that leaves one out gets the default
    # (no per-exec environment; the headless exec inherits stdin).
    if ! command -v agent_exec_env >/dev/null 2>&1; then
        agent_exec_env() { :; }
    fi
    if ! command -v agent_exec_stdin >/dev/null 2>&1; then
        agent_exec_stdin() { printf 'tty'; }
    fi
    # provider setup: a generic credential goes to custom setup, and an unset
    # --env variable gets no extra hint.
    if ! command -v agent_generic_profile >/dev/null 2>&1; then
        agent_generic_profile() { :; }
    fi
    if ! command -v agent_missing_env_hint >/dev/null 2>&1; then
        agent_missing_env_hint() { :; }
    fi

    TAB=$(printf '\t')

    config_home=${XDG_CONFIG_HOME:-${HOME:-/tmp}/.config}
    config_file=$config_home/$OSS_CONFIG_NAME/config.toml

    project_basename=$(basename -- "$PWD")
    # The project folder's physical path keys the registry, and its hash
    # ({hash}) keeps worktrees and same-named folders on separate sandboxes.
    project_path=$(pwd -P)
    project_hash=$(printf '%s' "$project_path" | cksum | awk '{ printf "%04x", $1 % 65536 }')
    # {project} is the origin remote's repository name, else the folder name.
    project_source=$project_basename
    if command -v git >/dev/null 2>&1; then
        project_remote=$(GIT_OPTIONAL_LOCKS=0 git remote get-url origin 2>/dev/null) || project_remote=
        project_remote=${project_remote%/}
        project_remote=${project_remote%.git}
        project_remote=${project_remote##*/}
        project_remote=${project_remote##*:}
        if [ -n "$project_remote" ]; then
            project_source=$project_remote
        fi
    fi
    # OpenShell accepts only DNS-1123 labels: lowercase letters, digits, and
    # hyphens. {project} is expanded into sandbox names, so sanitize it once.
    project_name=$(printf '%s' "$project_source" | LC_ALL=C tr '[:upper:]' '[:lower:]')
    project_name=$(printf '%s' "$project_name" | LC_ALL=C tr -c 'a-z0-9-' '-')
    project_name=$(printf '%s' "$project_name" | sed 's/--*/-/g; s/^-//; s/-$//')
    if [ -z "$project_name" ]; then
        project_name=project
    fi

    have_jq=0
    if command -v jq >/dev/null 2>&1; then
        have_jq=1
    fi

    osa_state_paths

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
            --discard) opt_discard=1 ;;
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
        __status-json)
            # osa's full status: the same classification as `status`, as JSON.
            status_json=1
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
