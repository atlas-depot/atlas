---
name: atlas-handoff
description: Create a precise Atlas handoff for another teammate or agent with current state, exact files, branches, PRs, commands, verification, blockers, Efe-owned gates, and first 30 minutes. Use when pausing work, transferring ownership, spawning another agent, or preparing a fresh context.
---

# Atlas Handoff Skill

Use this skill when another person or agent must continue without rediscovering state.

## Required Reading

Read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/process/file-map.md`
- `docs/process/solo-to-team-workflow.md`
- Relevant issue/PR/docs for the current work.

## Gather State

When available:

```bash
git status --short
git branch --show-current
git log --oneline --decorate -n 12
gh pr view --json number,url,title,headRefName,baseRefName,state,reviewDecision,mergeStateStatus
gh pr checks --json name,bucket,state,workflow,link
```

Do not invent branch/PR/CI state if commands are unavailable.

## Handoff Must Include

- Goal.
- Current phase: knowledge pack or application scaffold.
- Exact files touched.
- Current branch/PR if any.
- What is complete.
- What is not complete.
- Verification run and results.
- Known blockers.
- Efe-owned gates.
- First 30 minutes checklist.
- Commands to run.
- Source-of-truth docs to read.
- Things not to change.

## Output

```md
# Atlas Handoff

## Goal

## Current State

## Files Touched

## Verification

## Open Work

## Blockers / Efe Gates

## First 30 Minutes

1. ...

## Commands

## Do Not Change

## Source Of Truth
```

Keep it operational. Avoid vague "continue implementation" language.
