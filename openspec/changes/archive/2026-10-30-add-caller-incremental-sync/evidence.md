# Evidence

## Measurements (task 1.1)

Environment: macOS host, OpenShell gateway connected, image `maki-agent:personal`
(local helper config), caller sandbox `osa-inc-live` with workdir
`/sandbox/tasks/t1`. No host bind mount; all transfers used
`openshell sandbox upload`.

Workload: a git worktree with 5,001 host-filtered files and 11,839,007 bytes
(the upload filter excludes the temporary git object store). A 51 MiB
(52,432,000 byte) `build/` tree was created inside the sandbox and left
untouched; `build/` is ignored by the host `.gitignore`.

| Path | Wall time | Transfer |
| --- | ---: | --- |
| Full sync before manifest-index reuse | 6.24 s | 11.8 MB tree + git bundle |
| Full sync after manifest-index reuse | 3.74–4.16 s | 11.8 MB tree + git bundle |
| Incremental, no host change | 2.05 s | 378,073-byte manifest only |
| Incremental, one changed file | 2.25 s | manifest + one staged file |
| Incremental, changed + deleted + new file, 51 MiB artifact present | 2.52 s | manifest + changed/new staged files |

The manifest for this tree is 378,073 bytes. The host index is copied into the
temporary manifest index (with a git alternate to the host object store) so
clean files keep their stat cache instead of being rehashed; the temporary
index is also the `checkout-index` source for the staged transfer. The bundle
is not re-uploaded when the sandbox agent repository already has the host
`HEAD` and base.

The wall-clock delta is modest on this local gateway because the host scan and
git work dominate; the transfer delta is what the mode is for. A clean
incremental pass sends the manifest plus only changed files, while a full sync
sends the whole filtered tree and the bundle.

## Live verification (section 3)

All runs used the real OpenShell gateway, the image above, and a throwaway
sandbox that was removed explicitly at the end.

- **3.1 Two developer passes.** The first full pass uploaded the tree. A
  51 MiB ignored `build/` artifact was created in the workdir. Host changes
  then added an untracked file, deleted a tracked file, and modified a tracked
  file. The incremental pass returned in 2.52 s, the workdir received the new
  and changed files, the deleted path was gone, and `build/out.bin` survived.
  A following agent edit produced `collect-patch --json` with exactly
  `M files: src/d5/f5.txt`; `build/out.bin` was absent from the patch. A
  repository HEAD change is picked up by the history probe and re-runs the
  bundle/history setup only when needed.
- **3.2 Interrupted sync.** An incremental pass with a 31 MB new file was
  killed during the transfer. The dirty marker and the partially uploaded file
  were left in place. The next `--incremental` saw the marker, ran the full
  path (4.16 s), restored a consistent workdir, removed the ignored artifact,
  and `collect-patch` returned `{"empty":true,"files":[]}` — no duplicate
  patch. The manifest recorded a new baseline and completion marker.
- **3.3 Read-only role after incremental, then developer again.** A developer
  incremental pass kept the ignored artifact. A read-only-style full sync
  removed the artifact and an agent leftover. The next developer incremental
  pass created a new ignored artifact and changed a file; the artifact
  survived and the change arrived. Artifact policy was unchanged across roles.

## Automated tests

- osa: `make test` — 323 passed, 0 failed. New caller-sync tests cover the
  default full path, manifest filtering, changed/new/deleted paths, unchanged
  inode preservation, ignored-artifact preservation, non-ignored leftover
  removal, the helper `.git` file, spaces, symlinks, binaries, missing /
  malformed / version-mismatched / interrupted manifest fallback, and a failed
  incremental sync leaving no baseline.
- Conveyor: `dotnet test Conveyor.slnx` — 716 passed, 0 failed.
  `MakiOsaRunnerTests` verify full sync on first create, `--incremental` on
  developer rework in an existing binding, no `--incremental` for read-only
  roles, and an explicit reset (`Runner:MakiIncrementalSync=false`) forcing
  full sync.
- `openspec validate add-caller-incremental-sync --strict` passes.

The Conveyor UI stand was not raised in this session, so the live rework loop
above exercised the exact helper contract and argv that
`MakiOsaLauncher.SyncInArguments` produces; the runner-side selection is
covered by the suite rather than a second UI run.
