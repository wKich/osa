# Live exit for add-oskhs-merge-requests (B1.4)

Recorded 2026-10-23 on the kiss dev stand (channel `kiss-local-test` marked
`executor: oskhs`), local gateway, real GitLab (`git.skbkontur.ru`).
`OSKHS_GITLAB_URL=https://git.skbkontur.ru`, `OSKHS_GITLAB_TOKEN` = the dev
stand's bot token (user `svc_kiss`, Developer on both dev repositories),
fresh mirror dir (nothing hand-made).

## 3.1 A code request ends with an MR linked in the thread

Task `o14a0001`: «Добавь в конец файла README.md репозитория ascii-minecraft
одну строку: «Проверено oskhs (B1.4).» Больше ничего не меняй.»

```
oskhs: cloned mirror dmitry.lazarev/kiss
oskhs: cloned mirror dmitry.lazarev/ascii-minecraft-mimo-2.6-pro
oskhs: sync repo-kiss-local/dmitry.lazarev_kiss: 0 bytes, 0 updated, 0 pruned
oskhs: sync repo-kiss-local/dmitry.lazarev_ascii-minecraft-mimo-2.6-pro: 0 bytes, 0 updated, 0 pruned
oskhs: round o14a0001 in repo-kiss-local:/sandbox/tasks/o14a0001 (dmitry.lazarev_kiss, dmitry.lazarev_ascii-minecraft-mimo-2.6-pro)
oskhs: collect o14a0001/dmitry.lazarev_kiss: head ed302a6ad5f4 tree 97b397d8e10a (none)
oskhs: collect o14a0001/dmitry.lazarev_ascii-minecraft-mimo-2.6-pro: head 837e54f0c417 tree 7576c05df2c3 (bundle)
oskhs: MR !1 for dmitry.lazarev/ascii-minecraft-mimo-2.6-pro (docs/readme-verified-oskhs → master)
```

Task afterwards: `state: review`, `runtimeState: idle_stopped`,
`taskDescription` and `replyMessage` from the `[RESULT]` block, and

```
taskRepositories:
  - projectPath: dmitry.lazarev/kiss                       (unchanged: no changes there)
  - projectPath: dmitry.lazarev/ascii-minecraft-mimo-2.6-pro
    mrUrl: https://git.skbkontur.ru/dmitry.lazarev/ascii-minecraft-mimo-2.6-pro/-/merge_requests/1
    mrIid: 1
    branchName: docs/readme-verified-oskhs                 (the agent's proposal, free on GitLab)
```

GitLab (API read back): MR !1 `opened`, `docs/readme-verified-oskhs →
master`, assignee `svc_kiss`, labels `['ai_generated']`, title «docs: add
verification line to README», description = the `Description` field plus
`Источник задачи: https://chat.skbkontur.ru/_redirect/pl/f996kcch…`; the
diff is one added line at the end of `README.md`:
`+Проверено oskhs (B1.4).`

kiss, 5 s later:

```
[task-notifier]: 📋 Task o14a0001: review MR link(s) posted
```

The MR is left open in the developer's test repository as the record of
this check.

## 3.2 Mirror refresh; the token never in argv

- Mirror refs before the next round: `refs/heads/master` (the collected
  `refs/heads/oskhs/o14a0001` was pushed and dropped in the round). After a
  second task (`o14a0002`, a question — answered, `completed`, no MR):
  `refs/heads/docs/readme-verified-oskhs refs/heads/master`.
- The ps sampler: every 0.2 s during the first
  round, `ps -axww -o args` was searched for the token string:

```
ps samples=89 token-in-argv hits=0
```

git received the token only as `GIT_CONFIG_*` environment (an
`http.extraHeader`), the GitLab API as a `PRIVATE-TOKEN` header.
