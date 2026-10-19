# Deterministic merge governance

GitHub rules enforce merge eligibility. Agent instructions explain the workflow; the local audit detects configuration drift and does not grant or deny a merge itself.

## Two independent gates

| Gate | Intended GitHub enforcement |
| --- | --- |
| Who may update main | Active `Owner-controlled merges` ruleset, `update` restriction on `refs/heads/main`, with only the `atlas-merge` team allowed to bypass through a PR |
| What must be reviewed | Separate active `Main review requirements` ruleset with no bypass actors, one approving review, stale approval dismissal, deletion and force-push protection |
| Who is in the merge team | Complete `atlas-merge` membership is exactly `EfeDurmaz16` |
| Final CODEOWNER review | Team ownership on main and mandatory CODEOWNER approval after the bootstrap transition |

Restrict updates deliberately blocks ordinary updates even when a PR has approval and successful checks. GitHub can present a bypass control to the permitted merge actor. That exception applies to its own ruleset; it does not bypass the separate review ruleset. Do not remove the update restriction just to clear the UI, and do not add the merge team to the review ruleset's bypass list.

`always` is broader than the intended `pull_request` bypass mode. Changing this mode narrows the exception; it is not a promise that GitHub removes its bypass checkbox. Any settings change requires authorization and verification of the resulting API state.

## Audit the live configuration

Run from the repository with Python 3 and an authenticated `gh` that can read rules and team membership:

```sh
python3 scripts/check_governance.py --phase bootstrap
```

Bootstrap is only for the period before the team CODEOWNERS file has landed on main. It expects the temporary owner and no mandatory CODEOWNER check. After that file lands and CODEOWNER enforcement is enabled, use the default steady phase:

```sh
python3 scripts/check_governance.py
```

The audit checks API state and complete team membership. Failed reads, unknown configuration and policy mismatches must not become a pass. It uses read-only requests and never changes settings, creates a check run, posts a review or merges. A successful audit is configuration evidence, not an executed unauthorized-merge test or a readiness verdict for a particular PR. A stored snapshot is historical evidence, not current enforcement.

For a particular PR, separately inspect its actual head, current review decision and required checks. New commits can dismiss earlier approval. Advisory bot successes are not required CI unless GitHub actually requires those check names. Introduce real CI requirements with the relevant workflow, not invented names.

## Identity boundary

The accepted boundary is the Efe GitHub account, including an authorized agent acting with that account. It is not a physical-human check: GitHub cannot distinguish Efe at the keyboard from an agent using Efe's credentials. A future human-only policy would require separate automation credentials without merge authority. Account capability still does not authorize an agent to merge an arbitrary PR without a user request.

Organization owners can administer rules and team membership. This audit detects drift when run; it cannot prevent an administrator changing the policy or prove that a credential was used by its human owner. Keep those limits explicit when reporting protection.

References: [rule types](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets), [bypass configuration](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository), [rule layering](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets), [token capabilities](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
