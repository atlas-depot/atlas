---
name: atlas-handoff
description: Transfer an in-progress Atlas task using verified repository state and concrete next actions.
---

# Atlas Handoff

Read `docs/contributing.md` for the active workflow.
Use this when another person or agent must resume work, not as a mandatory ending for every task.

## Collect current state

Inspect working-tree status, branch, and diff before describing changed files.
If relevant and accessible, inspect the actual PR revision, checks, and unresolved feedback.
Distinguish committed, pushed, deployed, and only locally edited work.
Do not overwrite or discard another person's uncommitted changes.

## Write the handoff

Include the goal, completed behavior, remaining work, and material decisions.
Name exact files or entry points that the next person needs.
Give the next concrete action and commands only when those commands exist.
Report verification already run and gaps that still need checking.
Identify blockers and decisions requiring the user's input.
Link only the references relevant to continuing this task.
Exclude secrets and private provider data.

Do not create a new architecture plan or repeat the full repository guide.
Do not claim a green PR from old check results after later commits.
Return the handoff in chat unless the user requests a persistent artifact.
