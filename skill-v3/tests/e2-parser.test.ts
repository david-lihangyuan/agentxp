import { describe, it, expect } from 'vitest'
import { parseReflection, type ReflectionDraft } from '../src/reflection-parser'

describe('E2: 规则解析器', () => {
  // --- 基础解析 ---

  it('解析单条 Mistake', () => {
    const content = `## 14:30 反思

### Mistakes
- 做了什么：用 rm -rf 删了 /var/data 目录，导致数据库文件丢失
  结果：failed
  教训：删除前用 ls 确认路径，用 trash 代替 rm，避免不可逆操作
`
    const drafts = parseReflection(content)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].tried).toBe('用 rm -rf 删了 /var/data 目录，导致数据库文件丢失')
    expect(drafts[0].outcome).toBe('failed')
    expect(drafts[0].learned).toBe('删除前用 ls 确认路径，用 trash 代替 rm，避免不可逆操作')
    expect(drafts[0].section).toBe('mistakes')
  })

  it('解析单条 Lesson', () => {
    const content = `## 15:00 反思

### Lessons
- 做了什么：在 Dockerfile 中用 multi-stage build 减少镜像体积
  结果：succeeded
  收获：multi-stage build 把镜像从 1.2GB 减到 180MB，关键是把 build 依赖留在前一阶段
`
    const drafts = parseReflection(content)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].tried).toBe('在 Dockerfile 中用 multi-stage build 减少镜像体积')
    expect(drafts[0].outcome).toBe('succeeded')
    expect(drafts[0].learned).toBe('multi-stage build 把镜像从 1.2GB 减到 180MB，关键是把 build 依赖留在前一阶段')
    expect(drafts[0].section).toBe('lessons')
  })

  it('解析多条混合', () => {
    const content = `## 10:00 反思

### Mistakes
- 做了什么：没读源码就改了 heartbeat 配置的 interval 参数
  结果：failed
  教训：改配置前先读源码理解每个字段，不理解的东西不碰

### Lessons
- 做了什么：用 vitest 的 --reporter=verbose 看每个测试的通过状态
  结果：succeeded
  收获：verbose reporter 比 default 更适合 TDD，能看到测试名字验证覆盖度

- 做了什么：把 canonicalize 逻辑统一到 events.ts 而不是各模块各写一份
  结果：succeeded
  收获：序列化函数必须唯一来源，多份拷贝迟早会 diverge 导致签名验证失败
`
    const drafts = parseReflection(content)
    expect(drafts).toHaveLength(3)
    expect(drafts[0].section).toBe('mistakes')
    expect(drafts[1].section).toBe('lessons')
    expect(drafts[2].section).toBe('lessons')
  })

  // --- partial 结果 ---

  it('解析 partial 结果', () => {
    const content = `## 11:00 反思

### Mistakes
- 做了什么：SDK 42 个 mock 测试全绿但生产暴露两个 bug
  结果：partial
  教训：mock 只证明内部逻辑对，不证明能和生产跑通，必须有 e2e 测试
`
    const drafts = parseReflection(content)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].outcome).toBe('partial')
  })

  // --- 质量门控 ---

  it('过滤：做了什么 < 20 字符', () => {
    const content = `## 12:00 反思

### Mistakes
- 做了什么：删了文件
  结果：failed
  教训：删除前用 ls 确认路径，用 trash 代替 rm，避免不可逆操作
`
    const drafts = parseReflection(content)
    expect(drafts).toHaveLength(0) // 被门控过滤
  })

  it('过滤：教训/收获 < 20 字符', () => {
    const content = `## 12:00 反思

### Lessons
- 做了什么：在 Dockerfile 中用 multi-stage build 减少镜像体积
  结果：succeeded
  收获：用 multi-stage
`
    const drafts = parseReflection(content)
    expect(drafts).toHaveLength(0)
  })

  it('过滤：缺失结果字段', () => {
    const content = `## 12:00 反思

### Mistakes
- 做了什么：没读源码就改了 heartbeat 配置的 interval 参数导致心跳中断
  教训：改配置前先读源码理解每个字段，不理解的东西不碰
`
    const drafts = parseReflection(content)
    expect(drafts).toHaveLength(0) // 缺 outcome
  })

  // --- 边界情况 ---

  it('空内容返回空数组', () => {
    expect(parseReflection('')).toEqual([])
  })

  it('无反思标记的普通文本返回空', () => {
    const content = `# 今天的日志

做了很多事情，感觉不错。
`
    expect(parseReflection(content)).toEqual([])
  })

  it('多个反思块（同一文件多次反思）', () => {
    const content = `## 10:00 反思

### Lessons
- 做了什么：配置了 CI 管道自动运行 vitest 测试套件
  结果：succeeded
  收获：CI 绿灯给了信心，每次 push 都有即时反馈，不用手动跑测试

## 16:00 反思

### Mistakes
- 做了什么：直接在 main 分支提交了未测试的 database migration
  结果：failed
  教训：migration 永远先在 branch 测试，main 只接受通过 CI 的 PR
`
    const drafts = parseReflection(content)
    expect(drafts).toHaveLength(2)
    expect(drafts[0].section).toBe('lessons')
    expect(drafts[1].section).toBe('mistakes')
  })

  // --- 格式容错 ---

  it('容忍中文冒号', () => {
    const content = `## 14:00 反思

### Mistakes
- 做了什么：在生产环境直接执行 ALTER TABLE 没有先备份数据库
  结果：failed
  教训：生产环境做任何 schema 变更前必须先 pg_dump 备份，不可逆操作需要回滚方案
`
    const drafts = parseReflection(content)
    expect(drafts).toHaveLength(1)
  })

  it('容忍额外空格', () => {
    const content = `## 14:00 反思

### Mistakes
-  做了什么：  在生产环境直接执行 ALTER TABLE 没有先备份数据库
   结果：  failed
   教训：  生产环境做任何 schema 变更前必须先 pg_dump 备份，不可逆操作需要回滚方案
`
    const drafts = parseReflection(content)
    expect(drafts).toHaveLength(1)
    // 值应该被 trim
    expect(drafts[0].tried).not.toMatch(/^\s/)
    expect(drafts[0].learned).not.toMatch(/^\s/)
  })

  // --- 输出格式验证 ---

  it('草稿包含所有必需字段', () => {
    const content = `## 14:00 反思

### Lessons
- 做了什么：用 Ed25519 而不是 RSA 做事件签名，密钥只有 32 字节
  结果：succeeded
  收获：Ed25519 在 Agent 场景完胜 RSA：密钥小（32B vs 2048B+）、签名快、无 padding 攻击面
`
    const drafts = parseReflection(content)
    expect(drafts).toHaveLength(1)

    const d = drafts[0]
    expect(d).toHaveProperty('tried')
    expect(d).toHaveProperty('outcome')
    expect(d).toHaveProperty('learned')
    expect(d).toHaveProperty('section')
    expect(typeof d.tried).toBe('string')
    expect(typeof d.outcome).toBe('string')
    expect(typeof d.learned).toBe('string')
    expect(['succeeded', 'failed', 'partial']).toContain(d.outcome)
    expect(['mistakes', 'lessons']).toContain(d.section)
  })

  // --- 从真实记忆文件格式提取 ---

  it('从非标准但有结构的 lessons.md 格式提取（兼容模式）', () => {
    // 这是现有 lessons.md 的实际格式——不完全符合模板，但有结构
    // 规则解析器应该只处理符合模板的格式，不尝试猜测
    const content = `## Mock 测试的自欺欺人（2026-04-10）
Python SDK 42 个 mock 测试全绿，但生产验证暴露 2 个 bug。
→ **任何和外部服务交互的 SDK，必须有生产 e2e 测试。**
`
    const drafts = parseReflection(content)
    // 不符合模板格式 → 不提取（0 token 解析器不猜）
    expect(drafts).toHaveLength(0)
  })
})
