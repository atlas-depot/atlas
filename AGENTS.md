# Atlas agent instructions

Atlas helps people recover scattered context, keep notes, and act through a personal AI assistant.
This repository is currently a planning baseline, not a runnable application.

## Decisions and scope

Current user instructions take precedence over these files.
Read `docs/product.md` for product scope and `docs/architecture.md` for accepted constraints versus team proposals when the task changes either.
UI direction and unresolved backend choices require team discussion; existing prototypes are historical references, not implementation contracts.
Do not promote an example, candidate library, or previous proposal into an accepted decision.

## Working here

- Inspect the current branch and working-tree changes before editing; preserve other people's work.
- Use English for code, repository documents, and commits.
- Keep each change reviewable; use atomic Conventional Commits without agent co-author footers.
- Use plain hyphens rather than em dash characters in repository text.
- Vite+ is the selected development toolchain. Read actual manifests for commands and version pins once the scaffold exists; do not invent successful checks for missing code.
- Add a dependency or package only for a concrete consumer or capability. Consult current primary documentation before integrations.
- Keep proposed architecture separate from implemented behavior in reports.

## Product boundaries

- Compose ready-made UI components; do not author custom UI primitives, SVG icons, or emoji UI. Use an approved icon library other than lucide-react.
- Keep user-authored notes distinguishable from model-generated content and preserve source provenance.
- Enforce account and data access on the server. Connector credentials stay outside model context, logs, and analysis sandboxes.
- External sends, calendar changes, destructive operations, and binding actions require user approval under the agreed action policy.
- Approval and durable execution do not guarantee exactly-once external effects; handle retries and uncertain provider outcomes explicitly.
- Use sandboxes on demand for bounded script, conversion, and analysis work. Persist important outputs outside disposable compute.
- Production secrets, destructive data operations, and live deployments require explicit authorization. Repository instructions do not grant it.

Read `docs/security.md` when changing identity, connectors, memory access, external actions, or sandbox capabilities.
Read `docs/development.md` when changing local setup, environment handling, or deployment configuration.

## Contribution and verification

The target flow is feature branch to `dev`, then a reviewed release from `dev` to `main`; read `docs/contributing.md` for merge semantics and current setup gaps.
Issues coordinate assigned work; a small clear fix can go directly to a PR.
Use Why / What / How / Test in PR bodies, normally within 100 words. Add visual evidence or material risk only when relevant.
Run checks relevant to the changed behavior and report their actual results. For visible UI changes, verify mobile and desktop and provide before/after evidence.
Keep individual contribution, AI assistance, and demonstration evidence in `docs/project-log.md`, not repeated in every PR body.

## Skills

Use a skill under `.claude/skills/` only when its description matches the task.
Read its entrypoint first and load conditional references only when needed.
A skill must contribute a specific procedure, non-obvious constraint, or useful verification contract; generic advice and copied project rules do not justify another skill.
When shortening a skill, preserve its operational conditions and test uncertain behavior changes with representative tasks.
