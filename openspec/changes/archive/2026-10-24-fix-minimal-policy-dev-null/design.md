# Design

## Decision

Grant `/dev/null` read-write in the base policy. It is a sink device: writes
are discarded and reads return EOF, so it adds no storage, no channel out of
the sandbox, and no host path. OpenShell treats it as part of the
filesystem floor (default policy and baseline paths, v0.1.5), so the change
makes a provider-less sandbox match the effective policy every
provider-backed sandbox already runs with.

## Alternatives

- Leave the policy and accept the live failure: rejected — a provider-less
  sandbox cannot run any bash command, which is a product defect, not a
  journey artifact.
- Attach a provider to the live run so the baseline adds `/dev/null`:
  rejected — live runs keep no provider and the in-sandbox mock.

## Security review

`openshell policy get <name> --full` for a provider-backed sandbox already
lists `/dev/null` read-write through the baseline; the delta for that
sandbox is empty. For a provider-less sandbox the only new grant is the null
device. Landlock `hard_requirement` and uid/gid 1500 are unchanged.
