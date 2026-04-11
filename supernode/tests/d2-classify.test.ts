/**
 * D2：内容自动分类
 *
 * 规则优先（0 token）：含内部关键词 → private
 * 返回 'public' | 'private' | 'uncertain'
 */
import { describe, it, expect } from 'vitest'
import { classifyVisibility, VisibilityClassification } from '../src/classify.js'

// ============================================================
// 规则层：private
// ============================================================

describe('规则优先 → private', () => {
  it('含 internal 关键词', async () => {
    const result = await classifyVisibility({
      tried: '调用公司 internal API',
      learned: '需要内网访问',
      tags: ['internal'],
    })
    expect(result.visibility).toBe('private')
    expect(result.method).toBe('rule')
  })

  it('含 private 关键词', async () => {
    const result = await classifyVisibility({
      tried: '访问 private repo',
      learned: '需要 access token',
      tags: [],
    })
    expect(result.visibility).toBe('private')
    expect(result.method).toBe('rule')
  })

  it('含公司/组织关键词（Salesforce）', async () => {
    const result = await classifyVisibility({
      tried: '调用 Salesforce CRM API 获取客户列表',
      learned: '需要 OAuth 2.0 client credentials',
      tags: ['salesforce', 'crm'],
    })
    expect(result.visibility).toBe('private')
    expect(result.method).toBe('rule')
  })

  it('含 confidential', async () => {
    const result = await classifyVisibility({
      tried: '处理 confidential 合同文件',
      learned: '文件加密后上传',
      tags: [],
    })
    expect(result.visibility).toBe('private')
    expect(result.method).toBe('rule')
  })

  it('tag 含 private', async () => {
    const result = await classifyVisibility({
      tried: '部署到公司内部服务器',
      learned: '使用 SSH key 登录',
      tags: ['private', 'deployment'],
    })
    expect(result.visibility).toBe('private')
    expect(result.method).toBe('rule')
  })

  it('含中文内部关键词（内部/内网/公司）', async () => {
    const result = await classifyVisibility({
      tried: '连接公司内部数据库',
      learned: '内网 IP 段是 10.x',
      tags: [],
    })
    expect(result.visibility).toBe('private')
    expect(result.method).toBe('rule')
  })

  it('含 proprietary', async () => {
    const result = await classifyVisibility({
      tried: '修改 proprietary 算法配置',
      learned: '参数调整方式',
      tags: [],
    })
    expect(result.visibility).toBe('private')
    expect(result.method).toBe('rule')
  })
})

// ============================================================
// 规则层：public（通用技术内容）
// ============================================================

describe('规则优先 → public（通用技术）', () => {
  it('Docker 操作', async () => {
    const result = await classifyVisibility({
      tried: 'docker run --dns 8.8.8.8 nginx',
      learned: '指定 DNS 解决容器网络问题',
      tags: ['docker', 'networking'],
    })
    expect(result.visibility).toBe('public')
    expect(result.method).toBe('rule')
  })

  it('git 操作', async () => {
    const result = await classifyVisibility({
      tried: 'git rebase -i HEAD~3',
      learned: '合并最近 3 个提交',
      tags: ['git'],
    })
    expect(result.visibility).toBe('public')
    expect(result.method).toBe('rule')
  })

  it('npm / Node.js', async () => {
    const result = await classifyVisibility({
      tried: 'npm install --save-dev vitest',
      learned: 'vitest 作为开发依赖安装',
      tags: ['npm', 'testing'],
    })
    expect(result.visibility).toBe('public')
    expect(result.method).toBe('rule')
  })

  it('无关键词的纯技术文字', async () => {
    const result = await classifyVisibility({
      tried: 'restart nginx after config change',
      learned: 'nginx -s reload is graceful, restart kills connections',
      tags: ['nginx'],
    })
    expect(result.visibility).toBe('public')
    expect(result.method).toBe('rule')
  })
})

// ============================================================
// 边界：公共技术关键词不误触发
// ============================================================

describe('边界：公共技术词不触发 private', () => {
  it('说到 private key 但是在讨论通用 SSH', async () => {
    // "private key" 在 SSH 上下文是通用知识
    const result = await classifyVisibility({
      tried: 'ssh-keygen -t ed25519',
      learned: '生成 SSH private key，保存到 ~/.ssh',
      tags: ['ssh'],
    })
    // 因为 tried 里有 ssh-keygen（公共技术），不应该因为 "private key" 就判 private
    // 但当前规则层是简单词匹配，这里接受 uncertain（LLM 兜底）或 public 都可以
    expect(['public', 'uncertain']).toContain(result.visibility)
  })
})

// ============================================================
// 返回结构
// ============================================================

describe('返回结构', () => {
  it('包含 visibility + method + reason', async () => {
    const result = await classifyVisibility({
      tried: 'docker ps',
      learned: '列出运行容器',
      tags: [],
    })
    expect(result.visibility).toBeDefined()
    expect(result.method).toBeDefined()
    expect(result.reason).toBeDefined()
  })
})
