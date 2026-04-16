#!/bin/bash
set -euo pipefail

VERSION=${1:?"Usage: ./scripts/release.sh <version>"}

# Ensure we're in the plugin directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$PLUGIN_DIR/../.." && pwd)"

cd "$PLUGIN_DIR"

echo "📦 Releasing @agentxp/plugin v${VERSION}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Version bump
echo "→ Version bump to ${VERSION}..."
npm version "$VERSION" --no-git-tag-version

# 2. Build
echo "→ Building..."
npm run build

# 3. Typecheck
echo "→ Type checking..."
npm run typecheck

# 4. Test
echo "→ Running tests..."
npm run test

# 5. Publish
echo "→ Publishing to npm..."
npm publish --access public

# 6. Git tag
echo "→ Committing and tagging..."
cd "$REPO_ROOT"
git add .
git commit -m "release: @agentxp/plugin v${VERSION}"
git tag "plugin-v${VERSION}"
git push && git push --tags

echo ""
echo "✅ Published @agentxp/plugin v${VERSION}"
