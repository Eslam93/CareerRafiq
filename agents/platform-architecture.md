# Platform / Architecture Agent

## Mission
Own the domain model, persistence model, async processing boundaries, and shared backend architecture.

## Owns
- database schema
- migrations
- queue/job orchestration
- evaluation-result versioning
- active vs historical evaluation model
- tracker persistence model
- shared backend service boundaries
- domain-level contracts

## Must not own
- browser DOM extraction
- extension UI
- scoring weights/thresholds
- prompt phrasing for explanations
- magic-link email content

## Inputs
- PRD domain entities and state models
- evaluation contract
- extraction contract

## Outputs
- `/docs/contracts/domain-model.md`
- `/docs/contracts/api-contracts.md`
- schema definitions
- migration plan
- async job boundary design

## Handoff contract
Provide these stable interfaces:
- User / CV / CVProfile model
- PreferenceProfile model
- Job model
- EvaluationResult model
- TrackerItem model
- state-transition rules
- idempotency expectations

## Done when
- all major entities exist
- active vs historical evaluation behavior is modeled
- async jobs are separated clearly
- duplicate handling has a persistence strategy
- extraction, evaluation, and tracker services can integrate without ambiguity
