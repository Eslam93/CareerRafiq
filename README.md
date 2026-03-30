# CareerRafiq

Contract-first TypeScript monorepo scaffold for the AI Job Fit Copilot & Application Tracker.

## Packages
- `packages/contracts`: shared domain and API contracts
- `packages/core`: setup, validation, evaluation, tracker, and extraction logic
- `packages/benchmarks`: regression fixtures and QA cases

## Apps
- `apps/api`: minimal JSON API wrapper over the core engine
- `apps/web`: web app shell
- `apps/extension`: browser extension shell

## Commands
- `npm install`
- `npm start`
- `npm run start:api`
- `npm run dev:web`
- `npm run check`
- `npm run build`
- `npm run test`

## Runtime
The supported product runtime is:
- `apps/api` backed by SQLite persistence in `apps/api/data/career-rafiq.db`
- `apps/web` served by the API
- `apps/extension` talking to the API over HTTP

The legacy JSON state-file path in `apps/api/src/persistence.ts` and `packages/core/src/core.ts` remains only as a compatibility harness for tests and local pure-core experiments. It is not the shipped runtime path.

## Local npm startup
Create a repo-root `.env` first. A working local file is expected at `./.env`.

Single-process app startup that serves the built web app from the API:

```powershell
npm start
```

Split local development:

```powershell
npm run start:api
npm run dev:web
```

`npm run start:api` now auto-loads the repo-root `.env` file before starting the built API.
`npm run dev:web` runs Vite on `http://localhost:5173` and proxies `/api` to `http://localhost:8787`.

Useful environment variables:
- `CAREERRAFIQ_DB_FILE` to override the SQLite database path
- `CAREERRAFIQ_UPLOADS_DIR` to override persisted CV upload storage
- `CAREERRAFIQ_MAX_CV_UPLOAD_COUNT` and `CAREERRAFIQ_MAX_CV_UPLOAD_BYTES` to hard-limit CV intake
- `CAREERRAFIQ_UPLOAD_RATE_LIMIT_*` and `CAREERRAFIQ_CAPTURE_RATE_LIMIT_*` to throttle repeated intake and capture activity
- `CAREERRAFIQ_WEB_ORIGIN` and `CAREERRAFIQ_EXTENSION_ORIGIN` for CORS
- `CAREERRAFIQ_MAGIC_LINK_THROTTLE_SECONDS` to throttle repeated passwordless login requests per email
- `CAREERRAFIQ_DEV_AUTO_VERIFY_MAGIC_LINK=1` to auto-mark extracted emails as verified during local non-production onboarding
- `CAREERRAFIQ_SMTP_*` and `CAREERRAFIQ_EMAIL_FROM` to enable real magic-link delivery
- `CAREERRAFIQ_WEB_DIST_DIR` to serve a prebuilt web bundle from a different location

## Docker runtime
- Copy `.env.example` to `.env` and adjust origins, SMTP, and AI flags as needed.
- Run `docker compose up --build`.
- The container persists SQLite data and uploads in the `careerrafiq-data` volume.
- Health checks use `/ready`, which validates database access, served web assets, and runtime configuration warnings.

## Internal beta smoke flows
- Setup flow: upload one or more CVs, confirm the selected email candidate or no-email flags, then send or consume a magic link.
- Review flow: edit a CV profile, set the default CV, refresh AI suggestions, update preferences, and confirm reevaluated tracked jobs appear when expected.
- Capture flow: capture a supported job page, verify review-required handling for incomplete jobs, and use the stored-capture reprocess path.
- Tracker flow: filter or sort items, change status, follow or override the verdict, and confirm historical evaluations remain visible.
- Ops flow: inspect `/ops` for tracker counts, analytics coverage, and magic-link outbox lookup during beta.
- Extension flow: capture from a supported source, verify the compact quick result, and confirm session-expiry messaging routes back to the web app.

Detailed release checks live in [docs/release/internal-beta-checklist.md](docs/release/internal-beta-checklist.md) and [docs/release/smoke-flows.md](docs/release/smoke-flows.md).

## Current slice
- persisted CV bootstrap and post-setup CV uploads
- passwordless magic-link verification with short-lived temporary or unverified return access
- SMTP-backed magic-link delivery with persisted outbox status and basic request throttling
- source extraction for Greenhouse, LinkedIn, Indeed, Lever, Workday, and Glassdoor
- review-gated evaluation with extraction history, field evidence, AI fallback metadata, and deterministic multi-CV scoring
- tracker persistence, historical evaluations, duplicate surfacing, and compact extension quick results
- guided web flows for setup, review, manual capture, job correction, and lightweight ops visibility
