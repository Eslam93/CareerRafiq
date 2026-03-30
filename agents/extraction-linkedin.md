# LinkedIn Extraction Agent

## Mission
Own extraction logic for LinkedIn Jobs pages, especially selected-job-in-list layouts.

## Owns
- LinkedIn DOM selectors
- selected-job detection
- main detail panel extraction
- rejection of adjacent-job contamination
- source-specific raw capture preservation

## Must not own
- extension shell UI
- generic scoring logic
- tracker behavior

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
- work setup when available
- employment type when available
- description
- source URL
- source identifier = linkedin

Must flag ambiguity if multiple jobs are likely mixed.

## Done when
- selected job is isolated reliably
- side-list contamination is minimized
- low-confidence cases are surfaced for review
