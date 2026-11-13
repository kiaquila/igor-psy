# Development and pull request checks

## Working with multiple agents

Start the Codex task from the root of the trusted project. Codex loads agent roles from `.codex/agents/`. You can give the coordinator a request like this.

> Implement the requested change. Delegate implementation to `site_implementer` and assign specific files. After integration, run `site_qa` and `site_reviewer` in parallel on the same SHA. Fix confirmed issues, rerun affected checks, and prepare the PR.

The coordinator checks the final diff, test results, and any remaining limitations. The local reviewer checks the diff before publication, and the native Codex integration reviews the published PR.

## Checks

| Check | When it runs | What it checks |
| --- | --- | --- |
| `Preflight` | PRs targeting `main` and pushes to `main` | Required repository files, pages, anchors, assets, Telegram booking, static routes, estimated load times against the baseline, and Codex Review policy tests. On GitHub, it also checks the PR diff, scans `package-lock.json` with OSV, and runs Wrangler with `--dry-run`. |
| `Codex Review` | PRs targeting `main`, review requests, bot comments, or manual runs | The native Codex result for the current SHA and any blocking findings. |

The local command requires Python 3.9+ and Node.js 22+.

```sh
sh scripts/preflight.sh
```

You can also run `actionlint` to check workflows. For visual changes, record which pages and viewport sizes you checked in the PR. Preflight checks files and links locally. To verify browser behavior, follow the local preview steps in the README.

## Page load baseline

Preflight compares estimated time to first render and full load for each page with `delivery-baseline.json`. The model uses individual response sizes (gzip for text), a connection speed of 1,600 kbps, 150 ms per network round trip, and extra round trips for assets discovered in CSS. It includes both font files referenced by the CSS. This gives a reproducible estimate for local static assets. Browser and production measurements depend on the actual connection.

An increase of more than 3% fails Preflight. The output lists assets that grew. If you expect the increase, update the baseline in the same PR, check the diff, and explain it in the PR description.

```sh
python3 scripts/check-site.py --update-delivery-baseline
```

## Dependency updates

Dependabot checks GitHub Actions and npm weekly. It groups minor and patch updates by ecosystem and opens separate PRs for major updates. The npm dependency tree includes Wrangler and its transitive dependencies. OSV scans the full locked tree, including development tools.

Dependabot PRs use the same checks. A repository owner, member, or collaborator requests Codex Review for the current SHA.

## Codex Review

1. Get the full SHA of the current PR with `gh pr view <number> --json headRefOid -q .headRefOid`.
2. Post `@codex review <full SHA>` as a standalone comment from a repository owner, member, or collaborator.
3. The gate waits for a formal approval or a bot reply that identifies the reviewed commit and reports no findings. Trusted results must follow the latest request for that SHA. A thumbs-up reaction or a completion notification alone leaves the check failing.
4. Fix P0–P2 findings and address open Codex threads, including threads on outdated lines. After pushing, request a review for the new SHA. After resolving threads, you can post `/codex-check` to recheck the existing results.

The gate polls GitHub for up to five minutes. New or edited bot comments trigger another check. If a formal review arrives later without a separate comment, post `/codex-check` or run **Codex review gate** in Actions with the PR number.

The workflow with write access to Checks runs code from `main` and publishes the result on the SHA returned by the GitHub API. Branch protection requires passing `Preflight` and `Codex Review` checks from GitHub Actions and an up-to-date PR base.

The native response formats come from the [review receipts in `kiaquila/ks`](https://github.com/kiaquila/ks/blob/main/docs/native-codex-receipts.md). The integration setup and review rules are in the [OpenAI docs](https://learn.chatgpt.com/docs/third-party/github).
