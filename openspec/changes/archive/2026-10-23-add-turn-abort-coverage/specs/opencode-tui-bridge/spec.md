# Spec Delta

## ADDED Requirements

### Requirement: Fail an in-flight turn when the Maki child exits

The bridge SHALL end a turn that is in flight when its Maki child process
exits unexpectedly — crash, kill, or exit without a `result` frame — by
emitting `session.execution.failed` with the error shape
`{type: "Error", message}`, the message identifying the child's exit, and
SHALL NOT emit `session.execution.succeeded` for that turn. Parts already
emitted for the turn SHALL remain in the transcript. A prompt submitted to a
session whose child has exited SHALL be refused with a 503
service-unavailable answer and SHALL NOT open a new turn or write to the dead
child.

#### Scenario: Child exit fails the in-flight turn

- **WHEN** the Maki child emits assistant output and then exits without a
  `result` frame
- **THEN** the assistant parts already emitted remain in the transcript, the
  turn ends with exactly one `session.execution.failed` whose
  `error.type` is `Error` and whose message identifies the child's exit, and
  no `session.execution.succeeded` follows for that turn

#### Scenario: A prompt to a dead child fails closed

- **WHEN** a prompt is submitted to a session whose Maki child has already
  exited
- **THEN** the bridge answers 503 with a service-unavailable error and emits
  no `session.execution.started` for the rejected prompt
