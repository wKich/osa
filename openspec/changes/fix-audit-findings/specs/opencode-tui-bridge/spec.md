# Spec Delta

## ADDED Requirements

### Requirement: Reject cross-site bridge requests

The bridge MUST reject every HTTP request and WebSocket upgrade that carries a browser `Origin` header or `Sec-Fetch-Site: cross-site`, before reading or acting on the request body. A rejected request MUST NOT create a session, run a shell, create a terminal, emit an event, or change any sandbox file. Requests from the native OpenCode TUI carry no `Origin` header and SHALL continue to work. The loopback-only bind and the no-`--env` sandbox transport SHALL remain unchanged.

#### Scenario: A foreign-origin session request is refused
- **WHEN** a page sends `POST /api/session` with `Origin: https://evil.example` and a JSON body that names a session id
- **THEN** the bridge answers 403, creates no session, and a later read of that id answers 404

#### Scenario: A foreign-origin shell request is refused
- **WHEN** a page sends `POST /api/session/<id>/shell` with `Origin: https://evil.example` and a command
- **THEN** the bridge answers 403 and no command runs in the sandbox

#### Scenario: A browser WebSocket upgrade is refused
- **WHEN** a page opens a persistent-PTY WebSocket with `Origin: https://evil.example`
- **THEN** the bridge refuses the upgrade and no terminal is attached

#### Scenario: The native TUI still connects
- **WHEN** the OpenCode TUI sends a request without an `Origin` header
- **THEN** the bridge serves it as before

### Requirement: Terminal creation requires a live session

`POST /api/experimental/session/{sessionID}/terminal` SHALL answer 404 and
create no terminal when the session does not exist. Terminal routes for an
existing terminal SHALL keep their current behavior.

#### Scenario: A terminal is not created for an unknown session
- **WHEN** a client posts to the terminal route with an id that names no open session
- **THEN** the bridge answers 404, starts no sandbox process, and lists no terminal for that id

### Requirement: Bound retained event replay and release deleted-session resources

The bridge SHALL retain only a bounded number of recent event frames, and a bounded total byte size, for SSE reconnect replay. It SHALL evict the oldest frames when either bound is reached and SHALL replay only the retained frames to a new subscriber. Deleting a session SHALL remove that session's frame and admission chains, its edit metadata, and every persistent terminal created for it; a terminal whose shell exits SHALL not remain attached to a deleted session. Memory and terminal count for a long bridge run MUST stay bounded by these rules, not by the number of frames or terminals ever created.

#### Scenario: A long session has a bounded replay
- **WHEN** a session emits more frames than the replay bound and the TUI reconnects
- **THEN** the bridge answers the retained frames only, and its retained-frame memory stays within the configured bounds

#### Scenario: Deleting a session removes its terminals
- **WHEN** a session with a live terminal is deleted and the terminal snapshot is requested afterwards
- **THEN** the terminal route answers 404 and the bridge no longer holds the terminal's retained output

### Requirement: Answer session file and VCS routes from the session's checkout

For a session whose location is a known project worktree, `GET /api/fs/list`, `GET /api/fs/find`, prompt file mentions, edit-result diffs, and `GET /api/vcs/diff`, `/api/vcs/base`, and `/api/vcs/status` SHALL read the session's worktree, not the main checkout. A client directory that is the main checkout, or that is not a known worktree, SHALL continue to map to the main checkout. A path outside the selected checkout MUST NOT be read. The response's `location.directory` SHALL remain the directory the client named, as it is today.

#### Scenario: A worktree lists its own files
- **WHEN** a session is open in a worktree containing `wt-only.txt` and the TUI lists that worktree
- **THEN** the response contains `wt-only.txt` and does not contain a file that exists only in the main checkout

#### Scenario: A worktree attachment reads the worktree file
- **WHEN** a prompt in a worktree session mentions a `file://` path under that worktree
- **THEN** the child receives the worktree file's bytes, not the main checkout's file with the same relative path

#### Scenario: A worktree diff reviews the worktree
- **WHEN** the worktree has an uncommitted change and the TUI opens the working diff for that worktree
- **THEN** the diff contains the worktree's changed file and not the main checkout's changes

#### Scenario: A host path still maps to the main checkout
- **WHEN** the TUI names its host project directory rather than a sandbox worktree
- **THEN** the file and attachment routes read the main sandbox checkout, and no host path is read

### Requirement: Bound git patch work for large repositories

The bridge SHALL split the git commands used to gather status and patches into bounded exec batches, and SHALL stop producing patches once the total patch budget is reached. A repository with many untracked or changed files MUST NOT fail because one exec carries more commands or bytes than the sandbox transport accepts, and MUST NOT build patches for every file after the budget is exhausted.

#### Scenario: Many untracked files still answer status
- **WHEN** a checkout contains a thousand untracked files and the TUI requests `/api/vcs/status`
- **THEN** the bridge runs more than one bounded exec, returns a status for each file within the request budget, and does not answer 503 because of the argument limit

#### Scenario: Patch budget stops extra work
- **WHEN** the changed files would produce more than the total patch budget
- **THEN** the bridge returns the files it can and marks the remaining patches as capped instead of generating every patch

### Requirement: Fork boundary names a copied message

`POST /api/session/{sessionID}/fork` without `before` SHALL set `fork.boundary.messageID` to a message that exists in the fork transcript. An incomplete assistant message at the parent's tail MUST NOT be named as the boundary, because it is not copied. The fork title, parent link, and `session.forked` frame SHALL keep their current behavior.

#### Scenario: Forking an in-flight turn names a copied message
- **WHEN** the parent ends with a user message and an assistant message that has no completion time, and the user forks the session
- **THEN** the fork's history contains the copied user message and the `fork.boundary.messageID` names that message, not the incomplete assistant message
