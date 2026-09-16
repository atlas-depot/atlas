"""Check the pre-scaffold repository without installing application dependencies."""

from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = (
    "README.md", "AGENTS.md", "docs/product.md", "docs/architecture.md",
    "docs/development.md", "docs/contributing.md", "docs/security.md",
    "docs/project-log.md",
)
# Deliberately small Markdown subset: inline destinations and reference definitions.
LINK = re.compile(r'\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+"[^"\n]*")?\s*\)')
REFERENCE = re.compile(r'^\s*\[[^\]]+\]:\s*(<[^>]+>|\S+)', re.MULTILINE)


def check(root: Path) -> list[str]:
    errors = [f"Missing required file: {name}" for name in REQUIRED if not (root / name).is_file()]
    # Replace this guard with real Vite+ checks as part of the scaffold PR.
    manifests = [p for p in root.rglob("package.json") if not set(p.relative_to(root).parts) & {".git", "node_modules"}]
    if manifests:
        errors.append("Application manifest found: wire actual Vite+ lint/typecheck/test/build into CI and remove the pre-scaffold guard in the same PR.")

    files = [p for p in root.rglob("*.md") if not set(p.relative_to(root).parts) & {".git", "node_modules"}]
    for path in files:
        source = path.read_text(encoding="utf-8")
        # Examples inside fenced code blocks are not document links.
        source = re.sub(r'^([`~]{3,})[^\n]*\n.*?^\1\s*$', '', source, flags=re.MULTILINE | re.DOTALL)
        for match in list(LINK.finditer(source)) + list(REFERENCE.finditer(source)):
            destination = match.group(1).strip("<>")
            parsed = urlsplit(destination)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            target = (root if parsed.path.startswith("/") else path.parent) / unquote(parsed.path).lstrip("/")
            if not target.exists():
                errors.append(f"{path.relative_to(root)}: missing link target {destination}")

    skills = list((root / ".claude/skills").glob("*/SKILL.md"))
    if not skills:
        errors.append("No skill entrypoints found")
    for path in skills:
        source = path.read_text(encoding="utf-8")
        frontmatter = re.match(r'\A---\n(.*?)\n---(?:\n|$)', source, re.DOTALL)
        if not frontmatter:
            errors.append(f"{path.relative_to(root)}: missing frontmatter")
            continue
        fields = dict(re.findall(r'^(name|description):[ \t]*(.*)$', frontmatter.group(1), re.MULTILINE))
        if fields.get("name") != path.parent.name:
            errors.append(f"{path.relative_to(root)}: name must match directory")
        description = fields.get("description", "").strip()
        if not description or description in {"|", ">", "''", '""'}:
            errors.append(f"{path.relative_to(root)}: use a nonempty single-line description")
    return errors


if __name__ == "__main__":
    failures = check(ROOT)
    if failures:
        print("\n".join(failures), file=sys.stderr)
        sys.exit(1)
    print("Repository checks passed: required docs, local Markdown file links, skill metadata, pre-scaffold guard.")
