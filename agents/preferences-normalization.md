# Preferences / Normalization Agent

## Mission
Own global preference generation, free-text preference handling, AI audit suggestions, and evaluation-only normalization descriptors.

## Owns
- first-pass global preference generation
- preference editing model
- free-text list handling
- AI audit warnings:
  - duplicates
  - near-duplicates
  - contradictions
  - weak values
- evaluation-only normalization descriptors
- internal normalized comparison mapping

## Must not own
- final job scoring logic
- DOM extraction
- tracker UI behavior
- auth/session rules

## Inputs
- per-CV profiles
- user-entered preference values
- evaluation contract

## Outputs
- preference profile object
- audit suggestions
- normalized comparison descriptors

## Handoff contract
Expose:
- user-visible free-text values
- internal normalized descriptors
- explicit source of each value:
  - inferred
  - confirmed
  - overridden

Must not overwrite user-entered text.

## Done when
- preferences are editable
- audit warnings are advisory only
- normalized descriptors are versioned and separate
- evaluation engine can consume normalized descriptors cleanly
