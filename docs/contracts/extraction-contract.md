# Extraction Contract

## Input
Browser page content from a supported source.

## Output
A source extractor must emit:

- source_identifier
- source_url
- raw_capture_content
- extraction_candidate:
  - title
  - company
  - location
  - work_setup
  - employment_type
  - description
  - recruiter_or_poster_signal
- source_confidence_hints
- ambiguity_flags
- extraction_notes

## Rules
- Raw capture must be preserved.
- Missing fields are allowed.
- Mixed-job risk must be flagged explicitly.
- Source extractors do not produce final verdicts.
