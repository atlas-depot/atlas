---
name: atlas-create-skills
description: Create, improve, or audit Atlas project skills and alignment hooks. Use when the user asks to create skills, populate skills, improve /atlas-* workflows, add automatic hooks, or keep agents aligned with Atlas source-of-truth docs.
---

# Atlas Create Skills

Use this skill to create or revise Atlas project skills in `.claude/skills` and Cursor alignment hooks in `.cursor/hooks`.

## Required Reading

Read first:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/process/engineering-standards.md`
- `docs/process/file-map.md`
- `docs/process/skill-taxonomy.md`
- `.cursor/rules/80-agent-skills.mdc`
- Existing relevant `.claude/skills/*/SKILL.md`

When creating a domain skill, also read the matching architecture/process docs.

## Skill Quality Bar

Every Atlas skill must be a usable workflow, not a slogan.

It must include:

- Clear trigger in YAML `description`.
- Required source-of-truth docs to read.
- Step-by-step workflow.
- Decision gates and escalation rules.
- Concrete commands when relevant.
- Output format.
- Verification or review checklist.
- Guardrails against bypassing Atlas invariants.

Keep `SKILL.md` concise enough to load quickly. Use one-level `references/` files only when the workflow needs detailed reusable material.

## Creation Workflow

1. Identify the task the skill should make easier.
2. Search existing skills and docs to avoid duplicates.
3. Check `docs/process/skill-taxonomy.md` to decide whether the skill should exist, merge into an existing skill, or be deferred.
4. Decide whether this is a project skill under `.claude/skills` or a user/global skill.
5. Create or update `SKILL.md` using the existing Atlas skill style.
6. Add Cursor hook trigger terms if the skill should be suggested automatically.
7. Update `README.md`, `CLAUDE.md`, `docs/process/agent-alignment.md`, `docs/process/file-map.md`, and `docs/process/skill-taxonomy.md` if a new skill is added.
8. Validate the skill with the available skill validator when possible.

## Hook Rules

Hooks may suggest skills and docs. Hooks must not:

- Edit files.
- Post GitHub comments.
- Push branches.
- Deploy.
- Create provider accounts.
- Override approvals.
- Fail closed for advisory alignment.

If a hook needs deterministic enforcement, document the policy first and ask Efe before making it blocking.

## Output

```text
Skill changes:
- ...

Hooks changed:
- ...

Docs updated:
- ...

Validation:
- ...

Remaining risks:
- ...
```
