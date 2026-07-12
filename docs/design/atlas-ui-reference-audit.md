# Atlas UI Reference Audit

Status: active design reset input  
Checked: 2026-07-01  
Owner gate: Efe Baran Durmaz for final visual direction

## Purpose

This audit starts the Atlas UI reset after rejecting the first static prototype.
The goal is not to copy any reference product.
The goal is to extract mechanics that make a serious product feel precise, calm, trustworthy, and usable for long work sessions.

Atlas must become a memory operating surface, not a generic AI dashboard.
The first accepted design slice is Today plus right inspector plus composer.

## Audit lens

Each reference is evaluated through these questions:

- Does the surface protect one primary attention target?
- Does it use spacing and alignment before extra boxes?
- Does it show status, source, risk, or provenance as system facts rather than decoration?
- Does it support keyboard-first work without flooding the interface with shortcut labels?
- Does it handle long content and dense state without overlap or visual panic?
- Does it feel publishable by a top-tier product company?

## Reference Findings

### 1. Vercel Web Interface Guidelines

Source: [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines)

What works:
Vercel treats interaction details as product quality, including keyboard operation, focus rings, URL state, deep links, resilient content, designed empty/error states, and long-content handling.

Atlas should borrow:
All important state should be addressable, recoverable, keyboard-operable, and screenshot-tested.
Today filters, object selection, side sheets, graph filters, and inspector tabs should be URL-backed where possible.

Atlas should reject:
Do not copy Vercel's monochrome developer-tool austerity without adding memory-specific warmth and provenance semantics.

### 2. Vercel Interaction Details

Source: [Vercel Web Interface Guidelines - Interactions](https://vercel.com/design/guidelines)

What works:
The guidelines turn small behaviors into contracts, such as visible focus, hit target size, optimistic updates, loading label retention, paste support, and predictable destructive action handling.

Atlas should borrow:
Every action suggestion must retain its label while loading, show an approval state when needed, and preserve user control.
No AI action should silently turn into a different state.

Atlas should reject:
Do not hide critical memory safety behind tooltips.
Inline explanation beats hover-only help.

### 3. Vercel Layout Details

Source: [Vercel Web Interface Guidelines - Layout](https://vercel.com/design/guidelines)

What works:
The layout rules emphasize deliberate alignment, responsive coverage, unwanted-scrollbar prevention, intrinsic sizing, and long-content resilience.

Atlas should borrow:
Every screen needs a specific overflow policy.
Main content, inspector, document preview, graph canvas, and command palette cannot accidentally create competing scroll zones.

Atlas should reject:
Do not build a layout that only looks correct on a single 1440px screenshot.

### 4. Vercel Content Details

Source: [Vercel Web Interface Guidelines - Content](https://vercel.com/design/guidelines)

What works:
The content rules require no dead ends, all states designed, redundant status cues, resilient user-generated content, and useful accessibility semantics.

Atlas should borrow:
Every empty state should offer a next memory action.
Every cited answer should show a source path and visibility state with accessible names, even when the visual UI is restrained.

Atlas should reject:
Do not use visible labels for everything just because metadata exists.
Accessible names can exist without turning the screen into a wall of labels.

### 5. Geist Design System

Source: [Geist Design System](https://vercel.com/geist/introduction)

What works:
Geist is explicit about a design system as consistent web infrastructure, with foundations, components, command menu, entity, drawer, sheet, table, skeleton, and status primitives.

Atlas should borrow:
Atlas needs a component inventory before visual scale expands.
The first Storybook should include entity rows, source previews, inspector fields, approval bars, redacted states, command menu, and table/list variants.

Atlas should reject:
Do not bring every component into Atlas by default.
Component abundance creates visual abundance if ownership is weak.

### 6. Geist Colors

Source: [Geist Colors](https://vercel.com/geist/colors)

What works:
The color system is high-contrast and role-based.
It separates scales from semantic usage.

Atlas should borrow:
Use semantic color roles first: page, surface, surface raised, line, text, muted text, accent, warning, danger, success, focus, private, shared, redacted.

Atlas should reject:
Do not make the product feel like Vercel's brand.
Atlas needs memory trust semantics, not deployment-console semantics.

### 7. Geist Typography

Source: [Geist Typography](https://vercel.com/geist/typography)

What works:
Geist is engineered for developer and designer tools, which helps dense UI stay legible.

Atlas should borrow:
Use a restrained type scale, tabular numerals for dates/counts, and predictable line heights.

Atlas should reject:
Do not rely on a technical font alone to create taste.
The rejected prototype proved that type choice without composition still fails.

### 8. Geist Grid

Source: [Geist Grid](https://vercel.com/geist/grid)

What works:
Grid structure gives pages a quiet spatial discipline.

Atlas should borrow:
The app shell should align to a strict grid.
Inspector fields, task ledger rows, source citations, and command surfaces should line up across screens.

Atlas should reject:
Do not over-expose grid visuals.
Atlas is for memory work, not showing off layout construction.

### 9. Linear Method Introduction

Source: [Linear Method - Principles and Practices](https://linear.app/method/introduction)

What works:
Linear explicitly prioritizes creators, purpose-built tools, clarity, simple-first power, and removing busy work.

Atlas should borrow:
Today should remove user-maintained organization work.
The screen should show what matters, what changed, and what needs approval without asking the user to manage the system.

Atlas should reject:
Do not overfit Atlas into issue-tracker patterns.
Memory objects are richer than issues.

### 10. Linear Design Process

Source: [Linear Method - Manage design projects](https://linear.app/method/manage-design-projects)

What works:
Linear's process starts by verifying the problem, then exploring several options, then narrowing with feedback before handoff.

Atlas should borrow:
The current reset should not produce another full app mockup immediately.
It should produce three directions, pick one, then build only the Today slice.

Atlas should reject:
Do not treat a bad prototype as almost done.
The right move is direction selection, not polishing.

### 11. Linear Quality

Source: [Linear - Conversations on Quality](https://linear.app/quality)

What works:
Linear frames quality as something users feel through experience, not something fully captured by a checklist.

Atlas should borrow:
Atlas still needs strict checklists, but Efe's taste gate remains valid.
If the UI feels bad, it is bad even if the boxes are checked.

Atlas should reject:
Do not hide behind measurable layout rules when the experience lacks taste.

### 12. OpenAI Brand Wordmark

Source: [OpenAI Brand](https://openai.com/brand/)

What works:
OpenAI protects spacing, proportions, simple marks, and restraint.
The brand guidance repeatedly avoids distortion, extra effects, and busy backgrounds.

Atlas should borrow:
Atlas needs space around the important object.
The selected memory object or primary action should be allowed to breathe.

Atlas should reject:
Do not add decorative symbols, orbs, gradient artifacts, or AI-coded visual noise.

### 13. OpenAI Typography

Source: [OpenAI Brand - Typography](https://openai.com/brand/)

What works:
OpenAI Sans aims for technological precision with human warmth.
The important point is the balance, not the exact font.

Atlas should borrow:
Typography should feel precise but not sterile.
The UI should use one strong sans family and reserve editorial contrast for long-form memory reading only.

Atlas should reject:
Do not use anonymous default typography if Atlas is meant to feel trusted and intentional.

### 14. ChatGPT Web App

Source: [ChatGPT](https://chatgpt.com/)

What works:
The default surface is sparse and centered on the user's next input.
The side navigation exists but does not dominate the initial state.

Atlas should borrow:
The composer should be persistent and calm.
It should not compete with Today, Inbox, Search, Graph, or Inspector.

Atlas should reject:
Do not make Atlas chat-only.
Memory work needs inspectable surfaces, not only a prompt.

### 15. OpenAI Business Product Surface

Source: [OpenAI Business](https://openai.com/business/)

What works:
The page shows product examples with a recognizable left rail, project labels, and prompt options.

Atlas should borrow:
Use recognizable product nouns like Projects, Library, Scheduled, Chats, and Agents only when they map to real Atlas objects.

Atlas should reject:
Prompt suggestion chips can become visual noise.
Atlas should show a small number of context-aware actions, not a prompt buffet.

### 16. Notion Product

Source: [Notion Product](https://www.notion.com/product)

What works:
Notion positions itself as one workspace for documents, knowledge, projects, search, and agents.
The product narrative is object-first rather than chat-first.

Atlas should borrow:
Object pages and database-like views should feel calm, editable, and durable.
The user should be able to inspect memory without feeling trapped inside an assistant transcript.

Atlas should reject:
Do not inherit Notion's tendency toward broad flexible blocks in the MVP.
Atlas needs automatic structure and safety, not infinite manual workspace assembly.

### 17. Notion Enterprise Search and Knowledge Base

Source: [Notion Product](https://www.notion.com/product)

What works:
The product emphasizes one search across work and a knowledge base as a source of truth.

Atlas should borrow:
Search should expose evidence, source type, object type, visibility, and answerability.

Atlas should reject:
Do not say "source of truth" unless permissions, provenance, and citations are visible in the UI.

### 18. Notion Calendar

Source: [Notion Calendar](https://www.notion.com/product/calendar)

What works:
Notion Calendar combines commitments, project timelines, time zones, command menu, shortcuts, and context from Notion docs.

Atlas should borrow:
Today should interleave tasks, reminders, events, waiting-on items, and source changes in one work surface.

Atlas should reject:
Do not turn Today into a calendar clone.
Atlas is about memory-driven priority, not only time slots.

### 19. Superhuman Mail

Source: [Superhuman Mail](https://superhuman.com/products/mail)

What works:
Superhuman focuses on responsiveness, triage, follow-up, snippets, and speed.
Split Inbox is valuable because it prioritizes what needs attention.

Atlas should borrow:
Today and Inbox should act like memory triage, separating needs action, waiting on, source review, and safe drafts.

Atlas should reject:
Do not optimize only for speed.
Atlas needs source trust before action speed.

### 20. Superhuman AI

Source: [Superhuman Mail](https://superhuman.com/products/mail)

What works:
The assistant metaphor is useful because it describes a system working beside the user.

Atlas should borrow:
Atlas can suggest drafts, follow-ups, reminders, and workflows.

Atlas should reject:
Automatic external sending is out of MVP.
The UI must never imply that an external write happened before approval.

### 21. Superhuman Follow-Up

Source: [Superhuman Mail](https://superhuman.com/products/mail)

What works:
Follow-up reminders solve a real anxiety: users forget what they are waiting on.

Atlas should borrow:
Waiting-on objects need first-class visual treatment in Today.

Atlas should reject:
Do not hide waiting-on state inside email threads.
It should become a typed relation visible across memory.

### 22. Obsidian Graph

Source: [Obsidian Graph View](https://obsidian.md/help/plugins/graph)

What works:
Obsidian's graph makes relationships explorable through nodes and edges.

Atlas should borrow:
Graph should show typed objects and typed relation edges.
Clicking a node should open the inspector with evidence and visibility.

Atlas should reject:
Do not ship a decorative constellation.
Atlas graph must support filtering, evidence, correction, and permission-aware redaction.

### 23. NN/g Usability Heuristics

Source: [NN/g 10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)

What works:
The heuristics connect system status, user control, error prevention, recognition, efficiency, and minimalism to trust.

Atlas should borrow:
AI writes, ingestion progress, action approval, and permission redaction must keep users informed.
Undo and recovery paths matter as much as creation flows.

Atlas should reject:
Do not replace system status with decorative badges.
Status should be understandable and actionable.

### 24. NN/g Aesthetic and Minimalist Design

Source: [NN/g Aesthetic and Minimalist Design](https://www.nngroup.com/articles/aesthetic-minimalist-design/)

What works:
The key lesson is that every extra information unit competes with relevant information.

Atlas should borrow:
Metadata should be progressive.
The default screen should show only what helps the user decide the next step.

Atlas should reject:
Do not show all provenance, confidence, risk, counters, and shortcuts at once just because they are important.

### 25. Cursor and Ryo Lu

Source: [WIRED on Cursor Visual Editor](https://www.wired.com/story/cursor-launches-pro-design-tools-figma)

What works:
The article describes Cursor's concern with real CSS controls, professional software builders, and respecting a company's existing design language instead of generating generic-looking apps.

Atlas should borrow:
Design artifacts should map to real CSS tokens, real component APIs, and screenshot evidence.

Atlas should reject:
Do not accept generic AI-looking UI.
If the output looks like it came from a template generator, stop and restart.

## Extracted Atlas Principles

### Principle 1: One operational surface

Today is not a grid of dashboard cards.
It is a work surface with a primary focus, a prioritized ledger, and a calm inspector.

### Principle 2: Inspector as evidence ledger

The right panel is not a tag cloud.
It is where provenance, visibility, confidence, action risk, rollback path, related objects, and source preview become inspectable.

### Principle 3: Status without decoration

Status should appear as row state, field value, approval banner, or inline sentence.
Default pills are forbidden because they create equal-weight noise.

### Principle 4: Command is transit, not home

The command palette and composer should accelerate capture, ask, search, jump, and act.
They must not replace Today, Inbox, Search, Graph, Objects, Documents, or Shared Spaces.

### Principle 5: Trust beats speed

Atlas can be fast, but it must first be auditable.
Every action suggestion needs source basis, risk, approval, and rollback behavior.

### Principle 6: Memory objects need editorial calm

Long notes, documents, people, projects, and decisions should feel readable.
The design should support reading and correction, not only scanning.

### Principle 7: Dense does not mean noisy

Density comes from alignment, information architecture, and useful rows.
Noise comes from competing colors, repeated badges, nested frames, and decorative metadata.

### Principle 8: Layout is a safety property

If text overlaps, clips, or hides source/risk/visibility, the UI can mislead the user.
Overflow is therefore part of the product trust model.

## Design Implications For The Next Slice

Build only Today plus inspector plus composer.
Use real Atlas memory fixture data, including long source names and low-confidence relations.
Show one primary action and one secondary inspection path.
Avoid all decorative cards and pills.
Use a field-list inspector.
Use a ledger/list center surface.
Represent sources as grounded objects, not colored badges.
Keep graph, inbox, and shared spaces out of the first high-fidelity slice.

