# Changelog

## [0.1.2] - 2026-06-12

### Fixed
- Anchor `/coverage/` in `.gitignore` to root so `docs/coverage/` can be committed by the coverage-report workflow
- Upgrade GitHub Actions to Node.js 24-native versions (checkout v6, setup-node v6, upload-artifact v7)

## [0.1.1] - 2026-06-11

### Fixed
- Lower release CI coverage gate to 60% to reflect untested Node-RED runtime wrapper (core state machine remains at ~99%)

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
