"""Configuration drift tests; these do not simulate GitHub accepting or denying a merge."""
import contextlib
from copy import deepcopy
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import check_governance as audit


def baseline(phase="steady"):
    conditions = {"ref_name": {"include": ["refs/heads/main"], "exclude": []}}
    owner = {"id": audit.OWNER_RULE, "target": "branch", "conditions": conditions, "enforcement": "active", "rules": [{"type": "update"}], "bypass_actors": [{"actor_id": audit.MERGE_TEAM, "actor_type": "Team", "bypass_mode": "pull_request"}]}
    review = {"id": audit.REVIEW_RULE, "target": "branch", "conditions": conditions, "enforcement": "active", "bypass_actors": [], "rules": [{"type": "deletion"}, {"type": "non_fast_forward"}, {"type": "pull_request", "parameters": {"required_approving_review_count": 1, "dismiss_stale_reviews_on_push": True, "require_code_owner_review": phase == "steady"}}]}
    return {"repository": audit.REPO, "repo": {"default_branch": "main"}, "classic_protection": None, "rulesets": [owner, review], "effective_rules": [{**r, "ruleset_id": rule["id"], "ruleset_source_type": "Repository", "ruleset_source": audit.REPO} for rule in (owner, review) for r in rule["rules"]], "merge_members": [{"login": "EfeDurmaz16", "id": 75971010}], "review_members": [{"login": name} for name in audit.REVIEWERS], "teams": [{"id": audit.MERGE_TEAM, "slug": "atlas-merge", "permissions": {"push": True}}, {"id": audit.REVIEW_TEAM, "slug": "atlas-reviewers", "permissions": {"push": True}}], "codeowners": "* @atlas-depot/atlas-reviewers" if phase == "steady" else "* @EfeDurmaz16"}


class GovernanceTests(unittest.TestCase):
    def test_explicit_phases(self):
        for phase in ("bootstrap", "steady"):
            self.assertTrue(all(c["ok"] for c in audit.evaluate(baseline(phase), phase)))
        self.assertFalse(all(c["ok"] for c in audit.evaluate(baseline("bootstrap"), "steady")))

    def test_policy_drift_is_rejected(self):
        cases = {
            "broad bypass": lambda s: s["rulesets"][0]["bypass_actors"][0].update(bypass_mode="always"),
            "extra bypass": lambda s: s["rulesets"][0]["bypass_actors"].append({"actor_id": 1, "actor_type": "Integration", "bypass_mode": "always"}),
            "account substitution": lambda s: s["merge_members"][0].update(id=1),
            "extra merge member": lambda s: s["merge_members"].append({"login": "another-user", "id": 1}),
            "disabled": lambda s: s["rulesets"][0].update(enforcement="disabled"),
            "wrong branch": lambda s: s["rulesets"][0].update(conditions={"ref_name": {"include": ["refs/heads/dev"], "exclude": []}}),
            "review bypass": lambda s: s["rulesets"][1]["bypass_actors"].append({"actor_id": audit.MERGE_TEAM, "actor_type": "Team", "bypass_mode": "always"}),
            "no approval": lambda s: s["rulesets"][1]["rules"][2]["parameters"].update(required_approving_review_count=0),
            "stale review retained": lambda s: s["rulesets"][1]["rules"][2]["parameters"].update(dismiss_stale_reviews_on_push=False),
            "unexpected ruleset": lambda s: s["rulesets"].append({"id": 99, "rules": []}),
            "unexpected effective rule": lambda s: s["effective_rules"].append({"type": "required_signatures", "ruleset_id": 99}),
            "uninspected classic rule": lambda s: s.update(classic_protection={"required_pull_request_reviews": {}}),
            "team loses write": lambda s: s["teams"][1]["permissions"].update(push=False),
            "default branch changed": lambda s: s["repo"].update(default_branch="dev"),
            "narrow CODEOWNER override": lambda s: s.update(codeowners="* @atlas-depot/atlas-reviewers\n/scripts/ @outsider"),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                snapshot = deepcopy(baseline())
                mutate(snapshot)
                self.assertFalse(all(c["ok"] for c in audit.evaluate(snapshot, "steady")))

    def test_malformed_scalar_types_do_not_pass(self):
        snapshot = baseline()
        parameters = snapshot["rulesets"][1]["rules"][2]["parameters"]
        parameters.update(required_approving_review_count=True,
                          dismiss_stale_reviews_on_push=1,
                          require_code_owner_review=1)
        failed = {c["check"] for c in audit.evaluate(snapshot, "steady") if not c["ok"]}
        self.assertTrue({"one approval", "dismiss stale approvals", "CODEOWNER enforcement for phase"} <= failed)

    def test_missing_fields_are_incomplete(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "snapshot.json"
            source.write_text("{}")
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(audit.main(["--snapshot", str(source)]), 2)
            self.assertEqual(json.loads(output.getvalue())["status"], "incomplete")

    def test_unavailable_api_never_passes(self):
        with patch.object(audit, "collect", side_effect=RuntimeError("GET unavailable")):
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(audit.main([]), 2)
            self.assertEqual(json.loads(output.getvalue())["status"], "incomplete")

    def test_only_known_absent_classic_protection_is_allowed(self):
        for message, accepted in (("Branch not protected", True), ("Not Found", False)):
            result = subprocess.CompletedProcess([], 1, json.dumps({"status": "404", "message": message}), "")
            with patch.object(audit.subprocess, "run", return_value=result):
                if accepted:
                    self.assertIsNone(audit.get("endpoint", missing_protection=True))
                else:
                    with self.assertRaises(RuntimeError):
                        audit.get("endpoint", missing_protection=True)

    def test_pagination_and_read_only_method(self):
        result = subprocess.CompletedProcess([], 0, '[[{"login":"one"}],[{"login":"two"}]]', "")
        with patch.object(audit.subprocess, "run", return_value=result) as run:
            self.assertEqual(len(audit.get("endpoint", many=True)), 2)
            self.assertEqual(run.call_args.args[0], ["gh", "api", "--method", "GET", "endpoint", "--paginate", "--slurp"])


if __name__ == "__main__":
    unittest.main()
