# Lever Extraction Agent

## Mission
Own extraction logic for Lever-hosted job pages.

## Owns
- Lever page structure handling
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
- source identifier = lever

## Done when
- common Lever page variants work
- required fields extract cleanly
- fallback behavior is explicit
