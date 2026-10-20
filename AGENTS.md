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

Read `docs/contributing.md` before issue, branch, PR or review work. It owns assignment, parallel work, evidence requirements and merge authority. Read `docs/development.md` for programming and test conventions. Report actual verification, not intended checks.

## Skills

Use a skill under `.agents/skills/` only when its description matches the task.
Read its entrypoint first and load conditional references only when needed.
A skill must contribute a specific procedure, non-obvious constraint, or useful verification contract; generic advice and copied project rules do not justify another skill.
Keep team policy in its canonical document; link to it from skills. Check materially changed skill procedures on representative tasks.
