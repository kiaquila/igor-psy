#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

python3 scripts/check-repository.py
python3 scripts/check-site.py
node --test tests/*.test.mjs
