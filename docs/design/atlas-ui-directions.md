# Atlas UI Directions (historical)

Status: historical. Not current guidance.

- Written 2026-07-01 during the UI reset pass.
- Proposed three visual directions for the first Today slice. Direction A was chosen, executed, and rejected.
- Superseded by the 2026-07-16 warm-minimalism lock.
- Current source of truth: `docs/design/atlas-design-tokens.md` (tokens) and `docs/design/ui-rulebook.md` (rationale).
- Constraints and rejected patterns: `docs/architecture/ui-quality-bar.md`.
- Layout contract: `docs/architecture/ui-system.md`.
- Full original text: `git show 802adb2:docs/design/atlas-ui-directions.md`.

Do not copy palette values, pixel measurements, or the old constraint list out of the original.
The lock reversed at least one of them: soft status tint-pills are permitted now, the original forbade pills.

## Scope of the original

The document covered one slice only: Today plus right inspector plus persistent composer.
Not the full app.

## The three directions

**Direction A: Quiet Ledger Desk.** Dark, dense, exact. A prioritized ledger instead of cards, a calm evidence inspector on the selected row, and a composer that reads as a command line. Feel: Linear plus Superhuman plus a private research desk. Recommended as the strongest fit.

**Direction B: Editorial Memory Workspace.** A private document room. Leans into reading, reflection, and source preview, with an editorial serif for prose. Feel: Notion plus a research notebook. Judged strong for object pages, weak for Today. Risk noted: too slow for daily triage.

**Direction C: Precision Console.** Sharp operational interface, strict grid, tight rows, strong command menu. Feel: Vercel plus Linear plus developer-tool clarity. Judged the safest to componentize but the least distinctive. Risk noted: may feel derivative and cold, and may recreate the first failure as generic dark UI.

## What happened to Direction A

Efe approved Direction A on 2026-07-01 as a working hypothesis, not as a final answer.
It was executed as the `atlas-today-slice` prototype and rejected.
The prototype was removed and archived locally. Do not resurrect it.

The document names the risk it ran into: Direction A can become too austere if typography and spacing are not excellent.
It also stated the correct test up front: the slice must be judged visually, not only by the contract.
The rejection did not come with a written post-mortem beyond that.

## Durable insight

Two points survive the lock:

- A direction can pass its written contract and still fail on sight. Contract conformance is not a substitute for a visual verdict.
- The decision was not winner-takes-all. Direction B was meant to shape object pages and source preview. Direction C was meant to shape component discipline and interaction detail, but never the brand feel. That split of influence is a separate idea from picking one palette.
