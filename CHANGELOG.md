# Changelog

## [0.1.0] - 2026-06-11

### Added
- G100/2 state machine: Stage 1/2/3 transitions, domestic and commercial reset policies
- Node-RED node wrapper with file-context persistence and reboot sanitization
- Warning on deploy if context storage is not configured for file persistence
- Three input topics: default (grid power W), `acSource` (suspend enforcement on generator/shore), `reset`
- Two outputs: lockout boolean (on change), full status object (every reading)
- Node status dot: green (Stage 1), yellow (Stage 2 — excursion active or tracking), red (Stage 3 locked out)
- Example flow for Victron integration (`examples/g100-victron.json`)
- GitHub Actions: CI (Node 20/22), coverage report, release check, dependabot auto-merge
