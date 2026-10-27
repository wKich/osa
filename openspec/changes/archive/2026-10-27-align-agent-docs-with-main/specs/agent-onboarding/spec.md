# Spec Delta

## ADDED Requirements

### Requirement: Shared dashboard and operator commands are documented

The shared setup path — `README.md`, `docs/ai/quickstart.md`,
`docs/ai/onboarding.md`, and every agent playbook — SHALL name the shared
operator commands that the current `osa` surface provides: `osa dashboard
[--open]`, `osa health SANDBOX`, `osa providers`, `osa provider setup`,
`osa images`, and `osa image build TAG`. The README and quickstart SHALL present
`osa dashboard --open` as the optional shared dashboard entry after setup and
SHALL link `dashboard/README.md`. Each agent playbook SHALL name
`osa health <sandbox>` in its verification or daily-driver section and SHALL
link the dashboard reference in `See also`. The setup path SHALL state that the
dashboard binds loopback by default, requires its session token for mutations
and sensitive reads, is read-only with `--read-only`, and is not a credential
store.

Provider examples SHALL name the non-interactive forms `--stdin` with
`--profile ID` and `osa provider setup TAG --profile ID`, SHALL keep the
credential on stdin or in an environment variable populated outside the
recorded command, and MUST NOT place a credential value in argv or shell
history. Codex SHALL keep its host-only ChatGPT login as the provider path and
SHALL state that the dashboard shows the terminal command instead of a setup
wizard.

Image examples SHALL name `osa images` to report the base and configured image
and `osa image build TAG` to build a base image, and SHALL state that a
dashboard image build builds base images only.

#### Scenario: README and quickstart discover the dashboard

- **WHEN** a reader finishes the README quick start or the quickstart's setup
  steps
- **THEN** the next shared entry names `osa dashboard --open` and links
  `dashboard/README.md`, and the dashboard is marked optional

#### Scenario: Onboarding routes the shared operator commands

- **WHEN** a reader inspects `docs/ai/onboarding.md`
- **THEN** it names `osa dashboard`, `osa health`, `osa providers`,
  `osa provider setup`, `osa images`, and `osa image build`, and the four agent
  columns still route only to their own front-end

#### Scenario: Each playbook names health and the dashboard

- **WHEN** a reader opens any of the four agent playbooks
- **THEN** the page names `osa health <sandbox>` in its verification or
  daily-driver section, names `osa dashboard --open`, and links
  `dashboard/README.md` in `See also`

#### Scenario: Provider examples keep the credential out of argv

- **WHEN** a reader follows a playbook's non-interactive provider example
- **THEN** the example uses `--stdin` with `--profile ID` or an environment
  variable populated outside the recorded command, and no `KEY=<value>`
  appears

#### Scenario: Codex keeps its host-only login

- **WHEN** a reader follows the Codex playbook or the dashboard's provider
  section for Codex
- **THEN** the provider path remains `codex-oss provider setup` on the host and
  the dashboard states that Codex shows the terminal command instead of a
  wizard

#### Scenario: Image examples use the shared image commands

- **WHEN** a reader inspects the environment playbook or a playbook's image
  phase
- **THEN** `osa images` reports the base and configured image,
  `osa image build TAG` builds a base image, and no page claims a dashboard
  build produces an environment store

#### Scenario: Dashboard security boundary is stated

- **WHEN** a reader opens the dashboard entry from the setup path
- **THEN** the path states loopback-only serving by default, token-gated
  mutations and sensitive reads, `--read-only`, and that credentials reach the
  dashboard only for the Setup wizard's stdin handoff
