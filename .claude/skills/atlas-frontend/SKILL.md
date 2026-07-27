---
name: atlas-frontend
description: Implement or review Atlas frontend features using Next.js App Router, React, TypeScript, typed APIs, PWA capture, domain-oriented feature folders, Eve web client states, and soft citation UI. Use when building or reviewing a screen, route, component, or capture flow in the web app.
---

# Atlas Frontend Skill

Use this skill for frontend work.

## Required Reading

Read:

- `AGENTS.md`
- `docs/process/agent-alignment.md`
- `docs/architecture/frontend.md`
- `docs/architecture/ui-system.md`
- `docs/architecture/repository-structure.md`
- `.claude/skills/atlas-design/SKILL.md`

## Rules

- Keep UI components focused on rendering and interaction.
- Keep domain logic in feature hooks/services or backend.
- Use typed API clients.
- Use TanStack Query for client-side server state, cache invalidation, retries, optimistic updates, and async UI workflows.
- Handle loading, empty, error, and permission states.
- Keep accessibility and keyboard flows in mind.
- Do not introduce client-only permission enforcement as the source of truth.
- Do not call LLMs or external integrations directly from the browser.
- Do not add Zustand, Framer Motion, or extra state/motion libraries without a documented need.
- Use URL state for navigation/filtering and React state for local ephemeral state.
- Do not use TanStack Query as a permission source of truth.
- Do not store server state in Zustand or another global client store.
- Use Storybook for shared components, tokens, key states, and code-backed mock surfaces once the app scaffold exists.
- All memory object responses must render visibility/provenance affordances.
- AI answers must render source items.

## Required UI states

- Loading
- Empty
- Error
- Unauthorized
- Low-confidence AI result
- Action approval required
- Offline or sync pending where PWA capture applies
- Permission redacted
- Missing source/citation

## Implementation Workflow

1. Identify route/domain folder.
2. Define server data contract and loading/error/empty states.
3. Build responsive layout with keyboard path.
4. Keep business rules in backend/domain services.
5. Add or update Storybook stories for shared states when touching reusable UI.
6. Add focused component tests or E2E smoke where practical.
7. Provide screenshot or preview evidence for PRs once previews exist.

## Output

- Component structure.
- State model.
- API calls.
- Tests.
- Screenshots or preview requirements.
- Accessibility and keyboard notes.
