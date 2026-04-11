import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const SCRIPT = join(__dirname, '..', 'scripts', 'install.sh')
const TEMPLATE = join(__dirname, '..', 'templates', 'agents-inject.md')

describe('E1: 反思框架安装', () => {
  let workspace: string

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'serendip-e1-'))
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  function runInstall(): string {
    return execSync(`bash "${SCRIPT}" "${workspace}"`, {
      encoding: 'utf-8',
      timeout: 10000,
    })
  }

  function readAgents(): string {
    return readFileSync(join(workspace, 'AGENTS.md'), 'utf-8')
  }

  // --- 基础功能 ---

  it('空目录：创建 AGENTS.md + 注入模板', () => {
    const output = runInstall()
    expect(output).toContain('✅')

    const content = readAgents()
    expect(content).toContain('SERENDIP_REFLECTION_START')
    expect(content).toContain('SERENDIP_REFLECTION_END')
    expect(content).toContain('## Serendip 反思框架')
    expect(content).toContain('### Mistakes')
    expect(content).toContain('### Lessons')
  })

  it('已有 AGENTS.md：追加不覆盖', () => {
    const existing = '# My AGENTS\n\n## 已有内容\n不要删\n'
    writeFileSync(join(workspace, 'AGENTS.md'), existing)

    runInstall()
    const content = readAgents()

    // 保留原内容
    expect(content).toContain('## 已有内容')
    expect(content).toContain('不要删')
    // 追加了模板
    expect(content).toContain('SERENDIP_REFLECTION_START')
  })

  it('重复安装：更新而不重复', () => {
    // 第一次安装
    runInstall()
    const first = readAgents()
    const markerCount1 = (first.match(/SERENDIP_REFLECTION_START/g) || []).length
    expect(markerCount1).toBe(1)

    // 第二次安装
    runInstall()
    const second = readAgents()
    const markerCount2 = (second.match(/SERENDIP_REFLECTION_START/g) || []).length
    expect(markerCount2).toBe(1)
  })

  // --- 反思目录 ---

  it('创建 memory/reflections/ 目录', () => {
    runInstall()
    expect(existsSync(join(workspace, 'memory', 'reflections'))).toBe(true)
  })

  it('已有 memory/ 目录不破坏', () => {
    mkdirSync(join(workspace, 'memory'), { recursive: true })
    writeFileSync(join(workspace, 'memory', 'test.md'), 'keep me')

    runInstall()
    expect(readFileSync(join(workspace, 'memory', 'test.md'), 'utf-8')).toBe('keep me')
    expect(existsSync(join(workspace, 'memory', 'reflections'))).toBe(true)
  })

  // --- 模板内容验证 ---

  it('模板包含必需格式字段', () => {
    runInstall()
    const content = readAgents()

    // 格式关键元素
    expect(content).toContain('做了什么')
    expect(content).toContain('结果：failed | partial')
    expect(content).toContain('结果：succeeded')
    expect(content).toContain('教训')
    expect(content).toContain('收获')
  })

  it('模板包含质量要求', () => {
    runInstall()
    const content = readAgents()

    expect(content).toContain('≥20字')
    expect(content).toContain('具体')
  })

  // --- 格式标记完整性 ---

  it('START 和 END 标记成对出现', () => {
    runInstall()
    const content = readAgents()

    const starts = (content.match(/SERENDIP_REFLECTION_START/g) || []).length
    const ends = (content.match(/SERENDIP_REFLECTION_END/g) || []).length
    expect(starts).toBe(1)
    expect(ends).toBe(1)

    // START 在 END 前面
    const startPos = content.indexOf('SERENDIP_REFLECTION_START')
    const endPos = content.indexOf('SERENDIP_REFLECTION_END')
    expect(startPos).toBeLessThan(endPos)
  })

  // --- 更新场景 ---

  it('更新时保留 AGENTS.md 中标记之外的内容', () => {
    const before = '# My Agent\n\n## Setup\nImportant setup.\n'
    const after = '\n## Other\nMore content.\n'
    writeFileSync(join(workspace, 'AGENTS.md'), before)

    // 第一次安装
    runInstall()
    // 在模板后面追加内容
    const content1 = readAgents()
    writeFileSync(join(workspace, 'AGENTS.md'), content1 + after)

    // 第二次安装（更新）
    runInstall()
    const content2 = readAgents()

    expect(content2).toContain('## Setup')
    expect(content2).toContain('Important setup.')
    expect(content2).toContain('SERENDIP_REFLECTION_START')
    // 标记后面的内容也保留
    expect(content2).toContain('## Other')
  })
})
