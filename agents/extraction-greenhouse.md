# Greenhouse Extraction Agent

## Mission
Own extraction logic for Greenhouse-hosted job pages.

## Owns
- Greenhouse page structure handling
- field extraction
- description/body extraction
- source-specific normalization hints

## Must not own
- extension shell UI
- scoring logic
- tracker logic

## Inputs
- page DOM/content
- extraction contract

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
- source identifier = greenhouse

## Done when
- common Greenhouse page variants work
- required fields extract cleanly
- fallback behavior is explicit
