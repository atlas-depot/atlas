# Project evidence

Five-person school project, planned delivery at the end of April 2027. Confirm the school's AI-assistance and attribution requirements before assigning implementation work.

Keep evidence short and attributable. Link actual PRs, reviews, tests, evals, or demonstrations rather than writing long narrative reports. Record AI assistance and human verification to the extent required by the school. Do not fabricate learning, authorship, or successful runs.

## Weekly entry format

```text
Week / contributor:
Delivered or reviewed: <PR or artifact links>
Decision and reason: <one or two sentences>
Verification: <executed tests/evals/demo and result>
AI assistance and human contribution:
Can explain: <data flow and key tradeoff>
Remaining blocker / next step:
```

## Entries

Week of 2026-10-19 / onatozmenn:
Delivered or reviewed: opened #31 (checks for every PR) and #32 (parser for the briefing fixtures) as drafts, for #19 and #22.
Decision and reason: I wanted the checks to just run on every PR, and for a broken fixture to say which field is wrong instead of quietly passing.
Verification: ran the checks, the 25 tests and the build locally, and the real GitHub run is green. Also made a dummy PR with one type error to see verify go red, then closed it.
AI assistance and human contribution: AI helped me draft the code, I read through the diffs and ran everything myself.
Can explain: what the parser looks for and why a PR can't merge when verify fails.
Remaining blocker / next step: waiting for #17 to merge, then I'll point both PRs at main.

## Historical material

The earlier architecture, process, and research documents remain available at [pre-reset commit 3a1a6f3](https://github.com/EfeDurmaz16/atlas/tree/3a1a6f3/docs). They document earlier assumptions and source links, not current implementation facts. This reset replaces those assumptions with the accepted direction and explicitly open team decisions.

Static prototype files and screenshots remain in [docs/prototypes](prototypes/). Their presence proves only that artifacts exist, not that responsive behavior, accessibility, or the backend has been validated. See [design references](design/references.md) for their historical status.
