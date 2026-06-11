## Description

<!-- Briefly describe what this PR does -->

## Type of Change

<!-- Mark the relevant option with an [x] -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] Configuration/build changes

## Related Issues

<!-- Link any related issues using "Fixes #123" or "Relates to #123" -->

## Changes Made

<!-- List the main changes in bullet points -->

-

## Testing

- [ ] I have run `npm run build` and it succeeds
- [ ] I have run `npm test` and all tests pass
- [ ] I have run `npm run lint` and there are no errors
- [ ] I have added tests for new functionality (TDD — tests written first)
- [ ] I have tested with a real Node-RED instance (if applicable)

## G100/2 Considerations

<!-- If this change affects G100/2 state machine behaviour, check the relevant boxes -->

- [ ] Not applicable (no state machine changes)
- [ ] Stage 1 → Stage 2 transition tested
- [ ] Stage 2 → Stage 3 transition tested (all three counter paths)
- [ ] Domestic reset path tested (user reset + installer password)
- [ ] Commercial reset path tested (4-hour timeout + installer password)
- [ ] MEL (export limit) path tested
- [ ] MIL (import limit) path tested
- [ ] AC source check (grid vs generator) tested

## Checklist

- [ ] My code follows the project's coding style
- [ ] I have updated documentation if needed
- [ ] I have not removed backward compatibility (or discussed it first)
- [ ] My changes generate no new warnings from `npm run lint`
- [ ] `CHANGELOG.md` updated if this is a user-visible change
