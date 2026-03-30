# Extraction Validation / Review-Gate Agent

## Mission
Own validation of extracted job data, coherence checks, review-gate triggering, and correction-state logic.

## Owns
- extraction coherence checks
- low-confidence detection
- missing-critical-field assessment
- mixed-job detection
- review-required decision
- correction-state transition rules

## Must not own
- raw page extraction selectors
- final scoring thresholds
- extension UI shell
- tracker rendering

## Inputs
- raw extracted job payload
- normalized job object draft
- source metadata
- extraction confidence signals

## Outputs
- validation result
- review-gate decision
- list of:
  - extracted fields
  - missing fields
  - uncertain fields
- corrected job object acceptance path

## Handoff contract
Emit:
- `status = proceed | review_required | failed`
- `reasons[]`
- `missing_fields[]`
- `uncertain_fields[]`
- `normalized_job_object`
- `correction_allowed_fields[]`

## Done when
- verdict cannot be generated if review is required
- critical missing fields are enforced consistently
- corrected job data re-enters the pipeline cleanly
- mixed-job cases are handled explicitly
