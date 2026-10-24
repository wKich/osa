## ADDED Requirements

### Requirement: Model variants are pin-blocked at Maki v0.6.4
The catalog SHALL record `switch-model-variant` as `blockedBy: "pin"` with a
citation of the pinned Maki source while Maki offers no reasoning-effort
control.

#### Scenario: Cycling the variant changes nothing on Maki
- **WHEN** the user presses `ctrl+t`
- **THEN** the reference footer shows `· low` and the Maki footer is
  unchanged, offline and live
