# Ops Diagnostics Contract

## Purpose
Define the operator-facing diagnostics model used for manual testing, issue triage, and the hidden Eye console.

## Runtime model
- Diagnostics are split into two layers:
  - always-on warning/error events for operational visibility
  - opt-in Eye sessions for full step-by-step traces
- Eye mode is enabled only when `CAREERRAFIQ_ENABLE_EYE_MODE=1` and the runtime is not production.
- Operator access is controlled by `CAREERRAFIQ_OPERATOR_EMAILS`.

## Correlation
- Every API response returns `x-careerrafiq-request-id`.
- Error JSON payloads include `requestId`.
- Web and extension clients may attach:
  - `x-careerrafiq-eye-session-id`
  - `x-careerrafiq-client-surface`

## Eye session record
- `eye_sessions` stores:
  - `id`
  - `operatorUserId`
  - `label`
  - `status`
  - `startedAt`
  - `endedAt`
  - `lastEventAt`
  - `webAppVersion`
  - `extensionVersion`
  - `notes`
- Only one active Eye session is allowed per operator account.

## Diagnostic event record
- `diagnostic_events` stores:
  - `id`
  - `eyeSessionId`
  - `requestId`
  - `userId`
  - `jobId`
  - `trackerItemId`
  - `area`
  - `stage`
  - `code`
  - `severity`
  - `summary`
  - `payload`
  - `createdAt`

## Area taxonomy
- `request`
- `auth`
- `runtime`
- `ops`
- `extension`
- `capture`
- `extraction`
- `ai`
- `evaluation`
- `tracker`
- `client`

## Payload rules
- Payloads must be structured JSON, not opaque strings.
- Sensitive values must be redacted:
  - cookies
  - tokens
  - authorization headers
  - SMTP credentials
  - secrets and API keys
- Eye payloads may include raw AI prompts and raw model responses, but only inside Eye diagnostics and never in public product contracts.

## Expected event coverage
- Request lifecycle:
  - start
  - finish
  - unhandled error
- Auth:
  - session resolved/missing/expired
  - origin rejected
  - CSRF invalid
  - magic-link requested/throttled/sent/consumed/failed
- Capture and extraction:
  - capture started
  - unsupported page
  - review required
  - validation failure
  - reprocess started/completed
- AI:
  - cache hit
  - completed
  - failed
- Evaluation:
  - started
  - completed
  - failed
- Tracker:
  - status changes
  - recommendation trust changes
  - verdict trust changes
  - duplicate review changes
- Client:
  - manual capture open/submit
  - review submit/evaluate/reprocess
  - tracker override/reset actions
  - extension popup/runtime events
