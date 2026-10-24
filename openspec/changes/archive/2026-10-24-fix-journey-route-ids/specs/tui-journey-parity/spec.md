## MODIFIED Requirements

### Requirement: Offline reproducibility gate
The offline suite SHALL re-diff every committed journey snapshot and reproduce
the row's committed status. Journey scripts SHALL name exactly the checkpoints
their catalog rows name, in the catalog's order. Maki-side journey request logs
SHALL join the measured route set, with every id path segment named by the
pinned contract's parameter (`{sessionID}`, `{requestID}`, `{inboxID}`,
`{messageID}`). `make compat` SHALL fail while the committed
report disagrees with the catalog, statuses, or defect inventory.

#### Scenario: A status that disagrees with its snapshots fails
- **WHEN** the offline suite re-diffs a journey's committed snapshots
- **THEN** the result equals the row's committed status, and a mismatch fails
  the suite and names the journey and checkpoint

#### Scenario: Script checkpoints match the catalog
- **WHEN** a journey script names a checkpoint id the catalog row lacks, or
  misses one it has
- **THEN** the offline suite fails and names the journey

#### Scenario: Journey traffic widens the measured set
- **WHEN** a Maki-side journey log records a route whose status row is
  `out-of-scope`
- **THEN** the offline suite fails until that route is recorded `reachable`

#### Scenario: The committed report is current
- **WHEN** a journey status, evidence path, or matrix row changes
- **THEN** `make compat` exits non-zero until the regenerated report is
  committed

#### Scenario: A message-id route is measured by its template
- **WHEN** a journey deletes a queued prompt
- **THEN** its request log records `DELETE /api/session/{sessionID}/inbox/{inboxID}`

