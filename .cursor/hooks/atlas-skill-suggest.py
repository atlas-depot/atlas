#!/usr/bin/env python3
"""Cursor prompt hook for Atlas.

This hook is intentionally advisory. If Cursor's hook output schema changes, it
fails open and the always-on `.cursor/rules` still preserve core invariants.
"""

import json
import sys

TRIGGERS = {
    "atlas-review": ["review", "pr review", "code review", "greptile", "bugbot"],
    "atlas-design": ["design", "ui", "figma", "tokens", "design system", "screenshot", "reference image"],
    "atlas-test": ["test", "lint", "typecheck", "e2e", "screenshot", "verify", "eval smoke"],
    "atlas-handoff": ["handoff", "fresh agent", "another agent", "devret", "first 30 minutes"],
    "atlas-pr": ["open pr", "create pr", "pull request", "pr body", "reviewable pr"],
    "atlas-babysit": ["babysit", "ci green", "until green", "preview deploy", "resolve comments"],
    "atlas-plan": ["plan", "implementation plan", "roadmap", "tasarla", "nasıl yap"],
    "atlas-implement": ["implement", "build", "fix", "uygula"],
    "atlas-create-skills": ["skill", "create skill", "hook", "populate skills"],
    "atlas-bootstrap": ["bootstrap", "scaffold", "initial repo", "phase 0", "mise", "docker compose", "seed db", "db:seed"],
    "atlas-owner-onboarding": ["owner", "what should i do", "ne yapmalıyım"],
    "atlas-deploy": ["deploy", "preview", "vercel", "production", "env", "secret", "provider", "temporal", "neon", "redis", "vault"],
}


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return

    raw = json.dumps(data).lower()
    matches = [name for name, triggers in TRIGGERS.items() if any(t in raw for t in triggers)]
    if not matches:
        return

    context = (
        "Atlas source-of-truth reminder: read AGENTS.md, docs/process/agent-alignment.md, docs/process/skill-taxonomy.md, "
        "docs/process/engineering-standards.md, docs/process/provider-and-env-setup.md, and docs/architecture/atlas-production-spec-and-plan.md before non-trivial work. "
        "Relevant project skills: "
        + ", ".join(f"/{m}" for m in matches[:4])
        + ". Escalate provider accounts, production secrets, OAuth compliance, real eval data, production domain, and final brand direction to Efe. Do not request Efe's personal account password, 2FA, or broad production access."
    )

    print(json.dumps({"additional_context": context}))


if __name__ == "__main__":
    main()
