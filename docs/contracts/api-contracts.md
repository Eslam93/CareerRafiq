# API Contracts

## Purpose
Define stable backend-facing contracts used by the web app and browser extension.

## Contract areas
- auth and onboarding
- CV upload and profile generation
- CV upload analysis, update matching, and library management
- job capture and validation
- evaluation and recommendation
- tracker CRUD and workflow actions
- internal ops and beta-support visibility
- runtime readiness and health signaling

## Contract principles
- Inputs and outputs must be versioned where behavior can change.
- API responses should preserve structured evidence instead of opaque summaries.
- Review-required outcomes must be explicit.
- User-confirmed fields must not be silently overwritten.
- Identity endpoints may apply basic request throttling where repeated delivery attempts would otherwise create abuse or operational noise.
- Tracker endpoints must preserve durable trust decisions and expose reset actions explicitly.
- Duplicate review must be resolved through explicit user actions, not silent backend heuristics.

## Required payload qualities
- stable identifiers
- explicit status values
- source metadata
- confidence or review flags where applicable

## CV intake and manager expectations
- `POST /api/setup/bootstrap` classifies each uploaded file before text extraction and returns per-file `uploadResults` in the bootstrap payload.
- Non-CV uploads are hard rejected with `status = rejected_non_cv` and a user-facing warning reason.
- Authenticated CV uploads use an analyze-then-commit flow:
  - `POST /api/cvs/uploads/analyze`
  - `POST /api/cvs/uploads/commit`
- Analyze responses must return per-file classification data, extracted text length, and strong-match candidates when a file appears to update an existing CV.
- Matching is user-local and deterministic, using exact title, fuzzy title, exact content, and similar-content signals.
- `resolution_required` means the client must explicitly choose `create_new` or `update_existing` before the upload can be committed.
- Updating an existing CV must preserve the logical `cvId` and active `CVProfile.id` while storing the prior file/content revision in `CVVersion` history.
- `GET /api/cvs` returns the active CV library with default flags, version counts, and active CV profile summaries.
- `GET /api/cvs/:cvId` returns the active CV, active profile, and ordered version history for that logical CV.
- `PATCH /api/cvs/:cvId/default` sets the default CV from the dedicated CV manager without requiring a second profile-edit payload.

## Tracker-specific expectations
- `PATCH /api/tracker/:jobId/recommendation` accepts `pending`, `accepted`, or `overridden` to support reset-to-system as well as explicit CV overrides.
- `PATCH /api/tracker/:jobId/verdict` accepts `pending`, `followed`, or `overridden` to preserve and reset verdict trust decisions.
- `PATCH /api/tracker/:jobId/duplicate` resolves probable duplicates with `pending`, `distinct_confirmed`, or `duplicate_confirmed`.
- `POST /api/jobs/:jobId/evaluate` returns the latest evaluation, tracker snapshot, and a human-readable `recommendedCvName` for compact clients such as the extension popup.
- `GET /api/tracker` returns tracker rows together with `recommendedCvName` and `selectedCvName` so web and extension surfaces do not need to render raw CV ids when a friendly name is available.

## Review and extraction expectations
- Manual job review edits must preserve field-level provenance instead of flattening everything into a generic saved state.
- Extraction metadata should expose deterministic field evidence for both core job identity fields and secondary enrichment fields such as recruiter signal, company sector, company type, keywords, and inferred scope or ownership cues.
- Review responses should expose merged field provenance so the UI can distinguish inferred values from user-corrected values after a save.

## Ops visibility expectations
- `GET /api/ops/summary` must expose actionable queues, not only aggregates.
- Tracker summary responses should include:
  - `reviewQueue` for jobs still blocked by extraction completeness or confidence concerns.
  - `duplicateQueue` for jobs with unresolved probable duplicates.
  - `overrideActiveItems` for tracker rows where the user has an active verdict or recommendation override in effect.
- `GET /api/ops/runtime-detail` must expose operator-safe runtime diagnostics:
  - effective allowed origins
  - cookie mode
  - upload and capture rate-limit settings
  - email provider mode
  - correlation header names used by clients

## Eye diagnostics expectations
- Eye mode is operator-only and environment-gated.
- `GET /api/ops/eye/current` returns the current operator-attached Eye session, if any.
- `POST /api/ops/eye/sessions` starts a new Eye session and automatically supersedes any previous active session for the same operator.
- `PATCH /api/ops/eye/sessions/:id/stop` stops the targeted Eye session.
- `GET /api/ops/eye/events` lists diagnostic events filtered by `eyeSessionId`, `requestId`, `jobId`, `area`, `severity`, and a recent time window.
- `GET /api/ops/eye/events/:id` returns a single diagnostic event payload.
- `POST /api/ops/eye/events/client` lets trusted clients append client-side Eye events to the same operator timeline.
- All API responses return `x-careerrafiq-request-id`, and error payloads also include `requestId` in the JSON body.
- Web and extension clients may attach:
  - `x-careerrafiq-eye-session-id`
  - `x-careerrafiq-client-surface`
