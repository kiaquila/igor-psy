# Verify Codex Review publication on GitHub

Local tests cover review policy and status publication. This procedure also checks that GitHub branch protection consumes the published status after a new Actions suite is created for the same PR head.

## Prerequisites

- Use a real, ready-for-review PR targeting `main`, with a meaningful change and an up-to-date base.
- Run the procedure after the commit-status publisher is deployed on `main`. The privileged gate always executes trusted `main` code, so changing its implementation in the PR being tested does not deploy it.
- Keep `Preflight` and `Codex Review` required from GitHub Actions, with strict status checks enabled. Do not post statuses manually or bypass protection.

## Regression procedure

1. Record the full PR head SHA. Post `@codex review <full SHA>` as a fresh standalone comment from a repository owner, member, or collaborator.
2. Wait for Preflight and native Codex Review. Check that the `Codex Review` commit status on the recorded SHA is `success`, its creator is `github-actions[bot]`, and the PR reports `CLEAN`. Resolve any review findings before continuing.
3. Edit the PR description. This creates another `pull_request_target` run and suite without changing the head SHA. Wait for its evaluation to finish.
4. Verify that the head SHA is unchanged, `Codex Review` is still a successful commit status, the newer Actions suite contains the evaluator job, and protection still reports `CLEAN`.
5. Post `/codex-check` from an authorized account. Wait for a fresh `pending` then final `success` status on that same SHA. Repeat with the manual **Codex review gate** workflow and the PR number.
6. Confirm that no custom check named `Codex Review` was created on this fresh head. The evaluator job is informational; the required review result is a commit status.
7. Compare branch protection with the original configuration: the two required contexts, their GitHub Actions app binding, and strict checks must be unchanged. Verify there are no unresolved review threads before merging.

Use `gh pr view <number> --json headRefOid,mergeStateStatus,statusCheckRollup` for PR state. The REST endpoints `/repos/<owner>/<repo>/commits/<SHA>/statuses`, `/commits/<SHA>/check-runs`, and `/branches/main/protection/required_status_checks` expose the status history, check runs, and protection configuration respectively.

## The original failure

On PR #12, head `3c849df3522a3bb56d967ff70231fdb5d439d921` had successful native review evidence. All custom review check runs were assigned to suite `120672581222`, including checks created after the PR description was edited and after `/codex-check`. The edit created target-event suite `120674078566`, which contained only `Evaluate Codex evidence`. GitHub rejected a normal merge with `Required status check "Codex Review" is expected` despite showing green check runs on the head.

This is evidence of a publication and suite-association problem, rather than an invalid review or a wrong SHA. Publishing a commit status avoids selecting a check suite: reevaluation updates the same SHA/context pair. See [GitHub's Checks API guide](https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks) and [commit statuses API](https://docs.github.com/en/rest/commits/statuses).

If an existing SHA has both a custom check and a commit status named `Codex Review`, GitHub [requires both to pass](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks). Inspect both during migration. Do not create an empty commit as a routine recovery step.
