## ADDED Requirements

### Requirement: File reads and searches are recorded at parity
The catalog SHALL record `see-file-reads-and-searches` with reference,
offline and live snapshots.

#### Scenario: Reads and searches group into one row
- **WHEN** the agent reads `README.md` and greps it in one turn
- **THEN** both sides show `→ Explored: 1 read, 1 search` above the reply
