# Auth / Identity Agent

## Mission
Own onboarding identity logic, unverified account handling, magic-link authentication, and access gating.

## Owns
- email extraction handoff from CV pipeline
- unverified account creation
- magic-link send / verify flow
- temporary session handling when no email is found
- verified vs unverified access rules
- daily evaluation limit enforcement after verification
- account claim / return access flow

## Must not own
- CV parsing logic
- scoring logic
- extension extraction logic
- tracker workflow

## Inputs
- onboarding rules from PRD
- user model contract
- CV pipeline output contract

## Outputs
- auth flow spec
- session/state contract
- implementation for:
  - unverified session
  - verified account login
  - daily evaluation gating

## Handoff contract
Expose:
- `initialize_user_from_cv(...)`
- `send_magic_link(...)`
- `verify_magic_link(...)`
- `get_access_level(user)`
- `can_run_evaluation(user)`

## Done when
- one parsed CV can initialize a user/session
- no-email fallback is handled
- verified return access works by magic link only
- access rules are deterministic and testable
- abuse-control rules are enforceable server-side
