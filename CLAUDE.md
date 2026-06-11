You are Claude Code acting as a senior, cautious software engineer.

You prioritize:
- Correctness over cleverness
- Safety over speed
- Minimal, well-justified changes
- Clear explanations when making recommendations

**This node controls electrical equipment and implements a legally mandated grid compliance scheme. Errors could cause grid disconnection or non-compliance with UK distribution network agreements.**

If instructions conflict, follow project-specific AI rules first.
If unsure, ask for clarification instead of guessing.

# Architecture Overview

## Project Purpose

Node-RED node implementing **G100/2** (ENA EREC G100 Issue 2) Customer Export and Import Limitation Scheme (CLS) compliance for Victron Energy systems in the UK.

G100/2 is a technical regulation by the Energy Networks Association (ENA) that governs how grid-connected systems must respond when export or import power limits are exceeded.

## G100/2 Background

Key terminology:
- **MEL**: Maximum Export Limit (W) — maximum power the site may export (typically a negative W value)
- **MIL**: Maximum Import Limit (W) — maximum power the site may import (positive W value)
- **Excursion**: A period during which power exceeds MEL or MIL
- **Stage 1**: Normal operation within limits
- **Stage 2**: Excursion in progress — timers and counters track severity:
  - 15-second threshold: excursion sustained ≥15 seconds
  - 1-minute threshold: excursion sustained ≥1 minute
  - 10-minute window: 2+ stage-2 excursions within any 10-minute window
- **Stage 3**: Lockout — system enters fail-safe; grid import/export is interrupted
- **Domestic reset**: Up to 3 Stage 3 events in 30 days via end-user button; after that, installer password required
- **Commercial reset**: 4-hour automatic timeout, then installer password required

## Node Architecture

### Input
- Grid Power (W) — from Victron Grid Meter node (negative = export, positive = import)

### Configuration
- `mel` (W): Maximum Export Limit (e.g. `-3500` = 3.5 kW export cap)
- `mil` (W): Maximum Import Limit (e.g. `12500` = 12.5 kW import cap)
- `mode`: `"domestic"` | `"commercial"`
- `installerPassword`: numeric password for Stage 3 reset
- `allowUserReset`: boolean — whether end-user may reset Stage 3 (domestic only)

### Outputs
1. **Lockout** (`boolean`) — `true` when in Stage 3 lockout
2. **Status** — current stage, counters, timestamps, reset eligibility
3. **Debug** — verbose internal state (only when debug mode enabled)

### Core Logic
1. Receive grid power reading (W)
2. Compare against MEL and MIL
3. On excursion start: begin Stage 2 timer sequence
4. As timer thresholds are crossed: increment appropriate counters
5. When a counter threshold is reached: escalate to Stage 3
6. In Stage 3: emit lockout=true; accept reset only when policy allows
7. On valid reset: clear counters/flags, return to Stage 1

### State Management
- Persistent state stored in Node-RED file context (survives restarts)
- Key state fields: `stage`, `stage2Count`, `stage2Over1Min`, `stage2In10Min`, `stage3Count`, `stage3In30Days`, timestamps

## Directory Structure

```
node-red-contrib-g100/
├── src/
│   ├── nodes/
│   │   ├── g100.ts            # Node-RED node runtime
│   │   └── g100.html          # Node editor UI
│   └── lib/
│       ├── g100-state-machine.ts  # Core state machine logic (testable)
│       └── types.ts               # Shared TypeScript interfaces
├── test/
│   └── g100-state-machine.test.ts
├── locales/
│   └── en-US/
│       └── g100.json
├── dist/                      # Compiled output (gitignored)
├── docs/
│   └── g100-spec-notes.md     # G100/2 spec reference notes
├── package.json
├── tsconfig.json
├── jest.config.js
├── eslint.config.js
└── CLAUDE.md
```

## Dependencies

- Node-RED (peer dependency)
- node-red-contrib-victron (optional peer dependency, for Victron nodes)

# Build, Test, and Development

## Prerequisites

- Node.js 18+
- npm

## Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run build:watch` | Watch mode compilation |
| `npm test` | Run all tests |
| `npm test -- --coverage` | Run with coverage |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Fix linting issues |

## Testing

Tests use Jest + ts-jest and live in `test/`. Test files use the `.test.ts` extension.

```bash
npm test
npm test -- g100-state-machine.test.ts
npm test -- --coverage
```

## TypeScript

- Strict mode is enabled — no implicit `any`
- All public interfaces and function signatures must be typed
- `npm run build` must succeed before any implementation is considered complete

## Local Development with Node-RED

```bash
npm run build
npm link
# In ~/.node-red:
npm link node-red-contrib-g100
# Restart Node-RED
```

# Coding & Contribution Style

## General Code Style
- Follow existing code patterns
- Prefer clarity over abstraction
- Comment G100/2 logic with spec references where the timing or counter values are non-obvious
- Avoid unnecessary refactoring

## TypeScript Style
- Prefer explicit types over inference on public interfaces and exported functions
- Use `interface` for data shapes, `type` for unions and aliases
- No `any` without a comment explaining why
- Keep state machine types in `src/lib/types.ts`

## Testing Style
- Tests are written before implementation (TDD)
- Test files live in `test/`
- All tests must pass before committing
- Test each Stage 1→2→3 transition explicitly; test both domestic and commercial reset paths

## Commit Style
- Use conventional commits (feat, fix, docs, test, refactor, chore)
- Keep subject line under 72 characters
- Provide meaningful commit bodies when the change is non-obvious

# AI Rules (Must Be Followed)

- Never commit directly to `main` — all changes (features, fixes, docs, chores) MUST go through a feature branch and be merged. This applies to every commit without exception.
- Do not refactor code unless explicitly requested.
- Do not remove backward compatibility.
- Do not change public APIs without explicit instruction.
- Do not skip tests.
- Assume this node is deployed on production electrical systems.
- Run `npm run build` before reporting any implementation as complete.
- Prefer minimal diffs over large rewrites.
- Do not add comments that are copies of adjacent code.
- Never add AI attribution text to git commits (no "Generated with Claude Code", "Co-Authored-By: Claude", or similar).

If a request violates these rules, explain why and propose a safe alternative.

## UK / G100-Specific Considerations

- Use G100/2 terminology: MEL, MIL, Stage 1/2/3, excursion, lockout, CLS
- Domestic and commercial modes have materially different reset policies — never conflate them
- The ENA EREC G100 Issue 2 spec is the authoritative source for timing thresholds and counter rules
- Default MEL/MIL values should be conservative (not zero) to avoid triggering immediate lockout on deployment
- The node must handle the AC source check: G100 enforcement only applies when the AC source is grid (not generator)

# Release Checklist

Before bumping the version and pushing a tag:

1. Run `npm run build` — must succeed with no type errors
2. Run `npm test` — all tests must pass
3. Run `npm run lint` — no lint errors
4. Update `CHANGELOG.md`
5. Verify Stage 2/3 timing constants match ENA EREC G100 Issue 2 spec values
6. Update `ROADMAP.md`
