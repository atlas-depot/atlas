# Atlas Component Map

Status: frontend owner draft.
Audience: UI Design Owner, Frontend Owner, Efe, and coding agents.
This file maps Atlas needs to shadcn/ui primitives.
All primitives live in `packages/ui` with Storybook stories.
Feature logic lives in `apps/web/src/features/*` and never inside primitives.

## Setup decisions

Style is `new-york`.
Base color is neutral or stone before Atlas warm tokens are mapped.
CSS variables mode is enabled.
Icon library is Hugeicons to match the Atlas icon rule.
Lucide is avoided unless a project requirement forces it.
Global CSS maps Atlas warm paper, surface, accent, semantic tint, and data palette tokens to shadcn theme tokens.
Dark mode derives from the same token source with a warm off-black ladder.
Radius scale centers on shell 22 with chip 5 to 6, control 8 to 10, card 12 to 14, panel 14, and pill 999.
Typography uses Space Grotesk for headers and temporal labels, Inter or Geist for body, and Geist Mono for tightly scoped telemetry and provenance.

## Install now for Phase 0 shell and primitives

[Sidebar](https://ui.shadcn.com/docs/components/base/sidebar) provides the 252px navigation, workspace switcher, menu groups, trigger, rail, and mobile sheet behavior.
[Command](https://ui.shadcn.com/docs/components/base/command) provides the global palette for capture, ask, search, create, jump, and act.
[Dialog](https://ui.shadcn.com/docs/components/base/dialog), [sheet](https://ui.shadcn.com/docs/components/base/sheet), [drawer](https://ui.shadcn.com/docs/components/base/drawer), and [popover](https://ui.shadcn.com/docs/components/base/popover) provide modal, right sheet, mobile drawer, and small overlay behavior.
[Button](https://ui.shadcn.com/docs/components/base/button) and [button group](https://ui.shadcn.com/docs/components/base/button-group) provide primary, ghost, and outline actions plus approval pairs.
[Input](https://ui.shadcn.com/docs/components/base/input), [input group](https://ui.shadcn.com/docs/components/base/input-group), [textarea](https://ui.shadcn.com/docs/components/base/textarea), [label](https://ui.shadcn.com/docs/components/base/label), [field](https://ui.shadcn.com/docs/components/base/field), [item](https://ui.shadcn.com/docs/components/base/item), and [kbd](https://ui.shadcn.com/docs/components/base/kbd) provide accessible capture, search, composer, and shortcut display.
[Select](https://ui.shadcn.com/docs/components/base/select) and [combobox](https://ui.shadcn.com/docs/components/base/combobox) provide visibility, relation type, project, and person selection.
[Checkbox](https://ui.shadcn.com/docs/components/base/checkbox), [radio group](https://ui.shadcn.com/docs/components/base/radio-group), [switch](https://ui.shadcn.com/docs/components/base/switch), and [slider](https://ui.shadcn.com/docs/components/base/slider) are scoped to settings, privacy, and questionnaire answers.
[Avatar](https://ui.shadcn.com/docs/components/base/avatar) identifies message senders, people, projects, and reviewers.
[Badge](https://ui.shadcn.com/docs/components/base/badge) renders soft tint-pills for visibility, provenance, confidence, status, risk, and role.
[Tooltip](https://ui.shadcn.com/docs/components/base/tooltip), [hover card](https://ui.shadcn.com/docs/components/base/hover-card), and popover render soft source affordance without louder-than-action styling.
[Tabs](https://ui.shadcn.com/docs/components/base/tabs) organize inspector detail into Overview, Relations, Versions, and Activity.
[Card](https://ui.shadcn.com/docs/components/base/card) is limited to repeated object previews, modals, and genuinely framed tools.
[Separator](https://ui.shadcn.com/docs/components/base/separator) and [scroll area](https://ui.shadcn.com/docs/components/base/scroll-area) implement dividers and independent scrolling for center and inspector.
[Breadcrumb](https://ui.shadcn.com/docs/components/base/breadcrumb) shows workspace, object, and relation paths.
[Table](https://ui.shadcn.com/docs/components/base/table) supports simple lists with the Atlas row height and wrapping contract.
[Typography](https://ui.shadcn.com/docs/components/base/typography) and [typeset](https://ui.shadcn.com/docs/typeset) cover app text and streamed markdown with chat and docs presets.
Setup guides: [installation](https://ui.shadcn.com/docs/installation), [components.json](https://ui.shadcn.com/docs/components-json), [CLI](https://ui.shadcn.com/docs/cli), [theming](https://ui.shadcn.com/docs/theming), [dark mode](https://ui.shadcn.com/docs/dark-mode), [monorepo](https://ui.shadcn.com/docs/monorepo), [skills](https://ui.shadcn.com/docs/skills).

## Install for inbox and documents

[Data table](https://ui.shadcn.com/docs/components/base/data-table) implements the capture queue with sorting, filtering, visibility toggle, row selection, and pagination.
The data table is a TanStack Table guide and not a single drop-in component.
Columns, features, table component, and page shell are implemented per Atlas review fields.
[Dropdown menu](https://ui.shadcn.com/docs/components/base/dropdown-menu) and [context menu](https://ui.shadcn.com/docs/components/base/context-menu) implement row actions from row identity.
[Pagination](https://ui.shadcn.com/docs/components/base/pagination) implements page controls and selection count.
[Calendar](https://ui.shadcn.com/docs/components/base/calendar) and [date picker](https://ui.shadcn.com/docs/components/base/date-picker) implement deadlines, reminders, waiting items, and follow-ups.
[Attachment](https://ui.shadcn.com/docs/components/base/attachment) implements picker, drag, paste, and inline preview for capture and chat files.
[Progress](https://ui.shadcn.com/docs/components/base/progress) implements ingestion, OCR, embedding, extraction, and suggestion stages.

## Install for chat and approvals

[Message](https://ui.shadcn.com/docs/components/base/message) implements row layout with start and end alignment, group stacking, bottom-anchored avatar, header, and footer.
[Bubble](https://ui.shadcn.com/docs/components/base/bubble) implements the visible message surface inside message rows.
[Message scroller](https://ui.shadcn.com/docs/components/base/message-scroller) implements stream-safe scrolling that does not fight a reader who scrolls up.
[Marker](https://ui.shadcn.com/docs/components/base/marker) implements streaming and tool status with assistive announcements.
[Questionnaire](https://ui.shadcn.com/docs/components/base/questionnaire) implements multi-step questions and approvals with single, multiple, freeform, and skippable items plus shortcuts, validation, resume, conditional items, and card or dialog composition.
The [AI SDK helper](https://ui.shadcn.com/docs/helpers/ai-sdk) implements offline deterministic conversations through the real chat lifecycle for UI development, previews, screenshots, docs, and CI tests.
The [TanStack AI helper](https://ui.shadcn.com/docs/helpers/tanstack-ai) is the alternative path when the stack uses TanStack AI instead of the Vercel AI SDK.
Human-in-the-loop tool behavior implements paused tools, approval gating, continuations, denial handling, and client wiring for Level 3 confirmation flows.
Pending ADR-001 (open PR #9): if merged, hard grounding becomes soft citations (G1), approvals become P1 (auto drafts and internal writes, confirm real external writes), the web composer uses Eve `useEveAgent`, the Bot owner becomes Agent Channels, and Temporal defaults become Workflow SDK.
Chat and approval shells above stay valid; citation strictness and approval triggers follow the ADR.

## Install for state coverage

[Empty](https://ui.shadcn.com/docs/components/base/empty) implements Cold, Quiet, and Earned empty states with one contextual action and no hollow celebration.
[Skeleton](https://ui.shadcn.com/docs/components/base/skeleton) implements layout-matching loading placeholders.
[Spinner](https://ui.shadcn.com/docs/components/base/spinner) implements small inline loading inside buttons and badges.
[Alert](https://ui.shadcn.com/docs/components/base/alert) implements inline information and warnings with recoverable actions.
[Alert dialog](https://ui.shadcn.com/docs/components/base/alert-dialog) implements explicit confirmation only for real external writes and destructive actions.
[Toast](https://ui.shadcn.com/docs/components/base/toast) implements light transient feedback with success, info, warning, error, and loading types plus actions and promise updates.
[Collapsible](https://ui.shadcn.com/docs/components/base/collapsible) and [accordion](https://ui.shadcn.com/docs/components/base/accordion) implement Today groups, review cards, and settings sections.
Form with [React Hook Form](https://ui.shadcn.com/docs/forms/react-hook-form) and Zod implements capture and settings forms with controller, field, field error, invalid styling, and accessible errors.

## Defer or avoid

Chart is deferred until Today analytics ships with an ADR.
Recharts is not installed by default because Atlas prefers a zero-dependency SVG Bayer pattern for dithered data fills.
Carousel is avoided because Atlas has no marketing carousel need and motion stays restrained.
Marquee is avoided as decorative motion.
Navigation menu and menubar are avoided because Atlas uses the left sidebar and not a top mega menu.
Input OTP is avoided because MVP auth has no OTP requirement.
Aspect ratio is avoided except for a specific document image need.
Toggle and toggle group are deferred until a view switcher requirement appears.
Native select is deferred except for a mobile fallback need.
Scroll fade and shimmer utilities are deferred as visual extras.
No Zustand is added for client state.
No Framer Motion is added by default.
No GraphQL is added.
No tRPC is added.
No separate vector database is added.
No Convex primary storage is added.

## Per-component Atlas rules

Every memory object shows visibility and provenance with badge and field rows.
Every AI answer shows source affordance with tooltip, hover card, or inspector link.
Every action shows risk and approval state with questionnaire or alert dialog where required.
Internal writes and external drafts run without approval fatigue.
Real external writes and destructive actions require short explicit confirmation.
Destructive MVP actions stay forbidden at Level 4.
Secrets never appear in UI text, screenshots, fixtures, logs, traces, PR bodies, or evidence artifacts.
Permission preview may appear in UI but enforcement stays in backend services.
TanStack Query manages server state and never acts as permission truth.
Business logic stays outside React components.
Disclosure levels D0 through D5 are respected and approval UI shows exact external disclosure before Level 2 or Level 3 actions.
Private mode objects stay excluded from cloud processing unless explicitly approved.
Storybook covers tokens, primitives, object previews, source and citation parts, approval parts, permission-redacted states, route mocks, and every required loading, empty, error, unauthorized, offline, low-confidence, and approval state.
Evidence uses agent-browser screenshots and snapshots at desktop and mobile widths.
