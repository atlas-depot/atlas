# Atlas UI Reference Audit (historical)

Status: historical. Not current required reading.
From the 2026-07-01 design reset pass.
Superseded by the 2026-07-16 warm-minimalism lock.
Current source of truth: `docs/design/atlas-design-tokens.md` for tokens, `docs/design/ui-rulebook.md` for rationale.
Palette, measurements, and dark-first conclusions in the original are dead. Do not use them.
Full original text: `git show 802adb2:docs/design/atlas-ui-reference-audit.md`.

## What this was

A survey of about 25 reference products and guidelines, run after the first static Atlas prototype was rejected.
The goal was never to copy a reference. It was to pull out mechanics that make a product feel precise, calm, and trustworthy in long work sessions.

## Borrow / reject digest

The digest is kept because the lock is one day old and the 28-screen redesign is about 4 screens in. If the direction wobbles, this is the material to reach for.

### Vercel Web Interface Guidelines
Borrow: important state should be addressable, recoverable, and keyboard-operable. Today filters, object selection, side sheets, graph filters, and inspector tabs should be URL-backed where possible.
Reject: monochrome developer-tool austerity without memory-specific warmth and provenance semantics.

### Vercel Interaction Details
Borrow: an action suggestion keeps its label while loading, shows an approval state when needed, and preserves user control. No AI action silently becomes a different state.
Reject: critical memory safety hidden behind tooltips. Inline explanation beats hover-only help.

### Vercel Layout Details
Borrow: every screen needs a specific overflow policy. Main content, inspector, document preview, graph canvas, and command palette must not create competing scroll zones.
Reject: a layout that only looks correct on one screenshot at one width.

### Vercel Content Details
Borrow: every empty state offers a next memory action. Every cited answer shows a source path and visibility state with accessible names.
Reject: visible labels for everything just because metadata exists. Accessible names can exist without a wall of labels.

### Geist Design System
Borrow: build a component inventory before visual scale expands. First Storybook: entity rows, source previews, inspector fields, approval bars, redacted states, command menu, table/list variants.
Reject: importing every component by default. Component abundance becomes visual abundance when ownership is weak.

### Geist Colors
Borrow: semantic color roles first: page, surface, surface raised, line, text, muted text, accent, warning, danger, success, focus, private, shared, redacted.
Reject: feeling like Vercel's brand. Atlas needs memory trust semantics, not deployment-console semantics.

### Geist Typography
Borrow: restrained type scale, tabular numerals for dates and counts, predictable line heights.
Reject: relying on a technical font to create taste. The rejected prototype proved type choice without composition still fails.

### Geist Grid
Borrow: the app shell aligns to a strict grid. Inspector fields, ledger rows, citations, and command surfaces line up across screens.
Reject: over-exposing grid visuals. Atlas is for memory work, not showing layout construction.

### Linear Method
Borrow: remove user-maintained organization work. Today shows what matters, what changed, and what needs approval without asking the user to manage the system.
Reject: overfitting into issue-tracker patterns. Memory objects are richer than issues.

### Linear Design Process
Borrow: verify the problem, explore several options, narrow with feedback before handoff. Produce directions first, pick one, then build one slice.
Reject: treating a bad prototype as almost done. The move is direction selection, not polishing.

### Linear Quality
Borrow: checklists stay strict, but the owner taste gate stays valid. If the UI feels bad, it is bad even with every box checked.
Reject: hiding behind measurable layout rules when the experience lacks taste.

### OpenAI Brand
Borrow: space around the important object. The selected memory object or primary action gets room to breathe.
Reject: decorative symbols, orbs, gradient artifacts, AI-coded visual noise.

### OpenAI Typography
Borrow: precise but not sterile. One strong sans family; editorial contrast reserved for long-form memory reading.
Reject: anonymous default typography in a product meant to feel trusted and intentional.

### ChatGPT Web App
Borrow: a persistent, calm composer that does not compete with Today, Inbox, Search, Graph, or Inspector.
Reject: chat-only Atlas. Memory work needs inspectable surfaces, not only a prompt.

### OpenAI Business Product Surface
Borrow: recognizable product nouns (Projects, Library, Scheduled, Chats, Agents) only when they map to real Atlas objects.
Reject: prompt suggestion chips as a buffet. Show a small number of context-aware actions.

### Notion Product
Borrow: object pages and database-like views that feel calm, editable, and durable. The user inspects memory without being trapped in an assistant transcript.
Reject: broad flexible blocks in the MVP. Atlas needs automatic structure and safety, not manual workspace assembly.

### Notion Enterprise Search
Borrow: search exposes evidence, source type, object type, visibility, and answerability.
Reject: claiming "source of truth" unless permissions, provenance, and citations are visible in the UI.

### Notion Calendar
Borrow: Today interleaves tasks, reminders, events, waiting-on items, and source changes in one work surface.
Reject: a calendar clone. Atlas is memory-driven priority, not time slots.

### Superhuman Mail
Borrow: Today and Inbox act like memory triage: needs action, waiting on, source review, safe drafts.
Reject: optimizing only for speed. Source trust comes before action speed.

### Superhuman AI
Borrow: the assistant metaphor of a system working beside the user. Atlas can suggest drafts, follow-ups, reminders, workflows.
Reject: automatic external sending in MVP. The UI must never imply an external write happened before approval.

### Superhuman Follow-Up
Borrow: waiting-on objects get first-class visual treatment in Today.
Reject: waiting-on state buried inside email threads. It should be a typed relation visible across memory.

### Obsidian Graph
Borrow: typed objects and typed relation edges. Clicking a node opens the inspector with evidence and visibility.
Reject: a decorative constellation. Graph must support filtering, evidence, correction, and permission-aware redaction.

### NN/g Usability Heuristics
Borrow: AI writes, ingestion progress, action approval, and permission redaction keep users informed. Undo and recovery matter as much as creation.
Reject: decorative badges standing in for system status. Status should be understandable and actionable.

### NN/g Aesthetic and Minimalist Design
Borrow: metadata is progressive. The default screen shows only what helps decide the next step.
Reject: showing all provenance, confidence, risk, counters, and shortcuts at once because they are all important.

### Cursor and Ryo Lu
Borrow: design artifacts map to real CSS tokens, real component APIs, and screenshot evidence.
Reject: generic AI-looking UI. If the output looks like a template generator made it, stop and restart.

## Durable lessons not covered by the lock

Layout is a safety property. If text overlaps, clips, or hides source, risk, or visibility, the UI misleads. Overflow policy is part of the product trust model, not a polish item.

Density is not noise. Density comes from alignment, information architecture, and useful rows. Noise comes from competing colors, repeated badges, nested frames, and decorative metadata.

Command is transit, not home. The palette and composer accelerate capture, ask, search, jump, and act. They do not replace Today, Inbox, Search, Graph, Objects, Documents, or Shared Spaces.

Prototype with real fixture data, including long source names and low-confidence relations.
