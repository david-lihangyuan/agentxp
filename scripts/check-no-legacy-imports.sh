#!/usr/bin/env bash
# Enforce: no file under packages/ may import from legacy/.
# See .augment/rules/project.md §2 and docs/MILESTONES.md M0 check 3.
# Directory layout set by ADR-005 (flatten to repo-root packages/).
set -euo pipefail

if [ ! -d packages ]; then
  echo "ok: packages/ does not exist yet, nothing to check"
  exit 0
fi

# Match any `from '...legacy...'` or `from "...legacy..."` import
# specifier inside packages/. The pattern intentionally mirrors the
# milestone's grep command verbatim.
matches=$(grep -rnE "from ['\"][^'\"]*legacy" packages/ || true)

if [ -n "$matches" ]; then
  echo "ERROR: packages/ imports from legacy/ detected:" >&2
  echo "$matches" >&2
  exit 1
fi

echo "ok: no packages/ -> legacy/ imports found"
