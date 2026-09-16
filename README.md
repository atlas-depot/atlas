# Atlas

A personal assistant for scattered context: user-written notes, connected sources, useful memory, and approved actions through chat.

## Current status

Planning baseline for a five-person school project due at the end of April 2027.
There is no application scaffold, package manifest, or runnable app yet.
Vite+ is selected for development tooling; eve is the agent-runtime direction to validate.
UI direction and remaining backend choices will be reviewed with the team before they become implementation contracts.

## Read what you need

- [Product](docs/product.md): intended use, scope, and decisions still open.
- [Architecture](docs/architecture.md): responsibility boundaries and candidate implementation.
- [Development](docs/development.md): local setup, environments, and current infrastructure gaps.
- [Contributing](docs/contributing.md): small PRs and the intended dev/main release flow.
- [Security](docs/security.md): identity, connected accounts, memory, and external actions.
- [Project log](docs/project-log.md): individual contribution and academic evidence.

Older design prototypes under `docs/prototypes/` are historical experiments, not the selected UI.
Use Git history for superseded plans rather than treating them as current requirements.

## Start development

Application setup commands will be added with the first working scaffold and tested before being documented here.
Run `python3 scripts/check-repository.py` for the current repository checks. CI runs the same checks; the scaffold PR must add real Vite+ lint, typecheck, test, and build checks.
Feature PRs target `dev`; releases go from `dev` to `main`. Vercel project linkage and deployments still need separate configuration and verification.

Agents start with [AGENTS.md](AGENTS.md).
