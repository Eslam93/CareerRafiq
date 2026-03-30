# Tracker / Workflow Agent

## Mission
Own the tracker as the persistent source of truth for each opportunity.

## Owns
- tracker item creation
- tracker item updates
- status transitions
- notes
- manual overrides
- active vs historical evaluation display behavior
- duplicate-merge/reuse behavior from tracker perspective

## Must not own
- scoring logic
- extraction selectors
- auth/session rules
- extension quick-result rendering

## Inputs
- normalized job object
- evaluation result
- duplicate-detection result
- user actions:
  - status change
  - notes
  - override

## Outputs
- tracker item
- tracker list payloads
- tracker detail payloads
- active evaluation reference
- historical evaluation references where applicable

## Handoff contract
Expose:
- tracker summary view model
- tracker detail view model
- override state
- current status
- active evaluation reference

Must preserve distinction between:
- system recommendation
- user action

## Done when
- every opportunity maps to one tracker record
- notes and status persist independently of evaluation re-runs
- active vs historical evaluations are clear
- archive behavior preserves history
