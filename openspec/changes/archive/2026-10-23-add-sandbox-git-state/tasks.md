# Tasks

## 1. Capability

- [x] 1.1 Add `readGitState` over the sandbox exec. Verify: `sandbox-git.test.ts`.
- [x] 1.2 Answer `/api/vcs`, `/api/project` and `/api/location` from it, and
      make session `projectID` the same id. Verify: `sandbox-git.test.ts`;
      `make test-ui` passes.

## 2. Records

- [x] 2.1 Flip `vcs-branch-live` and `project-identity-live` to `verified` and
      the three routes to `served-live`. Verify: `crosscheck.test.ts`,
      `make compat`.

## 3. Wrap-up gate

- [x] 3.1 `bun bridge/test/discovery.ts`, `make test`, `make test-bridge`,
      `make compat`, `make lint`, `openspec validate add-sandbox-git-state`.
      Verify: all exit 0.
