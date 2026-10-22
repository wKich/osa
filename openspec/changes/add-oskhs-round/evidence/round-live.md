# Live exit for add-oskhs-round (B1.1a)

Recorded 2026-10-23 on the local gateway (OpenShell 0.1.5, Maki 0.6.4), model
`synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017` on the `maki-synthetic`
provider. Fixture from `oskhs/test/make-fixture.sh` (branches `main`,
`feature`).

```sh
export OSKHS_PROVIDERS=maki-synthetic OSKHS_MODEL=synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017
oskhs/test/make-fixture.sh "$S/fx"
```

## 3.1 First round seeds and answers

```
$ bun oskhs/src/cli.ts run-round $S/fx "What is the secret word in README.md? Answer with just the word." --task-id live1
oskhs: creating sandbox repo-fx
oskhs: seeding repo-fx from …/scratchpad/fx
oskhs: round live1 in repo-fx:/sandbox/tasks/live1
{"taskId":"live1","sandbox":"repo-fx","kind":"answer","text":"PELICAN","sessionId":"CgHuUH5qsVhk489ZJ7d5M","durationMs":6415,"numTurns":2,…}
rc=0   (7.8 s wall, including sandbox creation and seed)
```

Sandbox state afterwards:

```
git -C /sandbox/repo rev-parse --is-bare-repository   → true
refs: refs/remotes/origin/feature, refs/remotes/origin/main
git remote -v                                          → (none)
/sandbox/.oskhs/in                                     → empty (bundle removed)
/sandbox/tasks                                         → empty (worktree removed)
git worktree list                                      → /sandbox/repo (bare)
```

## 3.2 Second round reuses the seed

No `creating` or `seeding` log line; the agent reads a non-base branch from
local history:

```
$ bun oskhs/src/cli.ts run-round $S/fx "…git show origin/feature:notes.txt (do not fetch)… codename…" --task-id live2
oskhs: round live2 in repo-fx:/sandbox/tasks/live2
{"taskId":"live2","sandbox":"repo-fx","kind":"answer","text":"HERON",…}
rc=0
```

## 3.3 Timeout ends Maki and its tools inside the sandbox

```
$ time bun oskhs/src/cli.ts run-round $S/fx "Run the shell command 'sleep 120' and then say done." --timeout 8 --task-id live3
{"taskId":"live3","sandbox":"repo-fx","kind":"timeout","seconds":8}
rc=4   8.49 s total
$ openshell sandbox exec -n repo-fx -- sh -c 'ps -eo pid,args | grep -E "maki|sleep"'
no-leftover-processes
```

Before the tag sweep (plain `timeout` only) the same prompt left `sleep 120`
running with its own pgid/sid — the reason for design decision 5.

## 3.4 No credential values in the sandbox environment

Every credential-like variable was classified inside the sandbox; only the
names and classes left it:

```
SYNTHETIC_API_KEY stand-in
```

"stand-in" means the value is the gateway-issued, revision-scoped token
ending in `_SYNTHETIC_API_KEY` (docs/verification.md check 2), not a key.
No Mongo or GitLab variables exist. `curl https://gitlab.com` from the
sandbox: HTTP code `000` (denied by deny-by-default egress).
