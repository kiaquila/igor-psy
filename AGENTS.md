# igor-psy

Static website for a private psychology practice. Pages and assets live in `public/`, and `wrangler.json` configures Cloudflare Workers routing. See the [README](README.md) and [development guide](docs/development.md) for checks and the pull request workflow.

## Working with agents

- The coordinator defines acceptance criteria, assigns an owner to each set of files, integrates changes, and owns the final PR.
- `site_implementer` edits assigned files. Assign non-overlapping paths for parallel edits. Use separate worktrees under `worktrees/<slug>` for independent changes. Assign each shared file to one agent at a time.
- `site_qa` and `site_reviewer` verify the integrated diff. QA reproduces user flows and runs Preflight. The reviewer reports specific regressions with a priority, file, and line number. Both report their findings to the coordinator and leave fixes to the implementer.
- Run `sh scripts/preflight.sh` before opening a PR. For interface changes, check the affected pages at mobile and desktop widths, navigate with the keyboard, and verify that the booking link opens Telegram with the message still unsent.
- After the final push, request Codex Review for the full SHA and wait for `Preflight` and `Codex Review` to pass. After fixes, repeat the checks for the new SHA.

## Code Review Rules

- Verify the booking flow from `/`, `/practice/`, and `/404.html`. The link must open `@CherkasovPsy` with a prefilled message. Flag missing recipients, missing message text, and links that keyboard users cannot reach.
- Preserve direct links to `/practice/` and its anchors, and preserve Cloudflare's 404 behavior. For markup changes, verify that navigation and the FAQ work with the keyboard.
- Flag any weakening of the review gate that allows it to accept a review from an untrusted author or for a different SHA, or allows a workflow with write access to GitHub Checks to run PR code.
