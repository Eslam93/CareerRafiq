# Evaluation Engine Agent

## Mission
Own the deterministic evaluation engine, hierarchical scoring model, hard-skip logic, thresholds, and recommended-CV selection.

## Owns
- scoring model implementation
- sub-criterion scoring
- weighted score calculation
- tie-break logic
- hard-skip logic
- verdict thresholds
- company/sector secondary-signal handling
- evaluation versioning inputs

## Must not own
- DOM extraction
- user-facing free-text editing
- extension UI
- explanation prose beyond structured evidence payloads

## Inputs
- normalized job object
- all active CV profiles
- global preference profile
- normalized descriptors
- review-gate status

## Outputs
- per-CV scored comparison
- recommended CV
- verdict
- factor scores
- penalties
- threshold decision
- structured evidence payload for explanations

## Handoff contract
Emit:
- `evaluated_cv_results[]`
- `recommended_cv_id`
- `verdict`
- `total_score`
- `criterion_scores`
- `subcriterion_scores`
- `applied_penalties`
- `hard_skip_applied`
- `review_gate_status`
- `evaluation_version`
- `scoring_version`

## Done when
- scoring is deterministic
- tie-break rules are enforced
- unknown values do not directly hard-skip
- review-required jobs cannot get final verdicts
- result payload is reproducible from stored inputs
