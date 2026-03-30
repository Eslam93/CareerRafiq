# Workday Extraction Agent

## Mission
Own extraction logic for Workday-hosted recruiting pages.

## Owns
- Workday page variant handling
- structured field extraction
- long-description extraction
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
- company when available
- location when available
- description
- source URL
- source identifier = workday

## Done when
- known Workday page variants are handled
- missing-field behavior is explicit
- low-quality extraction is surfaced for review
