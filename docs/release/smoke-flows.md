# Smoke Flows

Use these smoke flows after `npm run check`, `npm test`, and `npm run build`.

## 1. Setup And Identity
- Start the API with SQLite enabled.
- Upload one CV with an email and confirm:
  - setup reaches minimum usable data
  - selected email candidate is shown
  - return access still requires verification until the magic link is consumed
- Upload one CV without an email and confirm:
  - email collection required is shown
  - temporary access expires after the short-lived session window

## 2. Post-Setup CV Management
- From the review page, upload an additional CV.
- Confirm a new CV profile appears.
- Set the new default CV.
- Confirm tracked jobs reevaluate and the default CV is used as the deterministic tie-break preference.

## 3. Supported Capture
- Capture one supported page from any of:
  - LinkedIn
  - Indeed
  - Glassdoor
  - Greenhouse
  - Lever
  - Workday
- Confirm the job lands in the tracker and evaluation produces:
  - verdict
  - recommended CV
  - concise explanation
  - major gaps summary

## 4. Review Gate
- Capture or manually create a low-confidence or incomplete job.
- Confirm the review page shows:
  - validation reasons
  - extraction version
  - extraction history
  - retry or reprocess controls
- Save corrections with reevaluation enabled and confirm the tracker updates.

## 5. Tracker
- Open the tracker and test status filtering plus sorting.
- Open a tracker detail page and confirm:
  - historical evaluations are listed
  - recommendation and verdict decisions can be recorded independently
  - probable duplicates remain visible

## 6. Extension
- With a valid session, capture a supported job page from the extension.
- Confirm the popup remains compact:
  - verdict
  - recommended CV
  - concise explanation
  - major gaps summary
- Let the temporary or unverified session expire and confirm the extension sends the user back to web login.

## 7. Restart Persistence
- Restart the API.
- Confirm the user session, tracker items, evaluations, and extraction history still load from SQLite.

## 8. Ops Visibility
- Open `/ops`.
- Confirm tracker counts, analytics coverage, and the latest email delivery state load for the signed-in account.
- Confirm runtime readiness reports database, web bundle, email, and AI configuration clearly.
- If SMTP is disabled, use the outbox lookup form to inspect the latest magic-link message body.
