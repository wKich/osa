# Tasks

## 1. Reproduce

- [x] 1.1 Add failing stub tests to `tests/run-tests.sh` that drive
      `maki-oss` the way oskhs does: `up` from one directory, then two
      `run --no-sync` calls with `MAKI_OSS_SANDBOX_NAME`/`MAKI_OSS_WORKDIR`
      set, each from a new empty temp directory; verify the second run fails
      today on the registry guard and, with the registry entry removed by
      hand, on the parked marker — record both messages in the change's
      `evidence/reproduce.md`

## 2. Caller-owned workspace mode in the core

- [x] 2.1 Resolve and validate `<PREFIX>_WORKSPACE` (`managed` default,
      `caller`; anything else a usage error before any gateway call); in
      caller mode require a sandbox name, and a workdir for `run`; verify
      the invalid-mode and missing-name/workdir stub tests pass with no
      gateway call recorded
- [x] 2.2 In caller mode skip `registry_guard`/`registry_update` in `up` and
      `ensure_project_sandbox`, `enable_policy_advisor`,
      `prepare_session_sync`, and the exit-hook sync (no `arm_sync`), keeping
      the lock, idle-stop setting, provider attachment, model argv, and run
      wrapper; verify the 1.1 tests now pass, no sandbox-side sync script or
      `settings set` call is recorded, the state root holds no `pending`,
      `synced`, `baseline`, or registry file for the sandbox, and a
      pre-existing parked marker neither blocks nor changes
- [x] 2.3 Verify the managed-mode suite is unchanged: `make test` and
      `make lint` pass, including the existing `--no-sync` parking tests

## 3. oskhs

- [x] 3.1 `oskhs/src/names.ts`: fit `repo-<project>` to 19 characters
      (budget 14; keep 9, drop trailing hyphens, `-` + 4 hex of SHA-256 of
      the cleaned name) and collapse/trim hyphens; verify unit tests for
      `kiss-agent` (unchanged), `ascii-minecraft` (`repo-ascii-min-xxxx`),
      and two long titles sharing a prefix (distinct, ≤ 19, valid charset)
- [x] 3.2 `sandbox.ts` and `round.ts`: set `MAKI_OSS_WORKSPACE=caller` and
      `MAKI_OSS_IDLE_STOP=0` on `up` and `run`, drop `--no-sync`; verify the
      recording-runner tests assert the new argv and env, then
      `make test-oskhs` and `bunx tsc --noEmit -p oskhs` pass
- [x] 3.3 Run the in-sandbox round against the real `bin/maki-oss` with the
      stub `openshell` (not the recorder) for two consecutive rounds on one
      sandbox from different cwds; verify both reach the stubbed agent and
      the state root stays empty for that sandbox

## 4. Live exit

- [ ] 4.1 Dev stand (local kiss stack, local gateway): two marked tasks in
      a row on one project and a follow-up on the second; verify all three
      rounds run, the follow-up pushes a commit to the task's MR, and
      `<osa state>/sessions/<sandbox>/` and the registry hold no marker or
      entry for it; record in `evidence/realign-live.md`
- [ ] 4.2 A kiss project whose title cleans to more than 14 characters;
      verify its sandbox and provider get the fitted name and a round
      answers; append to `evidence/realign-live.md`

## 5. Docs

- [ ] 5.1 `docs/helper.md`: the caller-owned workspace mode as a caller
      interface (what it skips, what stays); `docs/oskhs.md`: sandbox name
      fitting, the caller mode and idle-stop off, and the corrected
      `run` argv; roadmap B1.6 marked done with the change name; verify
      `scripts/check-links.sh docs/helper.md docs/oskhs.md docs/roadmap.md`
      and `scripts/check-playbooks.sh` pass
