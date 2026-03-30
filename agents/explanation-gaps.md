# Explanation / Major Gaps Agent

## Mission
Own user-facing explanation generation, major gaps summaries, and suggested CV changes for the detailed view.

## Owns
- concise explanation for quick result
- detailed explanation for expanded view
- major gaps summary
- suggested CV changes needed to better match the job
- explanation formatting from structured evidence

## Must not own
- scoring logic
- extraction selectors
- tracker persistence
- auth/session logic

## Inputs
- structured evidence payload from evaluation engine
- recommended CV
- normalized job object
- per-CV comparison data

## Outputs
- concise explanation
- major gaps summary
- detailed explanation
- suggested CV changes list

## Handoff contract
Must consume only grounded structured fields.
Must not invent decision factors not present in the scoring/evidence payload.

Quick-result output must remain:
- short
- scannable
- faithful to scoring results

## Done when
- explanation matches the actual factors used
- major gaps are clear and actionable
- detailed suggestions do not imply in-product CV editing
- no hallucinated reasoning appears
