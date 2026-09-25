## What this changes

<!-- One or two sentences. What was wrong or missing, and what it does now. -->

Fixes #

## Why

<!-- The reasoning a reviewer can't get from the diff. -->

## How it was verified

<!-- Which tests, and what they would have caught. "Ran the demo and it looked
     right" is a fine supplement, not a substitute. -->

- [ ] `npm test`
- [ ] `npm run mutate`
- [ ] `npm run build:lib && npm run build:umd && npm run verify:package && npm run size`
- [ ] Checked in a browser (say which)

## Checklist

- [ ] The core still imports nothing outside DOM/Canvas APIs, and still imports with no DOM present
- [ ] Public API changes are reflected in `src/chart/index.d.ts`
- [ ] `CHANGELOG.md` has an entry under `## [Unreleased]`
- [ ] README/docs updated if behaviour or defaults changed
- [ ] No new per-frame allocations or full-array scans in a hot path
- [ ] Style matches the surrounding code

## Breaking changes

<!-- None, or: what breaks, and what a consumer has to do about it. -->

None.
