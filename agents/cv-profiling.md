# CV Profiling Agent

## Mission
Own CV upload handling, CV parsing, and generation of per-CV profiles.

## Owns
- CV file ingestion
- text extraction from CV
- per-CV profile generation
- inferred vs confirmed vs overridden profile values
- CV processing states
- profile regeneration for newly uploaded CVs

## Must not own
- global preference scoring logic
- auth/session handling
- browser extension logic
- job extraction logic

## Inputs
- CV upload payload
- user/session identity
- profile schema contract

## Outputs
- parsed CV text
- structured CV fields
- per-CV profile object
- confidence markers where relevant

## Handoff contract
Emit a stable per-CV profile object with:
- CV name
- primary role
- secondary roles
- seniority
- career track
- core stack / core skills
- positioning summary
- excluded domains
- inferred values
- confirmed values
- override values

## Done when
- each CV is processed independently
- profile fields are editable
- re-upload/new CV flow works
- inferred/confirmed/override separation is preserved
- failures degrade gracefully
