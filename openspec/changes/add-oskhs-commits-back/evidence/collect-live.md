# Live exit for add-oskhs-commits-back (B1.2)

Recorded 2026-10-23 on the local gateway, `repo-fx`, model
`synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash-1017`. The fixture was
recreated first, so its commits had new ids and the sync sent a full bundle
(the old sandbox tip is unknown to the host — the designed fallback).

## 2.1 Edit, delete, rename → identical host branch

Prompt: change `calc.py`, delete `data.txt`, `git mv README.md README.txt`,
do not commit.

| | value |
|---|---|
| sandbox worktree final tree (oskhs log, before removal) | `5d8f80c0b2ea` |
| host `oskhs/k1^{tree}` | `5d8f80c0b2ea` |
| return bundle | 456 bytes, 1 commit |
| `git diff --name-status -M main oskhs/k1` | `R100 README.md README.txt`, `M calc.py`, `D data.txt` |
| commit | `Maki (oskhs) <maki@oskhs.invalid> oskhs: uncommitted changes from task k1` |

## 2.2 Question-only round

`changes: null`; host refs unchanged: `feature`, `main`, `oskhs/k1`.

## 2.3 Sandbox left clean

`/sandbox/.oskhs/out` empty, no `refs/heads/*` (so no `task-*`), no
`/sandbox/tasks/*`. (A `x.bundle` from a manual download spike made before
this change was found there and deleted; oskhs never wrote it.)

## Raw log

```
$ run-round Make exactly these three changes using shell commands, then stop: (1) in calc.py change 'return a + b' to 'return b + a'; (2) delete data.txt; (3) rename README.md to README.txt with git mv. Do not commit. Reply 'done'. --task-id k1 --timeout 300
oskhs: sync repo-fx: 115373 bytes, 1 updated, 0 pruned
oskhs: round k1 in repo-fx:/sandbox/tasks/k1
oskhs: collect k1: head 5973f8d9a6fb tree 5d8f80c0b2ea (bundle)
{"taskId":"k1","sandbox":"repo-fx","kind":"answer","text":"done","sessionId":"CgHvxBeoyKdDLPYdyfXxz","durationMs":6349,"numTurns":4,"sync":{"bundleBytes":115373,"updated":["refs/remotes/origin/main"],"pruned":[],"prerequisites":0,"full":false,"tips":{"refs/heads/main":"bd4173d9176a81bbc28468153c6ed2eabfc8d234"}},"changes":{"branch":"oskhs/k1","head":"5973f8d9a6fb17879f8e1081c6d527d2d251b366","base":"bd4173d9176a81bbc28468153c6ed2eabfc8d234","commits":1,"bundleBytes":456,"files":{"added":[],"modified":["calc.py"],"deleted":["data.txt"],"renamed":[{"from":"README.md","to":"README.txt"}]}}}
rc=0
host tree: 5d8f80c0b2ea
R100	README.md	README.txt
M	calc.py
D	data.txt
5973f8d Maki (oskhs) <maki@oskhs.invalid> oskhs: uncommitted changes from task k1
$ run-round What does calc.py's add function return? Answer briefly. --task-id k2
oskhs: sync repo-fx: 0 bytes, 0 updated, 0 pruned
oskhs: round k2 in repo-fx:/sandbox/tasks/k2
oskhs: collect k2: head bd4173d9176a tree 0bd710bf630b (none)
{"taskId":"k2","sandbox":"repo-fx","kind":"answer","text":"The sum `a + b`.","sessionId":"CgHvxj4RvRsaDvftJgqja","durationMs":3921,"numTurns":3,"sync":{"bundleBytes":0,"updated":[],"pruned":[],"prerequisites":0,"full":false,"tips":{"refs/heads/main":"bd4173d9176a81bbc28468153c6ed2eabfc8d234"}},"changes":null}
rc=0
refs/heads/feature
refs/heads/main
refs/heads/oskhs/k1
x.bundle
0
```
