# CareerRafiq

CareerRafiq is an AI job-fit copilot and application tracker for active job seekers.

> "The product helps job seekers make better application decisions and stay organized during an active job search."

This repository is a work in progress. It is under active development and manual testing, and it is not finished yet. The product scope, behavior, and UI are still evolving toward the PRD. It should not be treated as production-ready.

## What We Are Building

The product is being built around one main workflow:

> capture a job -> assess fit -> choose the best CV -> decide apply/skip -> track status -> know the next action

The goal is to help a user:
- save jobs from real job pages
- compare those jobs against multiple CV versions
- decide whether a role is worth pursuing
- know which CV to use
- keep each opportunity organized in one tracker

Another core promise from the PRD is:

> "Save any job, see whether it is worth applying to, know which CV to use, and keep your search organized."

## What It Is Not

CareerRafiq is intentionally narrow in v1.

> "The product is not a job board, resume builder, or general AI career assistant."

It is not meant to be:
- a resume authoring tool
- an auto-apply system
- a broad career coaching assistant
- a recruiter CRM
- a full analytics or workflow automation platform

## Intended User Flow

The intended product flow is:
1. Upload one or more CVs.
2. Let the system build a profile for each CV and infer baseline preferences.
3. Capture a job from a supported page or add it manually.
4. Review extraction only when confidence is too low or the job data is incomplete.
5. Get a verdict, recommended CV, explanation, major gaps, and next action.
6. Keep the opportunity in a lightweight tracker and update status over time.

## Current Status

This codebase currently represents an in-progress implementation of that product vision.

Important status notes:
- the product is still under active testing
- some flows are implemented but still being hardened
- some PRD requirements are only partially complete
- some product behavior is still being refined through manual validation
- data models, UI flows, and operational tooling may still change

If you are reading this repo publicly, treat it as a working build in progress, not a completed product release.

## Local Development

If you want to run the current build locally:

```powershell
npm install
npm run check
npm run test
npm start
```

For split local development:

```powershell
npm run start:api
npm run dev:web
```

Use `.env.example` as the starting point for local configuration.

## Repo Scope

This monorepo currently contains:
- the API
- the web app
- the browser extension
- shared contracts and core logic
- benchmarking and regression fixtures

The implementation details are here because they support the product above. The product itself is the focus.
