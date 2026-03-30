# Glassdoor Extraction Agent

## Mission
Own extraction logic for Glassdoor job pages.

## Owns
- Glassdoor DOM selectors
- visible job detail extraction
- source-specific ambiguity handling

## Must not own
- extension shell UI
- scoring logic
- tracker logic

## Inputs
- page DOM/content
- source extraction contract

## Outputs
- raw capture payload
- normalized extraction candidate
- source confidence hints

## Handoff contract
Must provide:
- title
- company
- location when available
- description
- source URL
- source identifier = glassdoor

## Done when
- visible primary job is extracted cleanly
- contamination from surrounding content is controlled
- low-confidence cases are surfaced for review
