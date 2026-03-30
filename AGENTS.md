# AGENTS.md

## Product context
This repo implements an AI Job Fit Copilot & Application Tracker delivered through:
- a web app
- a browser extension

Core flow:
1. user uploads one or more CVs
2. system parses CVs and initializes an unverified account when email is available
3. user can begin with minimum usable data
4. browser extension captures jobs from supported pages
5. system extracts and validates job data
6. system evaluates all active CVs against the job and preferences
7. system returns:
   - verdict
   - recommended CV
   - concise explanation
   - major gaps summary
8. system stores the opportunity in a lightweight tracker

Supported initial sources:
- LinkedIn Jobs
- Indeed Jobs
- Glassdoor Jobs
- Greenhouse-hosted pages
- Lever-hosted pages
- Workday-hosted pages

The tracker is the source of truth for each opportunity.
The evaluation model is structured, deterministic, versioned, and reproducible.
Unknown job fields must reduce certainty rather than directly trigger Hard Skip.
Low-confidence or materially incomplete extraction must trigger a review gate before verdict.

## Global working rules
- Do not redesign the product unless explicitly asked.
- Preserve the PRD's current architecture and boundaries.
- Favor deterministic orchestration over free-form AI behavior.
- Use AI to generate structured evidence, not opaque final decisions.
- Never silently overwrite user-confirmed values.
- Preserve inferred vs confirmed vs overridden values separately.
- Keep v1 lightweight:
  - no monetization
  - no external web enrichment in core evaluation path
  - no reminders/task automation
- The extension quick result must stay compact:
  - verdict
  - recommended CV
  - concise explanation
  - major gaps summary

## Editing rules
- Only edit files you own unless your handoff contract explicitly requires a shared interface change.
- If you need to change a shared interface, update the contract file or leave a clear handoff note for the owning agent.
- Do not change scoring weights or thresholds unless you are the evaluation-engine agent or explicitly instructed.
- Do not change source-specific extraction logic unless you are the matching extraction agent or explicitly instructed.
- Do not change auth/session rules unless you are the auth-identity agent or explicitly instructed.

## Shared contracts
The following artifacts are shared contracts across agents:
- `/docs/contracts/domain-model.md`
- `/docs/contracts/api-contracts.md`
- `/docs/contracts/evaluation-contract.md`
- `/docs/contracts/extraction-contract.md`
- `/docs/contracts/analytics-events.md`

If a shared contract does not exist yet, the owning agent must create it.

## Required output format for any meaningful task
Every agent should return:
1. what changed
2. files changed
3. interfaces touched
4. risks or follow-up items
5. any contract updates required

## Spawn guidance
Use specialized agents when the task clearly belongs to one of these domains:
- architecture / schema / job orchestration
- auth / identity / sessions
- CV parsing and CV-profile generation
- preferences and normalization
- extension UI shell
- source-specific extraction
- extraction validation / review gate
- evaluation engine / scoring
- explanations / major gaps
- tracker lifecycle
- analytics / QA / regression

## Definition of done
A task is not done unless:
- behavior matches the PRD
- edge cases are handled reasonably
- interfaces are documented if changed
- logs/errors are actionable
- tests or validation notes are included
