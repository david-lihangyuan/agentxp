#!/usr/bin/env bash
# Serendip 反思框架 — AGENTS.md 注入脚本
# 用法: bash install.sh [workspace_path]
#
# 行为:
#   1. 检测 AGENTS.md 是否存在，不存在则创建
#   2. 检测是否已注入（通过 SERENDIP_REFLECTION_START 标记）
#   3. 未注入则追加模板；已注入则更新（替换标记之间的内容）
#   4. 创建 memory/reflections/ 目录

set -euo pipefail

WORKSPACE="${1:-$(pwd)}"
AGENTS_FILE="$WORKSPACE/AGENTS.md"
REFLECTIONS_DIR="$WORKSPACE/memory/reflections"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/../templates/agents-inject.md"

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 检查模板
if [[ ! -f "$TEMPLATE" ]]; then
  echo "❌ 模板文件不存在: $TEMPLATE"
  exit 1
fi

# 创建反思目录
mkdir -p "$REFLECTIONS_DIR"
echo -e "${GREEN}✅${NC} 反思目录: $REFLECTIONS_DIR"

# 检查 AGENTS.md
if [[ ! -f "$AGENTS_FILE" ]]; then
  echo "# AGENTS.md" > "$AGENTS_FILE"
  echo -e "${YELLOW}📝${NC} 创建了 AGENTS.md"
fi

# 检查是否已注入
START_MARKER="<!-- SERENDIP_REFLECTION_START -->"
END_MARKER="<!-- SERENDIP_REFLECTION_END -->"

if grep -q "$START_MARKER" "$AGENTS_FILE"; then
  # 已存在 → 替换（用 sed 删除旧块，追加新块）
  # 获取起始行和结束行
  START_LINE=$(grep -n "$START_MARKER" "$AGENTS_FILE" | head -1 | cut -d: -f1)
  END_LINE=$(grep -n "$END_MARKER" "$AGENTS_FILE" | head -1 | cut -d: -f1)

  if [[ -n "$START_LINE" && -n "$END_LINE" && "$END_LINE" -ge "$START_LINE" ]]; then
    # 删除旧块
    sed -i.bak "${START_LINE},${END_LINE}d" "$AGENTS_FILE"
    rm -f "${AGENTS_FILE}.bak"

    # 在原位置插入新模板
    # 先分割文件
    head -n "$((START_LINE - 1))" "$AGENTS_FILE" > "${AGENTS_FILE}.tmp"
    cat "$TEMPLATE" >> "${AGENTS_FILE}.tmp"
    tail -n "+${START_LINE}" "$AGENTS_FILE" >> "${AGENTS_FILE}.tmp"
    mv "${AGENTS_FILE}.tmp" "$AGENTS_FILE"

    echo -e "${GREEN}✅${NC} 更新了反思框架（替换旧版本）"
  else
    echo "⚠️  标记不完整，追加新模板"
    echo "" >> "$AGENTS_FILE"
    cat "$TEMPLATE" >> "$AGENTS_FILE"
  fi
else
  # 不存在 → 追加
  echo "" >> "$AGENTS_FILE"
  cat "$TEMPLATE" >> "$AGENTS_FILE"
  echo -e "${GREEN}✅${NC} 注入了反思框架到 AGENTS.md"
fi

echo -e "${GREEN}🎉 Serendip 反思框架安装完成${NC}"
