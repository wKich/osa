# Spec Delta

## MODIFIED Requirements

### Requirement: Clear boundary to the sandbox playbook

The playbook SHALL end by handing off to `docs/ai/playbooks/maki.md` for
sandbox phases, and MUST NOT contain sandbox creation, policy selection, or
isolation-verification commands of its own.

#### Scenario: No overlap with sandbox phases

- **WHEN** `docs/ai/host-playbook.md` is searched for
  `openshell sandbox create`, `openshell policy set`, and
  `openshell sandbox exec`
- **THEN** there are no matches; those steps are reached only through the
  handoff link

#### Scenario: Handoff is present

- **WHEN** an agent finishes the daily-driver section
- **THEN** the playbook links to `docs/ai/playbooks/maki.md` and states that
  the sandbox phases continue there
