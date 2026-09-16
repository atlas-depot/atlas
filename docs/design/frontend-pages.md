# Atlas Frontend Pages

Status: frontend owner draft.
Audience: UI Design Owner, Frontend Owner, Efe, and coding agents.
Source of truth order still applies: this file details `docs/architecture/ui-system.md` and `docs/architecture/atlas-production-spec-and-plan.md` and does not override them.

## References

Atlas sources: `docs/architecture/ui-system.md`, `docs/architecture/atlas-production-spec-and-plan.md`, `docs/architecture/frontend.md`, `docs/architecture/product-invariants.md`, `docs/architecture/security.md`, `docs/design/atlas-design-tokens.md`, `docs/design/ui-rulebook.md`, `docs/design/app-shell-spec.md`, `docs/design/component-map.md`.
Shadcn system: [components index](https://ui.shadcn.com/docs/components), [installation](https://ui.shadcn.com/docs/installation), [theming](https://ui.shadcn.com/docs/theming), [dark mode](https://ui.shadcn.com/docs/dark-mode), [CLI](https://ui.shadcn.com/docs/cli), [monorepo](https://ui.shadcn.com/docs/monorepo), [blocks](https://ui.shadcn.com/blocks), [typeset](https://ui.shadcn.com/docs/typeset), [skills](https://ui.shadcn.com/docs/skills), [registry MCP](https://ui.shadcn.com/docs/registry/mcp).
Shell and navigation: [sidebar](https://ui.shadcn.com/docs/components/base/sidebar), [command](https://ui.shadcn.com/docs/components/base/command), [breadcrumb](https://ui.shadcn.com/docs/components/base/breadcrumb), [resizable](https://ui.shadcn.com/docs/components/base/resizable), [scroll area](https://ui.shadcn.com/docs/components/base/scroll-area), [separator](https://ui.shadcn.com/docs/components/base/separator), [kbd](https://ui.shadcn.com/docs/components/base/kbd), [tabs](https://ui.shadcn.com/docs/components/base/tabs).
Data and forms: [data table](https://ui.shadcn.com/docs/components/base/data-table), [table](https://ui.shadcn.com/docs/components/base/table), [pagination](https://ui.shadcn.com/docs/components/base/pagination), [calendar](https://ui.shadcn.com/docs/components/base/calendar), [date picker](https://ui.shadcn.com/docs/components/base/date-picker), [attachment](https://ui.shadcn.com/docs/components/base/attachment), [progress](https://ui.shadcn.com/docs/components/base/progress), [React Hook Form](https://ui.shadcn.com/docs/forms/react-hook-form), [field](https://ui.shadcn.com/docs/components/base/field), [item](https://ui.shadcn.com/docs/components/base/item).
Chat and AI: [message](https://ui.shadcn.com/docs/components/base/message), [bubble](https://ui.shadcn.com/docs/components/base/bubble), [message scroller](https://ui.shadcn.com/docs/components/base/message-scroller), [questionnaire](https://ui.shadcn.com/docs/components/base/questionnaire), [marker](https://ui.shadcn.com/docs/components/base/marker), [AI SDK helper](https://ui.shadcn.com/docs/helpers/ai-sdk), [TanStack AI helper](https://ui.shadcn.com/docs/helpers/tanstack-ai).
Feedback and overlays: [empty](https://ui.shadcn.com/docs/components/base/empty), [skeleton](https://ui.shadcn.com/docs/components/base/skeleton), [spinner](https://ui.shadcn.com/docs/components/base/spinner), [alert](https://ui.shadcn.com/docs/components/base/alert), [alert dialog](https://ui.shadcn.com/docs/components/base/alert-dialog), [dialog](https://ui.shadcn.com/docs/components/base/dialog), [sheet](https://ui.shadcn.com/docs/components/base/sheet), [drawer](https://ui.shadcn.com/docs/components/base/drawer), [toast](https://ui.shadcn.com/docs/components/base/toast), [popover](https://ui.shadcn.com/docs/components/base/popover), [tooltip](https://ui.shadcn.com/docs/components/base/tooltip), [hover card](https://ui.shadcn.com/docs/components/base/hover-card), [dropdown menu](https://ui.shadcn.com/docs/components/base/dropdown-menu), [context menu](https://ui.shadcn.com/docs/components/base/context-menu), [badge](https://ui.shadcn.com/docs/components/base/badge), [avatar](https://ui.shadcn.com/docs/components/base/avatar), [button](https://ui.shadcn.com/docs/components/base/button), [button group](https://ui.shadcn.com/docs/components/base/button-group), [card](https://ui.shadcn.com/docs/components/base/card).

## Build order

This file is an inventory and roadmap, not a build sequence.
Per `docs/architecture/ui-quality-bar.md` §Required design reset process, Phase 1 builds only Today (§1) plus the object inspector (§6) plus the persistent AI composer (global elements above).
Phase 1 must pass browser verification at all four mandatory viewports before expansion.
Phase 2 builds inbox (§2), chat (§3), search (§4), graph (§5), documents (§7), people (§8), projects (§9), shared spaces (§10), settings (§11), and auth (§12).
No agent starts a Phase 2 page while Phase 1 is unapproved.

## Global elements present on all pages

The left sidebar shows workspace, Today, Inbox, Search, Graph, Projects, People, Documents, Shared Spaces, and Settings.
The center surface shows the current route, with Today as the default route.
The right context panel shows the object inspector, citations, source preview, related items, suggestions, and action approvals.
The global command palette supports capture, ask, search, create, jump, and act.
The persistent AI composer is available broadly but never replaces structured product surfaces.

## 1. Today Command Center

Route: `/`.
Purpose: show what matters today in one calm surface.
Key sections: Today, Waiting On, Deadlines, Suggested Actions, Recent Changes, Forgotten Follow-ups, Active Projects, People to Reply To, Documents Needed, Shared Updates.
Every card item shows source, visibility, confidence, status, and action affordance.
Primary components: rows with dividers, soft tint-pills, tabs for grouping, progress for ingestion states, toast for light updates.
Required states: loading skeleton matching final layout, empty with quick capture and connect actions, error with retry and audit id, offline with queued capture note, low-confidence with review entry.
Acceptance: one primary attention target.
Acceptance: no card grid.
Acceptance: no nested cards.
Acceptance: source basis is visible but quieter than the action.
Acceptance: draft and approval risk are obvious without visual shouting.
Storybook: Today mock screen plus all states above at desktop and mobile widths.

## 2. Capture Inbox

Route: `/inbox`.
Purpose: review the queue of captures with raw preview, extracted objects, relation candidates, confidence, errors, and review state.
Actions: accept all, edit, reject, split, merge, and choose among alternatives when confidence is low.
Primary components: data table with sorting, filtering, visibility toggle, row selection, and pagination, plus row menus, date picker for deadlines, attachment preview, and progress for pipeline stages.
Required states: loading skeleton for rows, empty inbox with upload guidance, error with retry and audit id, offline with local queue note, unauthorized without leaking hidden object existence.
Acceptance: data rows meet the 54px minimum height contract.
Acceptance: row state never hides action or risk information.
Acceptance: long titles and file names wrap without overlap.
Storybook: inbox mock screen, row variants, review card variants, and all states above.

## 3. Chat

Route: `/chat`.
Purpose: threaded memory-grounded assistant with source cards, chunk citations, retrieval trace toggle for dev or admin, and action proposal cards.
Ungrounded answers are explicitly labeled ungrounded.
Pending ADR-001 (open PR #9): citation strictness, approval triggers, Eve composer wiring, and the Agent Channels ownership follow the ADR once decided.
Current text reflects `main`; shells and layouts above stay valid either way.
Primary components: message rows, bubbles, message scroller, attachment input, questionnaire for multi-step questions and approvals, marker for streaming status, and typeset for markdown rendering.
Required states: streaming without layout shift, tool running and denied states, empty thread with starter prompt, error with retry and audit id, offline with queued message note.
Acceptance: every memory-grounded claim has source affordance.
Acceptance: every action proposal shows risk level and approval state.
Acceptance: the composer stays attached to the bottom of the main pane while content scrolls.
Storybook: thread mock, message variants, tool states, questionnaire variants, and all states above.

## 4. Search

Route: `/search`.
Purpose: hybrid result list with facets for type, project, person, source, date, status, visibility, and confidence.
Result cards show title, summary, matched chunks, citations, relation hints, and open-in-inspector action.
Primary components: input with command support, combobox and select for facets, tabs for result grouping, cards only for repeated result previews, and hover cards for quick previews.
Required states: loading skeleton, empty with filter and capture suggestions, error with retry and audit id, offline with cached note, unauthorized without revealing hidden objects.
Acceptance: facets actually filter server results and are reflected in URL state.
Acceptance: every result links to the inspector route.
Storybook: search mock screen, facet variants, result card variants, and all states above.

## 5. Memory Graph

Route: `/graph`.
Purpose: inspect nodes as memory objects and edges as typed relations with inspection, filtering, and correction.
Required filters: person, project, date, source, visibility, relation type, and confidence.
Clicking a node opens the inspector.
Clicking an edge opens relation detail and correction controls.
Primary components: custom graph stage plus hover cards, inspector panel, select and combobox filters, and dialog for relation correction.
Required states: loading skeleton, empty with explanation that the graph appears after extraction, error with retry and audit id, offline note, unauthorized without leaking hidden nodes.
Acceptance: stage meets the 600px minimum height on desktop.
Acceptance: mobile uses a separate graph route and never a cramped miniature.
Acceptance: hidden endpoint relations stay hidden and visibly redacted where appropriate.
Storybook: graph mock screen, node and edge detail variants, filter variants, and all states above.

## 6. Object Inspector

Route: right panel everywhere plus deep links at `/objects/[id]`.
Purpose: universal side sheet for any object type with title, summary, payload, source, citations, relations, versions, visibility, confidence, audit history, suggestions, and actions.
Primary components: tabs for Overview, Relations, Versions, and Activity, plus key-value field rows, badges for visibility and provenance, tooltip and hover cards for sources, and resizable split with the center surface.
Required states: loading skeleton, empty object, error with retry and audit id, unauthorized without revealing hidden fields, offline with stale note, low-confidence with review actions, action-approval with explicit confirm.
Acceptance: inspector width is 344px on desktop.
Acceptance: inspector reads as a calm field surface and not as a tag cloud.
Acceptance: field rows use the 92px label plus flexible value contract on desktop.
Storybook: inspector mock, field row variants, version diff variant, approval variant, permission-redacted variant, and all states above.

## 7. Document Library

Route: `/documents`.
Purpose: browse files, PDFs, images, screenshots, links, and their extraction status.
Primary components: data table or row list, attachment previews, badges for file status, and dialog for file detail.
Required states: loading skeleton, empty with upload action, error with retry and audit id, offline note, unauthorized without leaking hidden files.
Acceptance: file names and source names wrap without horizontal scroll.
Acceptance: every file links to its source object and inspector.
Storybook: library mock screen and all states above.

## 8. People

Route: `/people`.
Purpose: browse person objects, their relations, tasks, waiting items, and follow-ups.
Primary components: row list or table, avatar, badges for relation type, tabs for detail, and inspector link actions.
Required states: loading skeleton, empty with capture suggestion, error with retry and audit id, offline note, unauthorized without leaking hidden people.
Acceptance: relation edges open correction controls.
Acceptance: private relations stay hidden unless both endpoints are visible.
Storybook: people mock screen and all states above.

## 9. Projects

Route: `/projects`.
Purpose: browse project objects with tasks, deadlines, members, documents, and suggestions.
Primary components: row list, progress for completion, calendar and date picker for deadlines, tabs for project detail, and inspector link actions.
Required states: loading skeleton, empty with create project action, error with retry and audit id, offline note, unauthorized without leaking hidden projects.
Acceptance: deadlines and waiting items are visible with source basis.
Acceptance: project detail never duplicates inspector logic and links to it.
Storybook: projects mock screen and all states above.

## 10. Shared Spaces

Route: `/shared-spaces` plus shared detail routes.
Purpose: show explicitly selected memory only with included objects, visible relation graph, updates, members, roles, and redaction indicators when relations or private sources are hidden.
Primary components: row list, badges for role and visibility, dialog for sharing setup, alert for redaction notes, and empty state with add-object action.
Required states: loading skeleton, empty with add selected objects guidance and no broad share action, error with retry and audit id, offline note, unauthorized without revealing hidden objects.
Acceptance: shared view never derives summaries from hidden objects.
Acceptance: relation visibility requires both endpoints visible to the viewer.
Acceptance: redaction indicators are explicit and calm.
Storybook: shared spaces mock screen, redacted relation variant, member role variants, and all states above.

## 11. Settings and Privacy Center

Route: `/settings` plus `/settings/privacy`.
Purpose: manage account, workspaces, members, OAuth connections, scopes, sync status, token revocation, private mode, exports, deletion, audit log, AI data controls, and feature flags.
Primary components: forms with React Hook Form and Zod, field and item primitives, switch and checkbox and radio group and slider controls, accordion for sections, dialog for destructive confirmation, and toast for light feedback.
Required states: loading skeleton, empty sections with guidance, error with retry and audit id, offline note, unauthorized without leaking admin-only controls.
Acceptance: destructive actions require explicit confirmation and show rollback or audit reference.
Acceptance: token revocation and export and deletion flows are reachable and tested.
Acceptance: no secrets appear in UI text, screenshots, fixtures, logs, or PR bodies.
Storybook: settings mock screens, form variants, destructive confirmation variant, and all states above.

## 12. Auth

Route: `/login`.
Phase: Phase 2.
Purpose: Better Auth baseline login, logout, session, and account connection without custom design deviation.
Primary components: card for the login panel, form with React Hook Form and Zod, input for email, button for submit, alert for errors, and toast for session notices.
Required states: loading on submit, error with retry and privacy-safe detail, offline note, unauthorized as the default pre-login state.
Acceptance: login, logout, session, and me flows work against the auth baseline.
Acceptance: Google sign-in entry point is present once the OAuth gate is approved by Efe.
Acceptance: no secrets, tokens, or session material appear in UI text, screenshots, fixtures, logs, or PR bodies.
Storybook: login mock screen and all states above.

## Cross-page contracts

Every page implements loading, empty, error, unauthorized, offline, low-confidence where relevant, and action-approval where relevant.
Every memory object shows visibility and provenance.
Every AI answer has source affordance.
Every action shows risk and approval state.
Business logic stays outside React components.
Permission truth stays in backend services.
TanStack Query manages server state and never acts as permission truth.
Screenshots use agent-browser at desktop and mobile widths before PR review.
