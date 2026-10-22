# Live exit for add-oskhs-incremental-sync (B1.1b)

Recorded 2026-10-23 on the local gateway (OpenShell 0.1.5, Maki 0.6.4),
`synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017` on `maki-synthetic`.
Fresh `repo-fx` sandbox; fixture from `oskhs/test/make-fixture.sh` (now with
a ~300 KB `data.txt`). Usage counters trimmed from the JSON below; the raw
log follows.

| Step | bundleBytes | prerequisites | updated / pruned | answer |
|---|---|---|---|---|
| s1 first round (full) | 115 375 | 0 | origin/main | PELICAN |
| s2 after one host commit (delta) | 1 040 | 1 | origin/main | OSPREY |
| s3 `--branch feature`, agent runs `git checkout feature` | 669 | 1 | origin/feature | HERON |
| s4 same again (nothing new) | 0 | 0 | — | HERON |
| s5 after `git branch -D feature` on the host | 0 | 0 | pruned origin/feature | ok |
| s6 after the "agent" moved origin/main to its own commit | 116 582 | 0 | origin/main reset to host tip | KESTREL |

- The delta is 0.9 % of the full bundle.
- s3 found the stale-branch hazard: the DWIM checkout left
  `refs/heads/feature` behind. After the fix (design decision 9) s4 leaves
  `refs/heads/*` empty.
- s6: the agent-moved tip was not used as a prerequisite (the host lacks that
  commit), so the bundle grew to full size — the designed worst case — and
  the ref was force-reset to the host tip (`025782e` both sides).
- `git fetch` / `git pull` in a worktree fail locally against
  `/oskhs-offline` (exit 128 / 1) with no network attempt.

## Raw log

```
$ run-round What is the secret word in README.md? Just the word. --task-id s1
oskhs: creating sandbox repo-fx
oskhs: sync repo-fx: 115375 bytes, 1 updated, 0 pruned
{"taskId":"s1","sandbox":"repo-fx","kind":"answer","text":"PELICAN","sessionId":"CgHvGkPByaAjzB6JipU8D","durationMs":4172,"numTurns":3,"sync":{"bundleBytes":115375,"updated":["refs/remotes/origin/main"],"pruned":[],"prerequisites":0,"full":false}}
rc=0
$ run-round What is the second secret in SECOND.md? Just the word. --task-id s2
oskhs: sync repo-fx: 1040 bytes, 1 updated, 0 pruned
{"taskId":"s2","sandbox":"repo-fx","kind":"answer","text":"OSPREY","sessionId":"CgHvH97gHhvx3v39VCKjb","durationMs":3769,"numTurns":3,"sync":{"bundleBytes":1040,"updated":["refs/remotes/origin/main"],"pruned":[],"prerequisites":1,"full":false}}
rc=0
$ run-round Run: git checkout feature, then read notes.txt and tell me the codename. Just the word. --branch feature --task-id s3
oskhs: sync repo-fx: 669 bytes, 1 updated, 0 pruned
{"taskId":"s3","sandbox":"repo-fx","kind":"answer","text":"HERON","sessionId":"CgHvHUmsFJNuGwQDF9uBW","durationMs":5335,"numTurns":3,"sync":{"bundleBytes":669,"updated":["refs/remotes/origin/feature"],"pruned":[],"prerequisites":1,"full":false}}
rc=0
## 2.2b stale local branch cleanup (after fix)
$ run-round Run: git checkout feature, then read notes.txt and tell me the codename. Just the word. --branch feature --task-id s4
oskhs: sync repo-fx: 0 bytes, 0 updated, 0 pruned
{"taskId":"s4","sandbox":"repo-fx","kind":"answer","text":"HERON","sessionId":"CgHvPt2X8oY5eAXwHb6vq","durationMs":4280,"numTurns":3,"sync":{"bundleBytes":0,"updated":[],"pruned":[],"prerequisites":0,"full":false}}
rc=0
$ sandbox: git -C /sandbox/repo for-each-ref --format="%(refname)" refs/heads | wc -l
0
## 2.3 prune
$ run-round Say ok. --task-id s5
oskhs: sync repo-fx: 0 bytes, 0 updated, 1 pruned
{"taskId":"s5","sandbox":"repo-fx","kind":"answer","text":"ok","sessionId":"CgHvQF5YZAM1fJ5amNovs","durationMs":1493,"numTurns":1,"sync":{"bundleBytes":0,"updated":[],"pruned":["refs/remotes/origin/feature"],"prerequisites":0,"full":false}}
rc=0
$ sandbox: git -C /sandbox/repo for-each-ref --format="%(refname)"
refs/remotes/origin/main
## 2.4 agent-moved ref
$ sandbox: cd /sandbox && rm -rf /sandbox/tasks/evil && git -C repo worktree add -q --detach /sandbox/tasks/evil refs/remotes/origin/main && cd /sandbox/tasks/evil && echo x > evil.txt && git add -A && git -c user.name=a -c user.email=a@a commit -qm agent && git update-ref refs/remotes/origin/main HEAD && git rev-parse --short refs/remotes/origin/main && git -C /sandbox/repo worktree remove --force /sandbox/tasks/evil
0f0d082
$ run-round What word is in THIRD.md? Just the word. --task-id s6
oskhs: sync repo-fx: 116582 bytes, 1 updated, 0 pruned
{"taskId":"s6","sandbox":"repo-fx","kind":"answer","text":"KESTREL","sessionId":"CgHvQSKDveLbdNGF2LuPS","durationMs":3410,"numTurns":2,"sync":{"bundleBytes":116582,"updated":["refs/remotes/origin/main"],"pruned":[],"prerequisites":0,"full":false}}
rc=0
$ sandbox: git -C /sandbox/repo rev-parse --short refs/remotes/origin/main
025782e
host main: 025782e
## 2.5 network git
$ sandbox: git -C /sandbox/repo worktree add -q --detach /sandbox/tasks/n refs/remotes/origin/main && cd /sandbox/tasks/n && git fetch; echo fetch-rc=$?; git pull; echo pull-rc=$?; git -C /sandbox/repo worktree remove --force /sandbox/tasks/n
fatal: '/oskhs-offline' does not appear to be a git repository
fatal: Could not read from remote repository.

Please make sure you have the correct access rights
and the repository exists.
fetch-rc=128
fatal: '/oskhs-offline' does not appear to be a git repository
fatal: Could not read from remote repository.

Please make sure you have the correct access rights
and the repository exists.
pull-rc=1
```
