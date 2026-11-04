# Case bodies for tests/e2e/run.sh. Sourced, never executed directly.
# shellcheck shell=sh
#
# Every case is a function named test_*; the harness selects them with RUN_ONLY
# and counts them. A case asserts observable effects: files, exit statuses,
# state-tree records, phase changes, and the scripted agent's own record of its
# argv and working directory. No case compares gateway argv.
#
# Case ids that intentionally have no committed recording are listed in
# tests/e2e/excluded.txt with a reason; the harness still runs them.

# ---------------------------------------------------------------------------
# 3. Session outcomes
# ---------------------------------------------------------------------------

plain_project() {
    rm -rf "$PROJECT"
    mkdir -p "$PROJECT"
    printf 'before\n' >"$PROJECT/edited.md"
    printf 'delete me\n' >"$PROJECT/deleted.txt"
    printf 'base\n' >"$PROJECT/note.txt"
    printf 'e2e project\n' >"$PROJECT/README.md"
}

session_case() { # FRONT-END
    select_frontend "$1"
    new_sandbox
    up_sandbox || return 0
    set_agent_mode edit
    run_front session run "e2e session prompt" --name "$SANDBOX"
    assert_rc session.rc 0 "$LAST_RC"
    assert_contains session.edited "$PROJECT/edited.md" after
    assert_contains session.created "$PROJECT/created.txt" created
    assert_absent session.deleted "$PROJECT/deleted.txt"
    assert_eq session.cwd /sandbox/project "$(agent_record cwd)"
    agent_record argv >/dev/null
    assert_contains session.argv "$CASE/agent-argv" "e2e session prompt"
    assert_contains session.registry \
        "$HOME/.local/state/osa/projects/$SANDBOX.toml" \
        "sandbox_name = \"$SANDBOX\""
    assert_file session.baseline \
        "$HOME/.local/state/osa/sessions/$SANDBOX/baseline"
    assert_file session.synced \
        "$HOME/.local/state/osa/sessions/$SANDBOX/synced"
    assert_git_clean session.host_clean "$PROJECT"
}

test_session_maki() {
    session_case maki-oss
}

test_session_opencode() {
    session_case opencode-oss
}

test_session_claude() {
    session_case claude-oss
}

test_session_codex() {
    session_case codex-oss
}

test_session_failure() {
    select_frontend maki-oss
    new_sandbox
    up_sandbox || return 0
    set_agent_mode fail
    run_front session run "e2e failure prompt" --name "$SANDBOX"
    assert_rc failure.rc 7 "$LAST_RC"
    assert_contains failure.agent "$CASE/session.out" "scripted agent failure"
    # The failure is reported and the collected work is named; it is never
    # applied without a report.
    assert_contains failure.reported "$CASE/session.err" "Collected sandbox changes"
    assert_contains failure.edited "$PROJECT/edited.md" after
}

test_session_upload_download() {
    select_frontend maki-oss
    new_sandbox
    up_sandbox || return 0
    # A no-path upload refreshes the workspace from the project tree; both the
    # real CLI and the plane's shim copy `.` into /sandbox/project. A file
    # source's destination naming differs between them, so the shared path is
    # the workspace refresh, not a one-file copy.
    run_front upload upload --name "$SANDBOX"
    assert_rc upload.rc 0 "$LAST_RC"
    mkdir -p "$CASE/download"
    printf 'keep me\n' >"$CASE/download/existing.txt"
    run_front download download --name "$SANDBOX" /sandbox/project/README.md "$CASE/download"
    assert_rc download.rc 0 "$LAST_RC"
    assert_contains download.content "$CASE/download/README.md" "e2e project"
    assert_nonempty_file download.nonempty "$CASE/download/README.md"
    assert_contains download.destination "$CASE/download/existing.txt" "keep me"
}

# ---------------------------------------------------------------------------
# 4. Caller mode
# ---------------------------------------------------------------------------

caller_up() {
    select_frontend maki-oss
    MAKI_OSS_WORKSPACE=caller
    export MAKI_OSS_WORKSPACE
    plain_project
    new_sandbox
    run_front up up --name "$SANDBOX" --workdir /sandbox/project \
        --env "PATH=$SANDBOX_PATH"
    if [ "$LAST_RC" -ne 0 ]; then
        case_fail "caller up failed (exit $LAST_RC)"
        return 1
    fi
    if ! wait_for_phase "$SANDBOX" Ready; then
        case_fail "the caller sandbox did not reach Ready after up"
        return 1
    fi
    # shellcheck disable=SC2034  # read by upload_agents in run.sh
    E2E_AGENT_MODE=edit
    upload_agents "$SANDBOX"
    case_pass up
}

test_caller_patch() {
    caller_up || return 0
    run_front sync-in sync-in "$PROJECT" --name "$SANDBOX" --workdir /sandbox/project --json
    assert_rc sync.rc 0 "$LAST_RC"
    set_agent_mode patch
    run_front agent run "e2e caller prompt" --name "$SANDBOX" \
        --workdir /sandbox/project
    assert_rc agent.rc 0 "$LAST_RC"
    run_front collect collect-patch --out "$CASE/patch.diff" --name "$SANDBOX" \
        --workdir /sandbox/project --json
    assert_rc collect.rc 0 "$LAST_RC"
    assert_contains collect.edited "$CASE/collect.out" '"status":"M","path":"edited.md"'
    assert_contains collect.created "$CASE/collect.out" '"status":"A","path":"created.txt"'
    assert_nonempty_file collect.patch "$CASE/patch.diff"
    if sandbox_path_exists "$SANDBOX" /sandbox/project/.git; then
        case_fail "caller workdir kept .git metadata"
    else
        case_pass collect.no_git
    fi

    scratch=$CASE/scratch
    mkdir -p "$scratch"
    cp -R "$PROJECT/." "$scratch/"
    (
        cd "$scratch" || exit 1
        git init -q
        git config user.email e2e@localhost
        git config user.name e2e
        git add -A
        git commit -qm scratch
    )
    if git -C "$scratch" apply --check "$CASE/patch.diff" >/dev/null 2>&1; then
        case_pass collect.applies
    else
        case_fail "the collected patch does not apply to a scratch tree"
    fi
    git -C "$scratch" apply "$CASE/patch.diff" >/dev/null 2>&1 || true
    assert_contains collect.applied_edit "$scratch/edited.md" after
    assert_contains collect.applied_create "$scratch/created.txt" created
}

test_caller_empty() {
    caller_up || return 0
    run_front sync-in sync-in "$PROJECT" --name "$SANDBOX" --workdir /sandbox/project --json
    assert_rc sync.rc 0 "$LAST_RC"
    run_front collect collect-patch --out "$CASE/empty.patch" --name "$SANDBOX" \
        --workdir /sandbox/project --json
    assert_rc collect.rc 0 "$LAST_RC"
    assert_empty_file collect.empty "$CASE/empty.patch"
    assert_contains collect.flag "$CASE/collect.out" '"empty":true'
    assert_contains collect.files "$CASE/collect.out" '"files":[]'
}

test_caller_missing_baseline() {
    caller_up || return 0
    run_front collect collect-patch --out "$CASE/missing.patch" --name "$SANDBOX" \
        --workdir /sandbox/project --json
    assert_rc collect.rc 1 "$LAST_RC"
    assert_absent collect.no_file "$CASE/missing.patch"
    assert_contains collect.message "$CASE/collect.err" "no baseline"
}

# ---------------------------------------------------------------------------
# 5. Pending work and lifecycle
# ---------------------------------------------------------------------------

retained_pending() { # CASE-SETUP: up, upload, dirty host, run
    select_frontend maki-oss
    new_sandbox
    up_sandbox || return 1
    set_agent_mode edit
    dirty_project
    run_front session run "e2e pending prompt" --name "$SANDBOX"
    assert_rc session.rc 0 "$LAST_RC"
    assert_file pending.marker "$(pending_file)"
    assert_contains pending.kind "$(pending_file)" 'kind = "retained"'
}

test_resolve_apply() {
    retained_pending || return 0
    resolve_action apply
    assert_rc resolve.rc 0 "$LAST_RC"
    assert_absent resolve.marker "$(pending_file)"
    assert_contains resolve.edited "$PROJECT/edited.md" after
    assert_contains resolve.created "$PROJECT/created.txt" created
    assert_absent resolve.deleted "$PROJECT/deleted.txt"
    assert_contains resolve.dirty_kept "$PROJECT/note.txt" dirty
}

test_resolve_branch() {
    retained_pending || return 0
    resolve_action branch
    assert_rc resolve.rc 0 "$LAST_RC"
    assert_absent resolve.marker "$(pending_file)"
    branch=$(git -C "$PROJECT" for-each-ref --format='%(refname:short)' refs/heads/osa/ | sed -n 1p)
    if [ -n "$branch" ]; then
        case_pass resolve.branch
    else
        case_fail "no osa/ branch was created"
    fi
    if [ -n "$branch" ] && git -C "$PROJECT" show "$branch:edited.md" 2>/dev/null | grep -Fq after; then
        case_pass resolve.branch_content
    else
        case_fail "the branch does not carry the agent's edit"
    fi
    assert_contains resolve.worktree_kept "$PROJECT/edited.md" before
    assert_contains resolve.dirty_kept "$PROJECT/note.txt" dirty
}

test_resolve_drop() {
    retained_pending || return 0
    resolve_action drop --yes
    assert_rc resolve.rc 0 "$LAST_RC"
    assert_absent resolve.marker "$(pending_file)"
    if find "$HOME/.local/state/osa/sessions/$SANDBOX/dropped" -type f -print 2>/dev/null \
        | grep -q .; then
        case_pass resolve.dropped_file
    else
        case_fail "the dropped patch is not under dropped/"
    fi
    assert_contains resolve.worktree_kept "$PROJECT/edited.md" before
}

test_rm_pending() {
    select_frontend maki-oss
    new_sandbox
    up_sandbox || return 0
    run_front session run "e2e parked prompt" --name "$SANDBOX" --no-sync
    assert_rc session.rc 0 "$LAST_RC"
    assert_contains pending.kind "$(pending_file)" 'kind = "parked"'

    run_front status status --name "$SANDBOX"
    assert_matches pending.listed "$CASE/status.out" '^Sync:[[:space:]]+parked$'
    run_front rm rm --yes --name "$SANDBOX"
    assert_rc rm.refused 1 "$LAST_RC"
    assert_contains rm.message "$CASE/rm.err" "parked"
    assert_sandbox_exists rm.sandbox_kept "$SANDBOX"

    resolve_action discard --yes
    assert_rc resolve.rc 0 "$LAST_RC"
    assert_absent resolve.marker "$(pending_file)"

    run_front rm rm --yes --name "$SANDBOX"
    assert_rc rm.rc 0 "$LAST_RC"
    assert_sandbox_absent rm.deleted "$SANDBOX"
    SANDBOX=
}

phase_now() { # NAME -> phase or empty
    if [ "$E2E_HOST" = 0 ]; then
        cat "$PLANE_STATE/sandboxes/$1/phase" 2>/dev/null | tr -d '\n'
    else
        openshell sandbox list 2>/dev/null \
            | awk -v name="$1" '$1 == name { print $NF; exit }'
    fi
}

wait_for_phase() { # NAME PHASE
    e2e_tries=0
    while [ "$e2e_tries" -lt 300 ]; do
        if [ "$(phase_now "$1")" = "$2" ]; then
            return 0
        fi
        e2e_tries=$((e2e_tries + 1))
        sleep 0.1
    done
    return 1
}

test_status_list() {
    select_frontend maki-oss
    new_sandbox
    up_sandbox || return 0
    run_front status status --name "$SANDBOX"
    assert_rc status.rc 0 "$LAST_RC"
    assert_matches status.exists "$CASE/status.out" '^Exists:[[:space:]]+yes$'
    assert_matches status.phase "$CASE/status.out" '^Phase:[[:space:]]+Ready$'
    assert_matches status.name "$CASE/status.out" "^Sandbox:[[:space:]]+$SANDBOX$"
    assert_matches status.providers "$CASE/status.out" "^Providers:[[:space:]]+$E2E_PROVIDER$"
    run_front list list --name "$SANDBOX"
    assert_rc list.rc 0 "$LAST_RC"
    assert_contains list.record "$CASE/list.out" "$SANDBOX"
    assert_contains list.phase "$CASE/list.out" Ready
}

test_logs() {
    # shellcheck disable=SC2034  # read by compare_recording in run.sh
    PARITY_ASSERTIONS=0
    select_frontend maki-oss
    new_sandbox
    up_sandbox || return 0
    if [ "$E2E_HOST" = 0 ]; then
        printf 'e2e-log-line\n' >>"$PLANE_STATE/sandboxes/$SANDBOX/logs"
    fi
    run_front logs logs --name "$SANDBOX"
    assert_rc logs.rc 0 "$LAST_RC"
    if [ "$E2E_HOST" = 0 ]; then
        assert_contains logs.record "$CASE/logs.out" "e2e-log-line"
    else
        case_pass logs.gateway
    fi
}

test_doctor() {
    select_frontend maki-oss
    new_sandbox
    up_sandbox || return 0
    run_front doctor doctor --name "$SANDBOX"
    assert_rc doctor.rc 0 "$LAST_RC"
    assert_contains doctor.gateway "$CASE/doctor.out" "gateway: connected"
    assert_contains doctor.providers "$CASE/doctor.out" "providers: $E2E_PROVIDER"
    assert_contains doctor.policy "$CASE/doctor.out" "policy file:"
    assert_contains doctor.engine "$CASE/doctor.out" "container engine:"
    assert_contains doctor.image "$CASE/doctor.out" "image:"
}

test_policy_provider() {
    # shellcheck disable=SC2034  # read by compare_recording in run.sh
    PARITY_ASSERTIONS=0
    select_frontend maki-oss
    new_sandbox
    up_sandbox || return 0
    if [ "$E2E_HOST" = 0 ]; then
        printf 'chunk-1|e2e-rule|/usr/bin/curl|example.com:443|pending\n' \
            >>"$PLANE_STATE/sandboxes/$SANDBOX/rules"
    fi
    run_front policy policy review --name "$SANDBOX"
    assert_rc policy.rc 0 "$LAST_RC"
    if [ "$E2E_HOST" = 0 ]; then
        assert_contains policy.record "$CASE/policy.out" "chunk-1"
    else
        case_pass policy.gateway
    fi
    run_front provider provider list --name "$SANDBOX"
    assert_rc provider.rc 0 "$LAST_RC"
    assert_contains provider.record "$CASE/provider.out" "$E2E_PROVIDER"
}

test_start_stop() {
    select_frontend maki-oss
    new_sandbox
    up_sandbox || return 0
    run_front stop stop --name "$SANDBOX"
    assert_rc stop.rc 0 "$LAST_RC"
    if wait_for_phase "$SANDBOX" Stopped; then
        case_pass stop.phase
    else
        case_fail "the sandbox did not reach Stopped"
    fi
    run_front start start --name "$SANDBOX"
    assert_rc start.rc 0 "$LAST_RC"
    if wait_for_phase "$SANDBOX" Ready; then
        case_pass start.phase
    else
        case_fail "the sandbox did not reach Ready"
    fi
    run_front status status --name "$SANDBOX"
    assert_matches status.phase "$CASE/status.out" '^Phase:[[:space:]]+Ready$'
}

# ---------------------------------------------------------------------------
# 6. Interrupt and idle
# ---------------------------------------------------------------------------

test_interrupt() {
    select_frontend maki-oss
    new_sandbox
    up_sandbox || return 0
    set_agent_mode slow
    dirty_project
    ( cd "$PROJECT" && exec "$FRONT_BIN" run "e2e interrupt prompt" --name "$SANDBOX" ) \
        >"$CASE/interrupt.out" 2>"$CASE/interrupt.err" &
    e2e_pid=$!
    if ! wait_agent_started; then
        kill -TERM "$e2e_pid" 2>/dev/null || true
        wait "$e2e_pid" 2>/dev/null || true
        case_fail "the scripted agent never started"
        return 0
    fi
    kill -INT "$e2e_pid" 2>/dev/null || true
    wait "$e2e_pid"
    e2e_rc=$?
    capture_run interrupt "$e2e_rc" "$CASE/interrupt.out" "$CASE/interrupt.err"
    assert_rc interrupt.rc 130 "$e2e_rc"
    if find "$HOME/.local/state/osa/sessions/$SANDBOX/locks" -name 'session.*' \
        -print 2>/dev/null | grep -q .; then
        case_fail "the session lock survived the interrupt"
    else
        case_pass interrupt.lock_free
    fi
    assert_file interrupt.pending "$(pending_file)"
    run_front status status --name "$SANDBOX"
    assert_matches interrupt.listed "$CASE/status.out" '^Sync:[[:space:]]+retained$'

    set_agent_mode edit
    run_front next run "e2e after interrupt" --name "$SANDBOX"
    assert_rc interrupt.next_rc 0 "$LAST_RC"
    assert_not_contains interrupt.next_free "$CASE/next.err" "is running"
}

test_idle_stop() {
    # The plane has no PID namespace: the idle scan sees the outer sandbox's
    # processes. The front-end is fixed so the case and its recording agree;
    # when its agent command is already running here, the scan could never
    # report idle and the case skips instead of picking a different front-end.
    idle_front=${OSA_E2E_IDLE_FRONTEND:-claude-oss}
    case $idle_front in
        maki-oss) e2e_command=maki ;;
        opencode-oss) e2e_command=opencode ;;
        claude-oss) e2e_command=claude ;;
        codex-oss) e2e_command=codex ;;
        *)
            skipped "unknown OSA_E2E_IDLE_FRONTEND=$idle_front"
            return 0
            ;;
    esac
    if ps -axo comm= 2>/dev/null | sed 's#.*/##' | grep -Fxq "$e2e_command"; then
        skipped "the $e2e_command command is already running in this sandbox; set OSA_E2E_IDLE_FRONTEND to a front-end that is idle"
        return 0
    fi
    select_frontend "$idle_front"
    new_sandbox
    up_sandbox || return 0
    set_agent_mode edit
    run_front session run "e2e idle prompt" --name "$SANDBOX" --idle-stop 1s
    assert_rc idle.rc 0 "$LAST_RC"
    if wait_for_phase "$SANDBOX" Stopped; then
        case_pass idle.stopped
    else
        case_fail "the idle watcher did not stop the sandbox"
    fi
}

# ---------------------------------------------------------------------------
# 7. Determinism and offline
# ---------------------------------------------------------------------------

normalized_caller_json() { # FILE OUT
    e2e_normalize "$CASE" "$WORK" "$ROOT" <"$1" >"$2"
}

test_determinism() {
    caller_up || return 0
    set_agent_mode patch
    run_front sync1 sync-in "$PROJECT" --name "$SANDBOX" \
        --workdir /sandbox/project --json
    assert_rc sync1.rc 0 "$LAST_RC"
    run_front agent1 run "e2e determinism" --name "$SANDBOX" \
        --workdir /sandbox/project
    assert_rc agent1.rc 0 "$LAST_RC"
    run_front collect1 collect-patch --out "$CASE/patch1.diff" --name "$SANDBOX" \
        --workdir /sandbox/project --json
    assert_rc collect1.rc 0 "$LAST_RC"

    run_front sync2 sync-in "$PROJECT" --name "$SANDBOX" \
        --workdir /sandbox/project --json
    assert_rc sync2.rc 0 "$LAST_RC"
    run_front agent2 run "e2e determinism" --name "$SANDBOX" \
        --workdir /sandbox/project
    assert_rc agent2.rc 0 "$LAST_RC"
    run_front collect2 collect-patch --out "$CASE/patch2.diff" --name "$SANDBOX" \
        --workdir /sandbox/project --json
    assert_rc collect2.rc 0 "$LAST_RC"

    if cmp -s "$CASE/patch1.diff" "$CASE/patch2.diff"; then
        case_pass determinism.patch
    else
        case_fail "two runs produced different patches"
    fi
    normalized_caller_json "$CASE/collect1.out" "$CASE/collect1.norm"
    normalized_caller_json "$CASE/collect2.out" "$CASE/collect2.norm"
    if cmp -s "$CASE/collect1.norm" "$CASE/collect2.norm"; then
        case_pass determinism.json
    else
        case_fail "two runs produced different normalized JSON"
    fi
}

test_offline() {
    caller_up || return 0
    # Point every proxy at a closed loopback port, keep the plane and the
    # gateway on NO_PROXY, and prove the caller path completes. The outer
    # sandbox's egress policy is the actual offline condition; this case also
    # catches a component that would try the network if it could.
    export HTTP_PROXY=http://127.0.0.1:9
    export HTTPS_PROXY=http://127.0.0.1:9
    export ALL_PROXY=http://127.0.0.1:9
    export NO_PROXY=127.0.0.1,localhost
    run_front sync sync-in "$PROJECT" --name "$SANDBOX" \
        --workdir /sandbox/project --json
    assert_rc offline.sync_rc 0 "$LAST_RC"
    set_agent_mode noop
    run_front agent run "e2e offline" --name "$SANDBOX" \
        --workdir /sandbox/project
    assert_rc offline.agent_rc 0 "$LAST_RC"
    run_front collect collect-patch --out "$CASE/offline.patch" \
        --name "$SANDBOX" --workdir /sandbox/project --json
    assert_rc offline.collect_rc 0 "$LAST_RC"
    unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY
    assert_empty_file offline.empty "$CASE/offline.patch"
    if grep -Eiq 'network error|could not resolve|connection refused|proxy' \
        "$CASE/sync.err" "$CASE/agent.err" "$CASE/collect.err" 2>/dev/null; then
        case_fail "a case output reported a network error"
    else
        case_pass offline.no_network
    fi
}

# ---------------------------------------------------------------------------
# 8. The one opt-in real-agent turn
# ---------------------------------------------------------------------------

test_real_agent_smoke() {
    if [ "${OSA_E2E_REAL_AGENT:-0}" != 1 ] || [ -z "${OSA_E2E_REAL_AGENT_PROVIDER:-}" ]; then
        skipped "no provider attached to the outer sandbox (set OSA_E2E_REAL_AGENT=1 and OSA_E2E_REAL_AGENT_PROVIDER)"
        return 0
    fi
    if [ "$E2E_HOST" != 1 ]; then
        skipped "the real-agent turn needs a real gateway provider, not the plane"
        return 0
    fi
    if ! openshell provider list 2>/dev/null | awk '{print $1}' \
        | grep -Fxq -- "$OSA_E2E_REAL_AGENT_PROVIDER"; then
        skipped "provider $OSA_E2E_REAL_AGENT_PROVIDER is not on the gateway"
        return 0
    fi
    advisory "single headless real-agent turn"
    select_frontend "$DEFAULT_FRONTEND"
    for e2e_prefix in MAKI_OSS OPENCODE_OSS CLAUDE_OSS CODEX_OSS; do
        eval "export ${e2e_prefix}_PROVIDERS=\$OSA_E2E_REAL_AGENT_PROVIDER"
    done
    new_sandbox
    run_front up up --name "$SANDBOX"
    if [ "$LAST_RC" -ne 0 ]; then
        advisory_failed "up failed (exit $LAST_RC)"
        return 0
    fi
    run_front smoke run "create a file named real-agent.txt with the word ok" \
        --name "$SANDBOX"
    if [ "$LAST_RC" -ne 0 ]; then
        advisory_failed "the real agent exited $LAST_RC"
        return 0
    fi
    if [ -f "$PROJECT/real-agent.txt" ] \
        || [ -n "$(git -C "$PROJECT" status --porcelain 2>/dev/null)" ]; then
        advisory "single headless real-agent turn (workdir changed)"
    else
        advisory_failed "the workdir did not change"
    fi
}
