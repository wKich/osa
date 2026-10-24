# Proposal

## Why

The live `allow-permission-once` journey shows every Maki bash call failing
with `Permission denied (os error 13)`. Maki's bash plugin spawns each job
with `stdin(Stdio::null())` (`maki-lua/src/api/fn.rs` v0.6.4 L299), which
opens `/dev/null`, and `examples/policies/maki-minimal.yaml` does not list
it. OpenShell's own default policy grants `/dev/null` read-write, and its
baseline filesystem paths add it whenever a policy has a network rule
([Default policy](https://docs.nvidia.com/openshell/how-it-works/policies/default-policy.md),
v0.1.5). A sandbox created with `--provider` therefore already has it; one
created without a provider — the live journey run, or any offline sandbox —
cannot run a single shell command.

## What Changes

- `examples/policies/maki-minimal.yaml` and `examples/policies/maki-git-push.yaml`
  list `/dev/null` under `read_write`, matching the OpenShell default and
  baseline. No other path, no network rule, no provider.
- Docs that state the writable set name the null device.
- Defect `minimal-policy-denies-dev-null` closes; `allow-permission-once` is
  re-recorded live.

## Capabilities

### New Capabilities

- `sandbox-policy`: the example policies' filesystem floor.

### Modified Capabilities

(none)

## Impact

`examples/policies/*.yaml`, `AGENTS.md`, `docs/setup-guide.md`,
`docs/verification.md`, `bridge/defects.json`, journey live evidence. The
effective policy of a provider-backed sandbox is unchanged: the baseline
already contained `/dev/null`. Egress, credentials, and the run-as user are
unchanged.
