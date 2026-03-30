# Evaluation Contract

## Input
- normalized job object
- active CV profiles
- preference profile
- normalized comparison descriptors
- review-gate status

## Output
- evaluated_cv_results[]
- recommended_cv_id
- verdict
- total_score
- criterion_scores
- subcriterion_scores
- applied_penalties
- hard_skip_applied
- review_gate_status
- evaluation_version
- scoring_version
- explanation_evidence_payload

## Rules
- No final verdict if review_gate_status = review_required
- Unknown values reduce certainty; they do not hard-skip by default
- Output must be reproducible from stored inputs
