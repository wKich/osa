# Spec Delta

## Purpose

Lets Conveyor run Maki and OpenCode as local CLI agents on the runner host, behind the existing unsafe-mode gate, without changing the OpenShell `maki-osa` path.

## ADDED Requirements

### Requirement: Local Maki and OpenCode are explicit unsafe modes

Conveyor SHALL accept `maki` and `opencode` as known runner-profile agent modes. Both SHALL be treated as unsafe: a profile using either mode SHALL require `DeveloperSettings.UnsafeMode`, SHALL be hidden from scheduling by `RunnerAccessPolicy` while unsafe mode is off, and SHALL show the unsafe-mode warning in the runner profile UI. Neither mode SHALL be described as isolated, sandboxed, or safe.

#### Scenario: Unsafe mode is off

- **WHEN** an administrator saves a runner profile with `maki` or `opencode` while `UnsafeMode` is off
- **THEN** the profile is rejected or hidden by the existing unsafe-runner policy, and the runner receives no tasks

#### Scenario: Unsafe mode is on

- **WHEN** an administrator enables `UnsafeMode` and saves a runner profile with `maki` or `opencode`
- **THEN** the profile is accepted, the runner can receive tasks, and the UI marks the local execution as unsafe

#### Scenario: OpenShell mode is not mislabeled

- **WHEN** a runner profile uses `maki-osa`
- **THEN** `maki-osa` keeps its existing safe OpenShell behavior and is not affected by the local-mode gate

### Requirement: Local Maki runs the host CLI in the task worktree

For a local `maki` run, the runner SHALL start the configured host `maki` executable with `--print --yolo --trust --output-format stream-json --verbose`, the resolved `--model`, and the resolved session flags. It SHALL write the prompt to standard input and SHALL NOT put the prompt in the command arguments. It SHALL parse stdout with the existing Claude-compatible stream parser. The agent SHALL edit the Conveyor task worktree directly; the runner SHALL NOT use `sync-in`, `collect-patch`, or `git apply`.

#### Scenario: Developer run

- **WHEN** a local `maki` developer run resolves model `deepseek/deepseek-chat` and resumes session `S1` with a fork
- **THEN** the host command contains `maki --print --yolo --trust --output-format stream-json --verbose --model deepseek/deepseek-chat --resume S1 --fork-session`, and the prompt is only on stdin

#### Scenario: Missing host CLI

- **WHEN** the configured `maki` executable does not exist
- **THEN** the run fails before starting an agent with an error naming the executable, and the worktree is unchanged

#### Scenario: Maki reports an error result

- **WHEN** the stream contains an error `result`
- **THEN** Conveyor marks the run failed and reports the result text as the cause

### Requirement: Local OpenCode runs the host CLI in the task worktree

For a local `opencode` run, the runner SHALL start the configured host `opencode` executable with `run --standalone --auto --format json`, the resolved `--model`, and the resolved session selection. It SHALL write the prompt to standard input and SHALL NOT put the prompt in the command arguments. It SHALL parse the JSONL event stream, including `sessionID`, final text, tool events, per-step tokens, cost, and errors, into Conveyor events and usage. The agent SHALL edit the Conveyor task worktree directly; the runner SHALL NOT use `sync-in`, `collect-patch`, or `git apply`.

#### Scenario: Developer run

- **WHEN** a local `opencode` developer run has model `synthetic/hf:zai-org/GLM-5.3`
- **THEN** the host command contains `opencode run --standalone --auto --format json --model synthetic/hf:zai-org/GLM-5.3`, and the prompt is only on stdin

#### Scenario: Resume is requested

- **WHEN** Conveyor supplies session `ses_123` for a local `opencode` run
- **THEN** the helper receives `--session ses_123`, the stream reports the session id, and the run records usage and a result

#### Scenario: Missing host CLI

- **WHEN** the configured `opencode` executable does not exist
- **THEN** the run fails before starting an agent with an error naming the executable, and the worktree is unchanged

### Requirement: Local modes keep the existing worktree and commit boundary

Local Maki and OpenCode SHALL run inside the task worktree created by Conveyor. The runner SHALL collect the task diff after a completed run using the existing diff path, SHALL NOT commit or push, and SHALL leave commit and push to the human. The runner SHALL NOT create a sandbox, a retained container, or an OpenShell workspace binding for either local mode.

#### Scenario: Successful local run

- **WHEN** a local Maki or OpenCode run completes and changes files
- **THEN** the changes are visible in the task worktree, the normal diff is available to Conveyor, and no commit or push is performed

#### Scenario: Cancellation

- **WHEN** the user stops a local Maki or OpenCode run
- **THEN** the run finishes as stopped, no sandbox or container cleanup is attempted, and the worktree keeps whatever the agent already wrote

### Requirement: Session behavior is explicit per local agent

For local Maki, Conveyor SHALL forward fresh, resume, and fork choices using Maki's `--resume` and `--fork-session` flags. For local OpenCode, Conveyor SHALL forward a resumed session with `--session` and SHALL NOT request a fork. If no session id is supplied, both modes SHALL start a fresh conversation. A missing session SHALL use Conveyor's existing lost-session recovery rather than being reported as a successful resume.

#### Scenario: Fresh run

- **WHEN** Conveyor starts a local run with no resumed session id
- **THEN** no resume or continue flag is passed and a new agent conversation starts

#### Scenario: Fork is requested for OpenCode

- **WHEN** Conveyor would request a forked session for a local `opencode` run
- **THEN** the run starts a fresh OpenCode conversation instead, and Conveyor does not claim that the original session was continued

### Requirement: Local modes do not expose credentials through Conveyor

Conveyor SHALL NOT pass model API keys, provider tokens, or other secrets to a local Maki or OpenCode process through command arguments or injected environment variables. Local authentication SHALL remain the host CLI's own configuration or environment. The local modes SHALL NOT read or reuse OpenShell provider profiles, `maki-oss` settings, or `opencode-oss` settings.

#### Scenario: No secret in argv

- **WHEN** a local Maki or OpenCode run starts
- **THEN** the command line contains the model and session selection but no credential value

#### Scenario: OpenShell settings are irrelevant

- **WHEN** a host has `Runner:MakiImage`, `Runner:MakiProvider`, or `Runner:MakiGateway` configured
- **THEN** a local `maki` run does not consult or require those settings

### Requirement: The UI and routing distinguish local from OpenShell

The runner-profile editor SHALL offer `maki` and `opencode` in the local place and SHALL keep `maki-osa` in the OpenShell place. Routing SHALL map local `maki` and `opencode` to their agent kinds and SHALL keep the existing `maki-osa` mapping. The UI SHALL NOT offer `opencode-osa` as part of this change.

#### Scenario: Runner profile choices

- **WHEN** an administrator opens the runner-profile editor
- **THEN** Maki and OpenCode each have a local choice, Maki also has its existing OpenShell choice, and OpenCode has no OpenShell choice

#### Scenario: Routing a local runner

- **WHEN** a route stage is assigned to a local Maki or OpenCode runner
- **THEN** the stage resolves to the matching agent kind and the runner's configured model and effort behavior
