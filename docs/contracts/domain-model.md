# Domain Model

## Purpose
Define the core backend entities and the state relationships between CVs, jobs, evaluations, and tracker items.

## Core entities
- User
- CV
- CVVersion
- CVProfile
- PreferenceProfile
- Job
- EvaluationResult
- TrackerItem
- EyeSession
- DiagnosticEvent

## State model principles
- Preserve inferred, confirmed, and overridden values separately.
- Keep active and historical evaluation data distinct.
- Use deterministic, versioned evaluation inputs.
- Treat the tracker as the source of truth for each opportunity.
- Persist manual override lineage across reevaluations instead of silently resetting deliberate user decisions.
- Keep duplicate review decisions explicit and auditable.

## Relationship notes
- A User can have multiple CVs.
- A CV is the active logical record for one resume variant owned by a user.
- A CV can have many CVVersions that preserve superseded file/content history for later audit and rollback analysis.
- Each CV has one active CVProfile, and that profile identity should survive file updates for the same logical CV.
- A Job can be linked to one TrackerItem.
- A TrackerItem can reference active and historical EvaluationResults.
- A PreferenceProfile applies at the user level and is consumed by evaluation.
- An operator User can have at most one active EyeSession at a time.
- An EyeSession can have many DiagnosticEvents.

## CV lifecycle model
- `CV.latestVersionId` points to the current persisted CVVersion that produced the active file/text state.
- `CV.latestClassification` stores the most recent file-level CV classifier result used during intake.
- `CV.contentHash` is the normalized hash of the active extracted text and supports deterministic duplicate/update matching.
- `CVVersion` stores file name, original file name, raw text, content hash, classification, upload time, and optional superseded time.
- CV upload matching is user-local only and may use exact title, fuzzy title, exact content, or similar-content signals.
- Updating an existing CV replaces the active CV and active CVProfile data while preserving older file/content revisions in CVVersion history.

## Tracker trust model
- `TrackerItem.recommendationSnapshot` remains the latest system output for verdict and recommended CV.
- `TrackerItem.recommendedCvDecision`, `TrackerItem.verdictDecision`, and `TrackerItem.userSelectedCvId` represent the effective trust decision currently chosen by the user.
- `TrackerItem.decisionHistory` is append-only audit history for recommendation, verdict, and duplicate-resolution actions.
- `TrackerItem.duplicateResolution` stores whether a probable duplicate is still pending review, has been confirmed as distinct, or has been confirmed as a duplicate of another tracker item.
- Reevaluation may refresh the latest system snapshot, but an explicit manual override remains active until the user resets it.

## Diagnostics model
- `EyeSession` groups step-by-step diagnostics for a manual testing run.
- `DiagnosticEvent` is append-only and may exist either under an Eye session or as an always-on warning/error event without one.
- Request correlation is carried by `DiagnosticEvent.requestId`.
- Diagnostic payloads must be structured JSON and must redact secrets before persistence.

## Required contract outputs
- stable identifiers
- ownership boundaries
- idempotency expectations
- transition rules
