---
name: atlas-owner-onboarding
description: Onboard a teammate or coding agent who is taking ownership of an Atlas area such as frontend, UI design, backend/API, database/permissions, AI/ingestion/evals, security/privacy, DX/deploy, or bot/integrations. Use when someone asks what to do first, what docs to read, what issues to pick, what files they own, what commands to run, or when to escalate decisions to Efe.
---

# Atlas Owner Onboarding Skill

Use this skill to give a role-specific starting path without inventing project direction.

## Required Reading

Always read these first:

- `AGENTS.md`
- `docs/process/owner-onboarding.md`
- `docs/process/solo-to-team-workflow.md`
- `docs/process/onboarding.md`
- `docs/process/provider-and-env-setup.md`
- `docs/architecture/repository-structure.md`

Then read the role-specific docs listed in `docs/process/owner-onboarding.md`.

If the role is unclear, ask one question: "Which area are you owning?"

## Output Shape

Answer with:

```text
Role:
Scope:
Read first:
First 3 tasks:
Files/packages likely touched:
Commands to run:
Acceptance bar:
Escalate to Efe when:
Risks:
```

Keep the answer operational. Do not rewrite the architecture spec.

## Rules

- Treat Efe Baran Durmaz as bootstrap lead and product owner, not as a blocker for normal engineering choices.
- Escalate provider accounts, production secrets, compliance-sensitive setup, real eval data, production domain, final brand direction, WhatsApp provider path, and Apple Messages feasibility to Efe.
- Explain that Efe-owned personal provider accounts may be used for bootstrap cost control, but teammates should use fake/local providers, preview URLs, or scoped integration secrets instead of Efe passwords or broad production access.
- Explain that this is a clarity/source-of-truth role, not a rigid team hierarchy.
- Do not assign ownership of Efe-owned gates unless the user explicitly says ownership was delegated.
- Do not suggest production credentials are required for first local work.
- Prefer a small first issue that can be reviewed and demoed.
- If no app scaffold exists yet, make the first task about creating or using the Phase 0 scaffold contract.
- If preview deployments exist, require preview URL evidence for UI/API/bot changes.
- If the role is ambiguous, ask for the smallest clarification: which area they own.

## Role Routing

Map common phrases to owner sections:

- "UI owner", "design owner", "frontend design" -> UI Design Owner.
- "frontend owner", "web owner", "Next.js owner" -> Frontend Owner.
- "backend owner", "API owner" -> Backend/API Owner.
- "database owner", "permissions owner", "Postgres owner" -> Database and Permissions Owner.
- "AI owner", "ingestion owner", "eval owner" -> AI/Ingestion/Eval Owner.
- "security owner", "privacy owner" -> Security and Privacy Owner.
- "DX owner", "deploy owner", "CI owner" -> DX/Deploy Owner.
- "bot owner", "Slack owner", "WhatsApp owner" -> Bot/Integrations Owner.

## Efe Escalation Message

When the work hits an Efe-owned gate, tell the teammate to send:

```text
Decision needed:
Context:
Options:
Recommendation:
Risk if deferred:
Link to issue/PR:
```
