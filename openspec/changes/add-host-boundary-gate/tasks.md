# Tasks

## 1. Scripted isolation checks

- [ ] 1.1 Add `tests/boundary/checks.sh` with one function per check: refused endpoint in no policy, credential variable holding a gateway-issued placeholder rather than a key, no host path visible, uid/gid 1500, no bind mount, and the refusal present in the gateway log. Verify: each function prints its assertion and returns non-zero on failure.
- [ ] 1.2 Make the credential check assert shape only and never print a value. Verify: a fixture holding a key-shaped value fails the check, names the variable, and the captured output contains no substring of the value.
- [ ] 1.3 Make an egress check fail when it would pass only because of a wildcard rule. Verify: a fixture policy with a wildcard host fails the check and names the rule.
- [ ] 1.4 Make the gateway-log check name the pinned gateway version and fail informatively when the log format is unrecognized. Verify: an empty log and an unexpected format both fail with the version in the message.
- [ ] 1.5 Record any check that cannot be automated as manual and make the run incomplete. Verify: forcing the manual path makes the gate report incomplete, not passed.

## 2. The gate

- [ ] 2.1 Add `make test-boundary` composing `make test-all`, the live journey run, and the checks, naming the failing part and failing on a missing prerequisite instead of skipping. Verify: with no reachable gateway it exits non-zero naming the gateway; with one broken check it names that check.
- [ ] 2.2 Confirm `make test-all` is unchanged in meaning. Verify: `make test-all` still runs and reports the same suites as before this change.

## 3. Patch handoff

- [ ] 3.1 Implement the patch input: a patch file plus a base commit, applied to a throwaway checkout with a fixed identity, removed on any exit. Verify: a valid patch produces a fresh checkout, a result, and no leftover directory.
- [ ] 3.2 Refuse a mismatched base, a dirty target, and a path escaping the checkout, before running any suite. Verify: three cases, each asserting exit non-zero, the named reason, and that no suite ran.
- [ ] 3.3 Run only the fixed command set even when the patch edits the task runner or a Makefile target. Verify: a patch that rewrites `make test-all` still runs the documented commands and the gate's output names them.

## 4. Claims and records

- [ ] 4.1 Add `docs/ai/verification/claims.md` with the four layers and exactly one authoritative suite and runner each. Verify: `scripts/check-links.sh` passes and the page states that a sandbox pass is never a boundary claim.
- [ ] 4.2 Print a record block on completion: gateway, agent, engine, and image versions, patch commit, each check and its outcome, and a verdict that distinguishes passed from incomplete. Verify: a passing run and a run with a manual or skipped check both print the block with different verdicts.
- [ ] 4.3 Add the record format to `docs/verification-log.md` and require gate evidence. Verify: the documented example contains every field the gate prints and no credential value.
- [ ] 4.4 Point the hand-run sections of the four verification pages at the scripted gate without deleting the explanatory prose. Verify: each page links to the gate and no page still instructs a human to perform a check the gate automates.

## 5. Integration

- [ ] 5.1 Connect the sandbox loop to the gate: the development page states that work leaves as a patch and the host or CI runs the gate. Verify: the page names `collect-patch`, the gate target, and that nothing runs automatically.
- [ ] 5.2 Decide and record whether the gate joins CI, and if so add the job. Verify: the workflow (or the documented decision) exists and names the required gateway and engine prerequisites.
