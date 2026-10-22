# Tasks

## 1. maki-oss run --timeout

- [x] 1.1 Add `--timeout SECS` / `MAKI_OSS_TIMEOUT` to `bin/maki-oss`: parse,
      validate as a positive integer before any sandbox call, and prefix the
      `run` exec command with `timeout --kill-after=10 SECS`; verify with
      `make lint`
- [x] 1.2 Add stub tests for the three helper-cli scenarios (wrapped argv,
      invalid value refused with no stub call, unchanged argv without the
      flag); verify `make test` is green
- [x] 1.3 Document `--timeout` in the `usage()` text and `docs/helper.md`,
      including why the gateway's own exec timeout is not used (finding 6);
      verify `scripts/check-links.sh`

## 2. oskhs round library

- [x] 2.1 Scaffold `oskhs/` (package.json, tsconfig matching `bridge/`,
      `src/`, `test/`) and a `make test-oskhs` target; verify
      `make test-oskhs` runs an empty suite green
- [x] 2.2 `src/exec.ts`: the single command-runner seam (argv, env, stdin,
      timeout) and `src/openshell.ts` helpers for sandbox exec/upload with no
      `--env`; verify by unit test that no built argv contains `--env`
- [x] 2.3 `src/names.ts`: project/sandbox/task-id naming; verify unit tests
      for sanitizing (`My_Repo.v2` → `my-repo-v2`) and id shape
- [x] 2.4 `src/seed.ts`: ensure sandbox (`maki-oss up`), detect clone, full
      bundle upload + clone + bundle removal, cleanup on failure; verify the
      three seeding scenarios with the recording runner
- [x] 2.5 `src/result.ts`: parse Maki's JSON line into `RoundResult`; verify
      unit tests for answer, agent-error with exit 0, missing line, timeout
      (124), helper failure
- [x] 2.6 `src/round.ts`: worktree add → `maki-oss run` → worktree remove in
      `finally`; verify the worktree scenario with the recording runner,
      including removal after a failed run
- [x] 2.7 `src/cli.ts run-round <repo> "<prompt>" [--model] [--base]
      [--provider] [--timeout] [--gateway]`: prints the result JSON, exits 0
      only for `answer`; verify a unit test of argument parsing and the exit
      mapping

## 3. Live exit

- [x] 3.1 Create a fixture repo with `oskhs/test/make-fixture.sh` and run
      `run-round` against the local gateway with a question about a file;
      verify the answer is correct, the sandbox `repo-<project>` holds
      `/sandbox/repo`, and `/sandbox/tasks/<id>` is gone; save the transcript
      to `evidence/round-live.md`
- [x] 3.2 Run a second round on the same repo; verify no bundle upload is
      recorded (log shows reuse) and it answers
- [x] 3.3 Run a round with `--timeout 5` and a prompt that keeps Maki busy;
      verify the result is `timeout` and `ps` in the sandbox shows no
      leftover `maki` process; record in `evidence/round-live.md`
- [x] 3.4 Verify the sandbox environment holds no credential values:
      `openshell sandbox exec … env` filtered for key-like names shows only
      provider stand-ins; record the redacted check

## 4. Docs

- [x] 4.1 `docs/oskhs.md` (what oskhs is today, sandbox layout, run-round
      usage, results) and glossary entries for warm repo sandbox, task
      worktree, round; verify `scripts/check-links.sh`
- [x] 4.2 Mark B1.1a done in `docs/roadmap.md` with a pointer to this
      change; verify `openspec validate add-oskhs-round --strict`
