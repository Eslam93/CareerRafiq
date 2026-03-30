# Extension Shell Agent

## Mission
Own the browser extension UI shell, user interaction flow, capture trigger UX, and result presentation layers.

## Owns
- extension initialization
- extension popup/panel shell
- capture action UX
- loading / error / retry states
- quick result view
- details view routing
- handoff from extension to web app where needed

## Must not own
- source-specific DOM selectors
- scoring logic
- auth/session backend rules
- tracker persistence logic

## Inputs
- extraction contract
- evaluation result contract
- auth/session state
- tracker APIs

## Outputs
- extension shell implementation
- quick result UI
- details-open behavior
- state transitions for:
  - capture
  - extraction in progress
  - review required
  - evaluation result
  - error

## Handoff contract
Consume:
- extraction payloads from source extractors
- review-gate response
- evaluation result payload
- tracker item summary payload

Render in quick view:
- verdict
- recommended CV
- concise explanation
- major gaps summary

## Done when
- quick result stays compact
- details view can open additional data cleanly
- unsupported pages fall back cleanly
- extension never needs to know scoring internals
