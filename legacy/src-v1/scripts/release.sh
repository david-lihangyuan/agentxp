#!/usr/bin/env bash
# AgentXP Release Script
# Usage: ./scripts/release.sh <patch|minor|major> "Release notes summary"
# Example: ./scripts/release.sh patch "fix key-renewer null safety"
# Example: ./scripts/release.sh minor "add diagnosis report and auto-distillation"

set -euo pipefail

SKILL_DIR="packages/skill"
PACKAGE_JSON="$SKILL_DIR/package.json"

# --- Args ---
BUMP_TYPE="${1:-}"
NOTES="${2:-}"

if [[ -z "$BUMP_TYPE" ]] || [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: ./scripts/release.sh <patch|minor|major> \"Release notes\""
  echo "  patch: 4.5.1 → 4.5.2 (bug fixes)"
  echo "  minor: 4.5.1 → 4.6.0 (new features)"
  echo "  major: 4.5.1 → 5.0.0 (breaking changes)"
  exit 1
fi

if [[ -z "$NOTES" ]]; then
  echo "Error: release notes required as second argument"
  exit 1
fi

# --- Check clean working tree ---
if [[ -n "$(git status --porcelain $SKILL_DIR)" ]]; then
  echo "Error: uncommitted changes in $SKILL_DIR. Commit or stash first."
  exit 1
fi

# --- Read current version ---
CURRENT=$(grep '"version"' "$PACKAGE_JSON" | head -1 | sed 's/.*"\([0-9]*\.[0-9]*\.[0-9]*\)".*/\1/')
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$BUMP_TYPE" in
  patch) PATCH=$((PATCH + 1)) ;;
  minor) MINOR=$((MINOR + 1)); PATCH=0 ;;
  major) MAJOR=$((MAJOR + 1)); MINOR=0; PATCH=0 ;;
esac

NEW_VERSION="$MAJOR.$MINOR.$PATCH"
TAG="v$NEW_VERSION"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  AgentXP Release: $CURRENT → $NEW_VERSION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# --- Step 1: Bump version ---
echo "[1/6] Bump version in package.json..."
sed -i '' "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" "$PACKAGE_JSON"

# --- Step 2: Build ---
echo "[2/6] TypeScript compile..."
(cd "$SKILL_DIR" && npx -p typescript tsc)

# --- Step 3: Test ---
echo "[3/6] Run tests..."
(cd "$SKILL_DIR" && npx vitest run --reporter=dot 2>&1 | tail -3)

# --- Step 4: npm publish ---
echo "[4/6] Publish to npm..."
if [[ ! -f ~/.npmrc ]] || ! grep -q "registry.npmjs.org" ~/.npmrc 2>/dev/null; then
  echo "Error: no npm auth found in ~/.npmrc"
  echo "Run: echo '//registry.npmjs.org/:_authToken=YOUR_TOKEN' > ~/.npmrc"
  # Revert version bump
  sed -i '' "s/\"version\": \"$NEW_VERSION\"/\"version\": \"$CURRENT\"/" "$PACKAGE_JSON"
  exit 1
fi
(cd "$SKILL_DIR" && npm publish 2>&1 | tail -3)

# --- Step 5: Git commit + tag ---
echo "[5/6] Git commit + tag..."
git add "$SKILL_DIR"
git commit -m "release(skill): $TAG — $NOTES"
git tag "$TAG"

# --- Step 6: Push + GitHub release ---
echo "[6/6] Push + create GitHub release..."
git push origin main
git push origin "$TAG"
gh release create "$TAG" --title "$TAG — $NOTES" --notes "## $TAG

$NOTES

### Install
\`\`\`
npm install @agentxp/skill
\`\`\`

Full changelog: v$CURRENT...$TAG"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Released @agentxp/skill@$NEW_VERSION"
echo ""
echo "  npm:    https://www.npmjs.com/package/@agentxp/skill"
echo "  GitHub: https://github.com/david-lihangyuan/agentxp/releases/tag/$TAG"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
