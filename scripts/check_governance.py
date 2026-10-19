#!/usr/bin/env python3
"""Read-only Atlas ruleset audit. A pass checks configuration, not human intent or merge readiness."""
import argparse
import base64
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys

REPO = "atlas-depot/atlas"
OWNER_RULE = 23586521
REVIEW_RULE = 24120292
MERGE_TEAM = 19760514
REVIEW_TEAM = 19760511
REVIEWERS = {"EfeDurmaz16", "TalhaNALBANT", "iklimozbey", "onatozmenn", "alitariksen"}


def get(endpoint, many=False, missing_protection=False):
    command = ["gh", "api", "--method", "GET", endpoint]
    if many:
        command += ["--paginate", "--slurp"]
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=30)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"GET {endpoint} timed out") from error
    if result.returncode:
        try:
            error = json.loads(result.stdout)
        except json.JSONDecodeError:
            error = {}
        if missing_protection and error.get("status") == "404" and error.get("message") == "Branch not protected":
            return None
        # Do not emit raw gh diagnostics, which may contain local credential context.
        raise RuntimeError(f"GET {endpoint} failed (gh exit {result.returncode})")
    value = json.loads(result.stdout)
    if many:
        if not isinstance(value, list) or any(not isinstance(page, list) for page in value):
            raise ValueError(f"Unexpected paginated response: {endpoint}")
        return [item for page in value for item in page]
    return value


def collect():
    root = f"repos/{REPO}"
    catalog = get(f"{root}/rulesets?includes_parents=true&per_page=100", many=True)
    return {
        "repository": REPO,
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "repo": get(root),
        "rulesets": [get(f"{root}/rulesets/{item['id']}") for item in catalog],
        "effective_rules": get(f"{root}/rules/branches/main?per_page=100", many=True),
        "classic_protection": get(f"{root}/branches/main/protection", missing_protection=True),
        "teams": get(f"{root}/teams?per_page=100", many=True),
        "merge_members": get("orgs/atlas-depot/teams/atlas-merge/members?per_page=100", many=True),
        "review_members": get("orgs/atlas-depot/teams/atlas-reviewers/members?per_page=100", many=True),
        "codeowners": base64.b64decode(get(f"{root}/contents/.github/CODEOWNERS?ref=main")["content"]).decode(),
    }


def evaluate(snapshot, phase):
    checks = []

    def expect(name, actual, expected):
        checks.append({"check": name, "ok": json.dumps(actual, sort_keys=True, allow_nan=False) == json.dumps(expected, sort_keys=True, allow_nan=False), "actual": actual, "expected": expected})

    expect("repository", snapshot["repository"], REPO)
    expect("default branch", snapshot["repo"]["default_branch"], "main")
    expect("classic protection (unexpected layer requires review)", snapshot["classic_protection"], None)
    rules = snapshot["rulesets"]
    expect("ruleset inventory including inherited layers", sorted(r["id"] for r in rules), sorted([OWNER_RULE, REVIEW_RULE]))
    by_id = {r["id"]: r for r in rules}
    for identifier in (OWNER_RULE, REVIEW_RULE):
        rule = by_id[identifier]
        prefix = f"ruleset {identifier}"
        expect(f"{prefix} enforcement", rule["enforcement"], "active")
        expect(f"{prefix} target", rule["target"], "branch")
        expect(f"{prefix} conditions", rule["conditions"], {"ref_name": {"include": ["refs/heads/main"], "exclude": []}})
    owner, review = by_id[OWNER_RULE], by_id[REVIEW_RULE]
    expect("owner restriction", owner["rules"], [{"type": "update"}])
    expect("PR-only merge bypass", owner["bypass_actors"], [{"actor_id": MERGE_TEAM, "actor_type": "Team", "bypass_mode": "pull_request"}])
    expect("review has no bypass", review["bypass_actors"], [])
    expect("review rule types", sorted(r["type"] for r in review["rules"]), ["deletion", "non_fast_forward", "pull_request"])
    parameters = next(r["parameters"] for r in review["rules"] if r["type"] == "pull_request")
    expect("one approval", parameters["required_approving_review_count"], 1)
    expect("dismiss stale approvals", parameters["dismiss_stale_reviews_on_push"], True)
    expect("CODEOWNER enforcement for phase", parameters["require_code_owner_review"], phase == "steady")
    expected_effective = []
    for rule in rules:
        for entry in rule["rules"]:
            expected_effective.append({**entry, "ruleset_id": rule["id"], "ruleset_source_type": "Repository", "ruleset_source": REPO})
    canonical = lambda values: sorted(json.dumps(item, sort_keys=True) for item in values)
    expect("effective rules match inspected layers", canonical(snapshot["effective_rules"]), canonical(expected_effective))
    expect("merge team members", sorted(m["login"] for m in snapshot["merge_members"]), ["EfeDurmaz16"])
    expect("merge account identity", sorted(m["id"] for m in snapshot["merge_members"]), [75971010])
    expect("review team members", sorted(m["login"] for m in snapshot["review_members"]), sorted(REVIEWERS))
    teams = {t["id"]: t for t in snapshot["teams"]}
    for identifier, slug in ((MERGE_TEAM, "atlas-merge"), (REVIEW_TEAM, "atlas-reviewers")):
        expect(f"team {identifier} slug", teams[identifier]["slug"], slug)
        expect(f"team {slug} has repository write access", teams[identifier]["permissions"]["push"], True)
    owner_lines = [line.strip() for line in snapshot["codeowners"].splitlines() if line.strip() and not line.lstrip().startswith("#")]
    expected_owner = "* @atlas-depot/atlas-reviewers" if phase == "steady" else "* @EfeDurmaz16"
    expect("base-branch CODEOWNERS for phase", owner_lines, [expected_owner])
    return checks


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--phase", choices=("bootstrap", "steady"), default="steady", help="bootstrap permits the temporary sole CODEOWNER before PR #16 lands")
    parser.add_argument("--snapshot", type=Path, help="evaluate a previously captured snapshot, without network")
    parser.add_argument("--save-snapshot", type=Path, help="save collected read-only evidence, not credentials")
    args = parser.parse_args(argv)
    try:
        snapshot = json.loads(args.snapshot.read_text()) if args.snapshot else collect()
        if args.save_snapshot:
            args.save_snapshot.write_text(json.dumps(snapshot, indent=2) + "\n")
        checks = evaluate(snapshot, args.phase)
        passed = all(c["ok"] for c in checks)
        print(json.dumps({"status": "pass" if passed else "fail", "phase": args.phase, "source": "snapshot" if args.snapshot else "live", "collected_at": snapshot.get("collected_at"), "checks": checks}, indent=2))
        return 0 if passed else 1
    except (OSError, ValueError, KeyError, TypeError, StopIteration, RuntimeError) as error:
        print(json.dumps({"status": "incomplete", "error": str(error)}))
        return 2


if __name__ == "__main__":
    sys.exit(main())
