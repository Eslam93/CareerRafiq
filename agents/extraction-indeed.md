# Indeed Extraction Agent

## Mission
Own extraction logic for Indeed job pages.

## Owns
- Indeed DOM selectors
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
- location
- description
- source URL
- source identifier = indeed

Must flag mixed/noisy extraction risk when present.

## Done when
- primary visible job is extracted cleanly
- noise from surrounding modules is limited
- low-confidence cases are surfaced
