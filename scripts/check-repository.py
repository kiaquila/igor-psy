import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = (
    ".codex/agents/site-implementer.toml",
    ".codex/agents/site-qa.toml",
    ".codex/agents/site-reviewer.toml",
    ".github/CODEOWNERS",
    ".github/dependabot.yml",
    ".github/pull_request_template.md",
    ".github/workflows/ci.yml",
    ".github/workflows/codex-review.yml",
    "AGENTS.md",
    "README.md",
    "delivery-baseline.json",
    "docs/development.md",
    "package.json",
    "package-lock.json",
    "scripts/check-repository.py",
    "scripts/check-site.py",
    "scripts/codex-native-receipt.mjs",
    "scripts/codex-review-gate.mjs",
    "scripts/codex-review-help.mjs",
    "scripts/codex-review-policy.mjs",
    "scripts/preflight.sh",
    "tests/codex-review.test.mjs",
    "tests/fixtures/native-codex-clean-replies.json",
    "wrangler.json",
)

invalid = []
for relative in REQUIRED:
    path = ROOT / relative
    if path.resolve() != path or not path.is_file() or path.stat().st_size == 0:
        invalid.append(relative)

if invalid:
    for relative in invalid:
        print(f"Required repository file missing, empty, or symlinked: {relative}", file=sys.stderr)
    sys.exit(1)

print(f"Repository checks passed ({len(REQUIRED)} required files).")
