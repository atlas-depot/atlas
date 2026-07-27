# Atlas File Map

Status: living map  
Audience: new teammates and AI coding agents

This file explains what every committed file in the current Atlas project knowledge pack is for. It is intentionally operational: read it when you need to know where to start, what to modify, and what not to touch.

## Root Files

| File | Purpose | Modify when |
| --- | --- | --- |
| `README.md` | Human entrypoint for the Atlas project knowledge pack. Explains that this is not the app scaffold and points to workflows, docs, and skills. | The top-level onboarding story or skill list changes. |
| `AGENTS.md` | Always-on project instructions for coding agents. Defines non-negotiables, commands, structure, git rules, and protected boundaries. | A core invariant or agent-wide workflow rule changes. Keep it short. |
| `CLAUDE.md` | Claude-specific memory file that points Claude Code to `AGENTS.md` and project skills. | Adding/removing Claude skills or changing Claude-specific guidance. |
| `commitlint.config.cjs` | Conventional Commit type rules for future app repo CI. | Commit type policy changes. |
| `.gitignore` | Ignores dependency folders, env files, build outputs, local caches, logs, OS/editor noise, and local artifacts. | New tooling creates local files that should never be committed. |

## Claude Skills

| File | Purpose | Modify when |
| --- | --- | --- |
| `.claude/skills/atlas-ai/SKILL.md` | AI, ingestion, RAG, citations, actions, and eval workflow. | AI behavior, eval, or ingestion policy changes. |
| `.claude/skills/atlas-backend/SKILL.md` | Backend/API/domain/service review and implementation workflow. | Backend boundaries or service/API standards change. |
| `.claude/skills/atlas-bootstrap/SKILL.md` | Phase 0 runnable app scaffold workflow: pnpm, mise, Docker Compose, env, seeds, CI, first shells, auth/billing/AI/OCR boundaries. | Bootstrap contract, local infra, seed, env, or scaffold requirements change. |
| `.claude/skills/atlas-create-skills/SKILL.md` | Creates or updates Atlas skills while preserving source-of-truth alignment. | Skill authoring policy changes. |
| `.claude/skills/atlas-db/SKILL.md` | Database, migration, pgvector, full-text, permissions, and data-integrity workflow. | Schema/migration/retrieval storage policy changes. |
| `.claude/skills/atlas-deploy/SKILL.md` | Deployment readiness, previews, env, migrations, rollback, and Vercel Services checks. | Deployment environments or release gates change. |
| `.claude/skills/atlas-frontend/SKILL.md` | Next.js/frontend implementation and review workflow. | Web/PWA/frontend architecture changes. |
| `.claude/skills/atlas-implement/SKILL.md` | Implementation workflow after an issue/plan exists. | Coding workflow, verification, or scope rules change. |
| `.claude/skills/atlas-issue/SKILL.md` | Turns requests into scoped GitHub issues. | Issue template or acceptance bar changes. |
| `.claude/skills/atlas-owner-onboarding/SKILL.md` | Role-specific onboarding for owners and agents. | Ownership model or first-task guidance changes. |
| `.claude/skills/atlas-plan/SKILL.md` | ADR-aligned implementation planning, with Phase 0 requirement grilling. | Planning shape, grill framework, or architecture decision gates change. |
| `.claude/skills/atlas-pr/SKILL.md` | Mode A opens/updates reviewable PRs with preview, screenshots, tests, risks, rollback, and senior-project evidence. Mode B babysits a PR to merge-ready: comments, CI, previews, external reviews, and readiness. | PR flow, template, babysit loop, review-tool policy, or senior-project evidence requirements change. |
| `.claude/skills/atlas-review/SKILL.md` | Extensive PR/diff review workflow. | Review gates, external review tools, or severity model changes. |
| `.claude/skills/atlas-security/SKILL.md` | Security/privacy/OAuth/permission/audit/export review workflow. | Threat model or security requirements change. |
| `.claude/skills/atlas-design/SKILL.md` | Product design, design-system, tokens, visual references, UI states, and screenshot/design QA workflow. | UI system, visual/product principles, tokens, or reference direction change. |
| `.claude/skills/atlas-test/SKILL.md` | Verification workflow for lint, typecheck, tests, e2e, evals, screenshots, preview smoke, and CI evidence. | Test commands, CI gates, or screenshot/e2e evidence requirements change. |
| `.claude/skills/atlas-handoff/SKILL.md` | Handoff workflow for transferring exact state to another teammate or agent. | Handoff content or team/agent transfer rules change. |
| `.claude/skills/atlas-weekly-report/SKILL.md` | Senior project weekly reporting workflow. | Reporting format or evidence requirements change. |

## Cursor Rules And Hooks

| File | Purpose | Modify when |
| --- | --- | --- |
| `.cursor/rules/00-atlas-core.mdc` | Core Atlas invariants for Cursor. | Architecture non-negotiables change. |
| `.cursor/rules/10-frontend.mdc` | Frontend rules for Cursor. | Frontend stack or UI permission boundaries change. |
| `.cursor/rules/20-backend.mdc` | Backend rules for Cursor. | Backend module/service/API rules change. |
| `.cursor/rules/30-db.mdc` | Database rules for Cursor. | Schema, migration, or retrieval-storage rules change. |
| `.cursor/rules/40-ai.mdc` | AI/RAG/ingestion rules for Cursor. | AI behavior, citations, or eval requirements change. |
| `.cursor/rules/50-ui.mdc` | UI design rules for Cursor. | Visual/product interaction principles change. |
| `.cursor/rules/60-tests-review.mdc` | Testing and review rules for Cursor. | Definition of done or PR review gates change. |
| `.cursor/rules/70-security.mdc` | Security/privacy rules for Cursor. | Threat model, OAuth, token, export/delete, or redaction requirements change. |
| `.cursor/rules/80-agent-skills.mdc` | Skill/rule maintenance rules for Cursor. | Skill authoring policy changes. |
| `.cursor/hooks.json` | Project Cursor hook registration for prompt-time Atlas skill suggestions. | Cursor hook schema or hook script changes. |
| `.cursor/hooks/atlas-skill-suggest.py` | Cursor prompt hook that returns Atlas source-of-truth context and skill suggestions. | Skill list or trigger logic changes. |

## GitHub Files

| File | Purpose | Modify when |
| --- | --- | --- |
| `.github/CODEOWNERS.template` | Future CODEOWNERS starter. Placeholder owners must be replaced before activation. | Ownership becomes stable. |
| `.github/ISSUE_TEMPLATE/architecture_decision.yml` | Issue form for ADR/RFC-style decisions. | Architecture issue fields change. |
| `.github/ISSUE_TEMPLATE/bug.yml` | Bug report issue form. | Bug triage fields change. |
| `.github/ISSUE_TEMPLATE/config.yml` | GitHub issue template chooser config. | Issue template routing changes. |
| `.github/ISSUE_TEMPLATE/feature.yml` | Feature issue form. | Feature scoping requirements change. |
| `.github/ISSUE_TEMPLATE/task.yml` | General task issue form. | Task acceptance/test fields change. |
| `.github/PULL_REQUEST_TEMPLATE.md` | Required PR body. Includes preview, tests, privacy/security, AI, rollback, and senior project explanation. | PR evidence requirements change. |
| `.github/workflows/ci.yml` | Starter CI workflow for the future app repo. | Root package scripts or CI gates change. |

## Architecture Docs

| File | Purpose | Modify when |
| --- | --- | --- |
| `docs/architecture/ai.md` | AI architecture summary. | AI pipeline or RAG invariants change. |
| `docs/architecture/atlas-production-spec-and-plan.md` | Main production spec, ADR set, system architecture, UI/API/DB/AI/security/roadmap/issues. | Major product or architecture decisions change. |
| `docs/architecture/backend.md` | Backend modular-monolith structure. | Backend module boundaries or service patterns change. |
| `docs/architecture/db.md` | Core Postgres schema, permissions, pgvector, indexes. | Data model or persistence decisions change. |
| `docs/architecture/frontend.md` | Frontend stack and feature-folder rules. | Web app structure or frontend dependency policy changes. |
| `docs/architecture/privacy-redaction-policy.md` | Purpose-bound disclosure policy for AI/provider calls, fixtures, logs, screenshots, exports, and shared surfaces. | Redaction, provider disclosure, fixture privacy, or AI privacy behavior changes. |
| `docs/architecture/product-invariants.md` | Product-level promises that cannot be broken. | Core product trust model changes. |
| `docs/architecture/repository-structure.md` | Target app scaffold structure and package responsibilities. | App/package layout changes. |
| `docs/architecture/security.md` | Security/privacy architecture. | Threat model or privacy controls change. |
| `docs/architecture/technical-decisions.md` | Architecture decision record summary. | Stack/deployment/OKF/mobile/Convex/etc. decisions change. |
| `docs/architecture/adr-001-acting-first-eve.md` | Accepted ADR: acting-first product, Eve brain, Workflow SDK durability. | Agent runtime, product posture, Temporal/Eve/channel decisions change. |
| `docs/architecture/ui-system.md` | Atlas UI system and surfaces. | Design system or route surface changes. |
| `docs/architecture/ui-quality-bar.md` | Binding UI quality bar and design reset process. Marks the first static prototype as rejected and defines the next acceptance gate. | Visual direction, design quality rules, or UI reset process changes. |

## Process Docs

| File | Purpose | Modify when |
| --- | --- | --- |
| `docs/process/agent-alignment.md` | How agents use source-of-truth docs, skills, and hooks. | Agent workflow, hooks, or alignment rules change. |
| `docs/process/branch-protection-recommended.md` | Recommended GitHub branch protection. | Repo protection policy changes. |
| `docs/process/contributing.md` | Contribution flow. | Contributor workflow changes. |
| `docs/process/definition-of-done.md` | Done criteria for Atlas tasks. | Quality gates change. |
| `docs/process/deployment-policy.md` | Environment, preview, production, and rollback policy. | Deployment process changes. |
| `docs/process/evidence-bundles.md` | Before/after evidence standard for frontend screenshots and backend behavior snapshots. | Evidence requirements or artifact layout changes. |
| `docs/process/engineering-standards.md` | Engineering taste and strict standards for writing, decisions, bug fixes, UI quality, CI, generated files, commits, and secrets. | Project-wide quality or writing rules change. |
| `docs/process/file-map.md` | This file. | Files are added/removed or purposes change. |
| `docs/process/git-workflow.md` | Branch/commit/merge mechanics. | Git workflow changes. |
| `docs/process/issue-policy.md` | Issue rules and issue types. | Issue policy changes. |
| `docs/process/onboarding.md` | Clean-machine setup, `mise`, `doctor`, first-day checklist. | Tool versions or onboarding commands change. |
| `docs/process/owner-onboarding.md` | Area ownership playbooks and Efe-owned gates. | Team ownership or decision gates change. |
| `docs/process/provider-and-env-setup.md` | Provider account model, env modes, fake/local providers, secret handoff, vault policy, and personal-account bootstrap rules. | Provider setup, env policy, secret workflow, local service strategy, or account ownership rules change. |
| `docs/process/pr-review-rubric.md` | Review criteria. | Review bar changes. |
| `docs/process/senior-project-log.md` | Senior project evidence/logging policy. | Academic reporting requirements change. |
| `docs/process/skill-taxonomy.md` | Canonical map of lifecycle, artifact, and domain skills, including plan vs implement boundary and deletion rule. | Skills are added, merged, deleted, or re-scoped. |
| `docs/process/solo-to-team-workflow.md` | Solo bootstrap to 5-person team workflow. | Team size/stage or PR/issue rules change. |

## Prototypes

| File | Purpose | Modify when |
| --- | --- | --- |
| `docs/prototypes/atlas-today-slice/index.html` | Rejected Direction A static slice for Today plus inspector plus composer. Kept only as a failed execution record, not visual source of truth. | Only update to document failure modes or replace after a new approved design exists. |
| `docs/prototypes/atlas-today-slice/README.md` | Explains the rejected Today slice status, open command, design basis, and screenshot targets. | Prototype status or verification requirements change. |
| `docs/prototypes/atlas-ui-system/index.html` | Rejected static UI exploration kept as a record of constraints and failure modes, not accepted visual direction. | Only update to document failure modes or replace after a new approved design direction exists. |
| `docs/prototypes/atlas-ui-system/README.md` | Explains rejected prototype status and points to the UI quality bar. | Prototype status or design reset process changes. |

## Design

| File | Purpose | Modify when |
| --- | --- | --- |
| `docs/design/atlas-ui-reference-audit.md` | Evidence-driven UI reference audit after rejecting the first prototype. Extracts reusable mechanics from Vercel, Linear, OpenAI, Notion, Superhuman, Obsidian, NN/g, and Cursor. | Reference set, design principles, or audit conclusions change. |
| `docs/design/atlas-ui-directions.md` | Three proposed Atlas UI directions and the recommended Direction A Today slice contract. | Efe approves/rejects a direction or layout/token contract changes. |

## Research And Templates

| File | Purpose | Modify when |
| --- | --- | --- |
| `docs/research/research-notes.md` | Source links and checked dates for process/stack decisions. | External docs are refreshed or new decisions need evidence. |
| `docs/templates/adr-template.md` | ADR template. | ADR format changes. |
| `docs/templates/decision-log.md` | Decision log template. | Decision logging format changes. |
| `docs/templates/demo-report.md` | Demo report template. | Demo evidence expectations change. |
| `docs/templates/pr-summary.md` | PR summary template. | PR narrative format changes. |
| `docs/templates/rfc-template.md` | RFC template. | RFC format changes. |
| `docs/templates/weekly-report.md` | Weekly report template. | Weekly reporting format changes. |

## Read Order For New Agents

1. `AGENTS.md`
2. `README.md`
3. `docs/process/agent-alignment.md`
4. `docs/process/engineering-standards.md`
5. `docs/process/onboarding.md`
6. `docs/process/provider-and-env-setup.md`
7. `docs/process/solo-to-team-workflow.md`
8. `docs/process/owner-onboarding.md`
9. `docs/architecture/atlas-production-spec-and-plan.md`
10. The role-specific architecture docs and skills.
