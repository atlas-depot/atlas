# PR Review Rubric

Reviewers must check these areas before approval.

## Scope

- Is the PR linked to an issue?
- Is the PR small enough?
- Are unrelated changes removed?

## Correctness

- Does the implementation match acceptance criteria?
- Are edge cases handled?
- Are errors represented clearly?

## Architecture

- Does the code respect domain boundaries?
- Are adapters used for external providers?
- Does a fake/local provider path exist for ordinary development?
- Is business logic outside UI components?
- Is there any architecture drift requiring ADR?

## Security and privacy

- Are permissions enforced server-side?
- Could private memory leak through search, graph, chat, summaries, logs, or shared spaces?
- Are secrets protected?
- Are provider/env changes reflected in `.env.example`, provider docs, and doctor/env checks?
- Does the PR avoid requiring personal account passwords, 2FA, broad dashboard access, or production secrets for review?
- If the PR touches production behavior, can it be tested through normal/test-user sessions instead of local production secrets?

## AI behavior

- Is retrieval permission-filtered?
- Are answers grounded when using memory?
- Are structured outputs validated?
- Are risky actions gated by approval?

## Tests

- Are tests meaningful?
- Are failure cases covered?
- Did CI pass?

## Senior project quality

- Can the author explain the work?
- Does the PR include what, why, how, tests, risks, and learning summary?
