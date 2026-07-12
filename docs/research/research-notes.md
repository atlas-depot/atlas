# Research Notes for Atlas Project Knowledge Pack

Checked on 2026-06-30 and refreshed on 2026-07-01 for onboarding, preview, and Vercel Services process decisions.

## Agent instruction and skill sources

- OpenAI Codex reads `AGENTS.md` files and layers global and project guidance. Source: https://developers.openai.com/codex/guides/agents-md
- Claude Code skills use `SKILL.md` files and are loaded only when relevant or invoked. Source: https://docs.anthropic.com/en/docs/claude-code/skills
- Claude Code memory files are context, not hard enforcement. Hooks are needed to block actions. Source: https://docs.anthropic.com/en/docs/claude-code/memory
- Agent Skills are an open folder format with `SKILL.md` plus optional scripts, references, and assets. Source: https://agentskills.io/home
- Cursor supports project rules and agent skills. Source: https://cursor.com/docs/rules and https://cursor.com/docs/skills

## GitHub process sources

- GitHub issue and PR templates standardize contributor input. Source: https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates
- GitHub PR templates can be stored in `.github/pull_request_template.md` or supported template directories. Source: https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository
- GitHub issue forms live in `.github/ISSUE_TEMPLATE/*.yml`. Source: https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository
- Branch protection can require PR reviews, status checks, conversation resolution, signed commits, linear history, deployments, and more. Source: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- CODEOWNERS automatically requests reviews and can be required by branch protection. Source: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners
- GitHub Actions supports Node.js CI workflows. Source: https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs
- pnpm documents GitHub Actions setup and caching. Source: https://pnpm.io/continuous-integration
- Vercel Git integration creates preview deployments for pushes and production deployments from the production branch. Source: https://vercel.com/docs/git
- Vercel CLI supports env management such as pulling project environment variables for local development; Atlas should still keep secret values out of Git. Source: https://vercel.com/docs/cli/env
- Vercel Services documents the `services` field for deploying multiple apps/services in one Vercel project, and the feature is beta. Source: https://vercel.com/docs/services
- Vercel Chat SDK is a framework for building chat interfaces across platforms; Atlas should use it for external chat surfaces only behind the same backend memory/permission layer. Source: https://vercel.com/chat and https://github.com/vercel/chat
- mise supports tool version management and task execution through project configuration. Source: https://mise.jdx.dev/configuration.html and https://mise.jdx.dev/tasks/
- Temporal documents a local development server path through the Temporal CLI; Atlas should keep Temporal behind `WorkflowPort` so local fake and cloud-backed modes can coexist. Source: https://docs.temporal.io/cli/server
- Neon supports database branches as isolated copies of a parent branch; Atlas can use Neon dev/preview branches while keeping Postgres canonical. Source: https://neon.com/docs/manage/branches
- 1Password CLI provides a possible future small-team secret-sharing workflow, but Atlas should not adopt it until recurring shared secret access is real. Source: https://developer.1password.com/docs/cli/
- Auth.js now states that the project is part of Better Auth; Atlas should not default to Auth.js without re-evaluating Better Auth. Source: https://authjs.dev/
- Clerk documents broad built-in authentication, user management, organization, session, security, and billing surfaces; Atlas may still reject Clerk when owning auth/permission/token lifecycle is more important. Source: https://clerk.com/docs
- Better Auth documents a TypeScript, framework-agnostic auth framework with plugins for 2FA, passkeys, organizations, multi-session, SSO, and more. Source: https://better-auth.com/docs/introduction
- Polar documents software billing and commerce features, but Atlas payment architecture should stay provider-neutral until a billing ADR chooses a provider. Source: https://polar.sh/docs/introduction
- Basis Theory documents multi-PSP, payment vault, Elements, proxy, network token, account updater, and 3DS capabilities; treat it as a credible research candidate for payment-provider independence, not an automatic dependency. Source: https://basistheory.com/solution/multi-psp
- Google Document AI documents OCR, layout, extraction, classification, processors, and document processing workflows; Atlas should evaluate it in the OCR bakeoff. Source: https://cloud.google.com/document-ai/docs/overview
- Azure Document Intelligence documents cloud document processing, read/layout models, prebuilt models, and version guidance; Atlas should evaluate it in the OCR bakeoff. Source: https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/overview
- GitHub CODEOWNERS can automatically request reviews from owners, and branch protection can require owner review. Source: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners
- `agent-browser` npm package exposes the `agent-browser` CLI for browser automation screenshots and snapshots. Checked via npm registry on 2026-07-01: package `agent-browser`, version `0.31.1`, bin `agent-browser`.

## Commit convention source

- Conventional Commits defines `<type>[optional scope]: <description>`, with `feat`, `fix`, and breaking change semantics. Source: https://www.conventionalcommits.org/en/v1.0.0/
