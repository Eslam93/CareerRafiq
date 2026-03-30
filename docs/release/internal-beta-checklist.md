# Internal Beta Release Checklist

## Purpose
Use this checklist to decide whether the current build is ready for an internal beta rollout.

This checklist aligns with the current PRD and agent contracts:
- deterministic evaluation
- review gate before verdict when extraction is low confidence or materially incomplete
- tracker as the source of truth
- compact extension quick result
- no redesign, no monetization, no reminders, no external enrichment in the core path

## Release Gates
- [ ] SQLite persistence is the live path for users, sessions, CVs, jobs, evaluations, tracker items, and outbox records.
- [ ] Cookie-based auth works end to end for web and extension.
- [ ] CSRF protection works for authenticated browser-origin write requests.
- [ ] Magic-link request and consume flow is functional in internal-beta mode.
- [ ] CV bootstrap accepts PDF, DOCX, and TXT uploads.
- [ ] At least one supported source can be captured, validated, evaluated, and tracked end to end.
- [ ] Low-confidence or incomplete extraction triggers review before verdict.
- [ ] Quick result remains compact: verdict, recommended CV, concise explanation, major gaps summary.
- [ ] API restart preserves active state and historical records.
- [ ] Core release tests and smoke checks pass.

## Benchmark Expectations
- [ ] Benchmarks cover the main supported sources and a mix of easy, medium, and noisy pages.
- [ ] Each benchmark case includes expected capture outcome, review-gate outcome, verdict, and recommended CV.
- [ ] Benchmark data includes at least:
  - [ ] clean Greenhouse and Lever pages
  - [ ] noisy LinkedIn and Indeed pages
  - [ ] Workday and Glassdoor examples
  - [ ] low-confidence and mixed-job cases
- [ ] Benchmark results are reproducible from stored inputs and the current evaluation version.
- [ ] A benchmark regression is treated as a release blocker until explained or fixed.

## Extractor Regression Expectations
- [ ] Each supported extractor has at least one stable fixture.
- [ ] Regression coverage checks title, company, location, description, source URL, and source identifier.
- [ ] Mixed-job contamination is explicitly flagged where relevant.
- [ ] Missing fields reduce certainty rather than forcing a hard skip unless the review gate requires it.
- [ ] Extraction changes do not silently change the normalized job object shape.
- [ ] Correction flow returns revised extraction data cleanly into validation and evaluation.

## Analytics Coverage Checklist
- [ ] CV upload started and completed.
- [ ] CV profile generated.
- [ ] Setup marked minimum-ready.
- [ ] Email extracted.
- [ ] Magic link sent.
- [ ] Email verified.
- [ ] Job capture started and succeeded.
- [ ] Job review required, confirmed, or edited.
- [ ] Evaluation started and completed.
- [ ] Verdict shown.
- [ ] Recommended CV shown.
- [ ] Details view opened.
- [ ] Recommended CV accepted or overridden.
- [ ] Tracker opened and tracked job opened.
- [ ] Reevaluation requested and completed.
- [ ] Event payloads include the required identifiers and version fields.

## Known Non-Goals
- No monetization.
- No reminders or task automation.
- No external web enrichment in the core evaluation path.
- No auto-apply.
- No mobile app.
- No browser support beyond Chrome or Chromium for internal beta.
- No queued async worker architecture for beta.
- No redesign of the product flow beyond PRD boundaries.

## Rollout Checklist
- [ ] Confirm the latest build passed check, build, and test.
- [ ] Verify the internal-beta database file is initialized in a clean environment.
- [ ] Confirm the outbox can deliver or display a magic link in dev mode.
- [ ] Confirm the `/ops` page surfaces tracker counts, analytics coverage, and outbox lookup.
- [ ] Confirm `/ready` returns success in the target runtime.
- [ ] Run one setup flow, one supported capture flow, and one review-required flow.
- [ ] Review benchmark and extractor regression output for any new failures.
- [ ] Confirm analytics events fire for the main setup, capture, evaluation, and tracker steps.
- [ ] Share the rollout only with internal testers first.

## Calibration Notes
- Keep the evaluation model deterministic and versioned.
- Prefer review gate over unstable verdicts when extraction quality is weak.
- Unknown or missing job fields should reduce certainty, not directly trigger hard skip.
- Threshold or scoring changes must go through the evaluation engine contract and be versioned.
- Re-run benchmark cases after any extractor, evaluation, or review-gate change.
- Do not tune against a single source; calibrate across the supported source set.
