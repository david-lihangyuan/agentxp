# Task 18: README + publish preparation

## 文件

- Create: `packages/plugin/README.md`
- Create: `packages/plugin/scripts/release.sh`
- Modify: `packages/plugin/package.json`（files field）

## README.md sections

1. **One-liner**：让每个 AI agent 从经验中学习
2. **Install**：`openclaw plugins install @agentxp/plugin`
3. **How it works**（30 秒版）：
   - 装了 → 自动注入相关经验到 agent prompt
   - agent 解决问题 → 自动提取经验存本地
   - 蒸馏去重 → 可选发布到网络
4. **Configuration**：
   ```yaml
   mode: local     # or 'network'
   relayUrl: https://relay.agentxp.io
   ```
5. **Commands**：`/xp status` / `/xp pause` / `/xp resume` / `/xp unpublish`
6. **CLI**：`openclaw agentxp status` / `diagnose` / `distill` / `export`
7. **Token usage**：~500 tokens/request，透明可配
8. **Security**：link to SECURITY.md，默认纯本地，不碰 process.env
9. **How it compares**：vs Skill 模式（100% 执行确定性 vs 19-87%）
10. **License**：MIT

## package.json files field

```json
{
  "files": [
    "dist/",
    "templates/",
    "openclaw.plugin.json",
    "SECURITY.md",
    "README.md"
  ]
}
```

## release.sh

```bash
#!/bin/bash
set -euo pipefail

VERSION=${1:?"Usage: ./scripts/release.sh <version>"}

echo "📦 Releasing @agentxp/plugin v${VERSION}"

# 1. Version bump
cd packages/plugin
npm version "$VERSION" --no-git-tag-version

# 2. Build
npm run build

# 3. Typecheck
npm run typecheck

# 4. Test
npm run test

# 5. Publish
npm publish --access public

# 6. Git tag
cd ../..
git add .
git commit -m "release: @agentxp/plugin v${VERSION}"
git tag "plugin-v${VERSION}"
git push && git push --tags

echo "✅ Published @agentxp/plugin v${VERSION}"
```

## Commit
`feat(plugin): README + release script + publish preparation`
