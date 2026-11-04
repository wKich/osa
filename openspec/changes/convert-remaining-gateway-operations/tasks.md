# Tasks

Archive `add-openshell-sdk-transport` before starting: this change's
`gateway-client` delta modifies a requirement that change introduces.

This change removes the four CLI exemptions recorded by
`add-openshell-sdk-transport`. Start from that change's converted set and its
`OSA_GATEWAY_TRANSPORT=cli` selector; every converted operation must report
`transport-changed` or `identical` before its CLI implementation is removed.

## 1. Fixture channel

- [ ] 1.1 Give the suite one per-run fixture file per case (exec stdout/exit/cases, pending rule text, create arguments, attach/delete failures), written by `run_maki_with_input` and read by both the CLI stub and the fake gateway, and verify an existing case records identically before and after
- [ ] 1.2 Move the exec, rule, create, attach, and delete fixtures from environment-only reads to the channel, and verify `make test` passes with no golden changes
- [ ] 1.3 Verify the fixture channel cannot carry a credential value: the recorder, the leak scan, and the state digest see names only

## 2. Rule listing and provider create

- [ ] 2.1 Render `policy review` and the pending-proposal note from `list_rules` (chunk id, rule name, binary, endpoints, status, verdict), and verify the output matches the recorded CLI text
- [ ] 2.2 Convert `policy review` and the pending-proposal note to the trait, and verify their parity cases report `transport-changed` with identical state and output
- [ ] 2.3 Extend `ProviderSpec` with `from_existing`, `global_profile`, `runtime_credentials`, `credential_keys`, and config pairs, and implement them in the SDK and CLI transports
- [ ] 2.4 Convert `provider add` and `provider setup` create paths, and verify the provider-wrappers and setup parity cases report `transport-changed`
- [ ] 2.5 Verify a provider create with a sentinel credential still puts the value only in the designated request field, and that `--from-existing` adds no second channel

## 3. Sandbox create and exec

- [ ] 3.1 Record the full create spec in both transports (image, policy path, resources, providers, environment names), and verify the existing create assertions pass against the record
- [ ] 3.2 Convert `sandbox create`, and verify the create-race case still re-reads and reuses and the lifecycle parity cases report `transport-changed`
- [ ] 3.3 Add `exec_interactive` with stdin, TTY, resize, and a separate exit status; implement it in the SDK and CLI transports
- [ ] 3.4 Convert the interactive session, the timeout wrapper, and the script/probe exec helpers, and verify their parity cases report `transport-changed`
- [ ] 3.5 Verify an interrupt during an interactive exec ends the stream, restores the terminal, and leaves no orphaned process
- [ ] 3.6 Verify the fixture-driven probe outcomes (missing runtime, script failure, per-command output) match on both transports

## 4. Gate and cleanup

- [ ] 4.1 Add the converted-set parity run to `scripts/test-all.sh`, and verify a deliberate state or output change fails while `transport-changed` passes
- [ ] 4.2 Delete the exemption list from `docs/helper.md` and the narrowed requirement from the `gateway-client` spec, and verify the transport note lists only file transfer, gateway info/status, policy show/apply, settings, and provider profile import/lint
- [ ] 4.3 Verify `make test`, `make test-conformance-self`, `make test-core`, and `make test-all` pass, with one reviewed golden re-record and no test that needs a gateway or Docker
- [ ] 4.4 Verify no `run_gateway(` call site remains for a covered operation, and that the remaining `openshell` spawns are exactly the uncovered commands plus the CLI transport
