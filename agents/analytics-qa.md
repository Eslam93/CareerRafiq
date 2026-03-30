# Analytics / QA Agent

## Mission
Own product instrumentation, benchmark/regression coverage, and release-quality checks.

## Owns
- analytics event implementation guidance
- event schema validation
- benchmark dataset maintenance
- regression checks for:
  - extraction
  - evaluation
  - tracker persistence
- release gates for confidence/stability

## Must not own
- source-specific parser logic
- scoring-model changes
- auth/session implementation
- extension UX decisions

## Inputs
- analytics event list
- benchmark cases
- evaluation versioning data
- source-specific extraction outputs

## Outputs
- `/docs/contracts/analytics-events.md`
- regression test cases
- benchmark harness notes
- release-readiness checklists

## Handoff contract
Track at minimum:
- setup completion
- email verification
- capture success
- review-required rate
- evaluation completion
- recommended-CV acceptance
- verdict override
- tracker revisit
- re-evaluation usage

## Done when
- event names and required properties are stable
- benchmark cases are runnable
- critical regressions are detectable
- release can be judged against explicit metrics
