# Maintaining agent guidance

Read this when editing rules or skills, not for ordinary feature work.

## Put an instruction in one place

| Artifact | Owns | Does not own |
| --- | --- | --- |
| `AGENTS.md` | Always-on project boundaries and task-based routing | Copies of contribution procedures |
| `CLAUDE.md` | Claude discovery adapter to the same instructions | A second policy |
| `docs/contributing.md` | Team rules for issues, PRs, evidence, review and merging | Step-by-step skill implementations |
| `docs/development.md` | Programming conventions and actual setup commands | Invented commands for future tooling |
| `docs/process/parallel-work.md` | Conditional worktree and stack procedure | Permission to bypass reviews or rewrite others' work |
| `.agents/skills/*/SKILL.md` | How to inspect, decide, execute and verify a particular workflow | Independent product decisions or duplicated team policy |

Keep `.agents/skills` canonical; `.claude/skills` contains relative discovery symlinks. Do not copy a skill body into both locations. Discover commands and versions from the real manifest instead of maintaining another list in a skill.

## Design around a real task

A new skill needs a distinct trigger and a reusable method that changes execution. A short rule belongs in the owning policy. Specify the inputs to inspect, decisions to make, evidence that distinguishes success from failure, and when to stop or ask. Avoid catchall descriptions and mandatory ceremony for unrelated work.

Use supporting references only for substantial conditional detail, with an explicit loading condition. Keep the default path short. Existing workflows are PR preparation (`atlas-pr`), independent review (`atlas-review`), author-side feedback (`atlas-resolve-review`) and test-value decisions (`atlas-test`). Do not invoke all four on every task.

Before importing an external skill, inspect its full instructions, referenced tools/scripts, permissions, license and version. Prefer a small compatible method over a pack with missing dependencies or conflicting policy. Record a pinned source and retain required license notices when copying text or code; updates require deliberate review.

## Validate behavior, not headings

Check frontmatter, discovery symlinks and referenced paths. For a material procedure change, give a separate evaluator a realistic request and raw artifacts without the intended answer. Restrict side effects to a disposable workspace. Inspect its decisions and actual outputs, not only its final confidence statement. Compare against the previous instructions when evaluating a claimed improvement.

Useful cases for these workflows include an older successful check on a changed head, a bot suggestion contradicted by a recorded human decision, a missing acceptance contract, a mutation that fails compilation before any assertion, and a dependent branch after its parent is squash-merged. Report scenario coverage and gaps; a formatting validator does not establish behavioral quality. Add further instructions only for observed failures or concrete risks.

## Design references

These are design inputs, not installed packages or additional team rules. Atlas wording is maintained locally; no third-party skill pack is vendored.

- [Agent Skills authoring](https://agentskills.io/skill-creation/best-practices) and [evaluation](https://agentskills.io/skill-creation/evaluating-skills): cohesive procedures, conditional detail and realistic evidence.
- [Matt Pocock, writing for agents](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/productivity/writing-for-agents/SKILL.md): single ownership and discoverable references. His [TDD skill](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/tdd/SKILL.md) informs incremental behavioral tests, without importing personal approval ceremonies.
- [Lauren Tan / poteto, pstack](https://github.com/cursor/plugins/tree/d457567332aa6989e753ea289f30ea2bfbc80bc0/pstack): explicit stack dependencies and evidence-driven review. Atlas does not adopt its Cursor tooling, ready-PR defaults or destructive recovery commands.
