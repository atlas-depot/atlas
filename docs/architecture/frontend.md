# Frontend Architecture

## Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Radix primitives
- shadcn-style component organization
- Zod for runtime validation
- TanStack Query for client-side server state, cache invalidation, retries, optimistic updates, and async UI workflows
- Typed API client for server data
- Storybook for `packages/ui`, component states, design tokens, and mock surfaces from the first scaffold

Do not add Zustand, Framer Motion, or another client-state/motion library by default.
Use URL state, React state, Server Components where appropriate, TanStack Query for client-side server state, and typed API clients.
Add another dependency only when a concrete feature proves the current options are creating real complexity.

## Domain folders

```text
apps/web/src/app
apps/web/src/components
apps/web/src/features/capture
apps/web/src/features/today
apps/web/src/features/chat
apps/web/src/features/search
apps/web/src/features/graph
apps/web/src/features/objects
apps/web/src/features/documents
apps/web/src/features/people
apps/web/src/features/projects
apps/web/src/features/shared-spaces
apps/web/src/features/settings
```

## Rules

- Keep product domains separate.
- Co-locate feature-specific components, hooks, and tests.
- Put reusable primitives in `packages/ui`.
- Do not place business logic in React components.
- Do not call external providers directly from the frontend.
- Do not use TanStack Query as a permission source of truth.
- Do not store server state in Zustand or another global client store.
- All AI, permission, and action decisions must come from backend services.
- UI may preview permissions, but backend must enforce them.

## Design prototyping path

`docs/architecture/ui-system.md` owns this rule: Storybook and code-backed mock surfaces are the design source of truth, and Paper, Pencil, Figma, or standalone HTML stay references until translated into tokens, components, stories, route mockups, and screenshot acceptance criteria.
The reason is drift control. Atlas needs the design language inspectable by agents, testable in CI, and connected to the real component API.
