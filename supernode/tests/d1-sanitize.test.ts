/**
 * D1：本地脱敏引擎（加强版）
 *
 * 高风险 → block（整条经验不发布）
 * 中风险 → redact（替换占位符后可发布）
 * 干净 → pass
 */
import { describe, it, expect } from 'vitest'
import { sanitize, SanitizeResult } from '../src/sanitize.js'

// ============================================================
// 高风险：block
// ============================================================

describe('高风险检测 → block', () => {
  it('API key (sk-xxx 格式)', () => {
    const result = sanitize({
      tried: '设置 OPENAI_API_KEY=sk-abc123def456ghij789',
      learned: '记得设置环境变量',
    })
    expect(result.action).toBe('block')
    expect(result.reason).toContain('API key')
  })

  it('OpenAI key 完整格式 sk-proj-', () => {
    const result = sanitize({
      tried: 'export OPENAI_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890',
      learned: 'key 格式变了',
    })
    expect(result.action).toBe('block')
  })

  it('AWS Access Key', () => {
    const result = sanitize({
      tried: 'aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE',
      learned: '配置 AWS',
    })
    expect(result.action).toBe('block')
    expect(result.reason).toContain('AWS')
  })

  it('Bearer Token', () => {
    const result = sanitize({
      tried: 'curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV"',
      learned: '带 token 调用 API',
    })
    expect(result.action).toBe('block')
  })

  it('私钥 PEM 格式', () => {
    const result = sanitize({
      tried: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----',
      learned: '生成 RSA 密钥',
    })
    expect(result.action).toBe('block')
    expect(result.reason).toContain('private key')
  })

  it('数据库连接串含密码', () => {
    const result = sanitize({
      tried: 'postgresql://admin:super_secret_pass@db.prod.internal/mydb',
      learned: '连接生产库',
    })
    expect(result.action).toBe('block')
    expect(result.reason).toContain('connection string')
  })

  it('GitHub token ghp_', () => {
    const result = sanitize({
      tried: 'gh auth login --with-token ghp_16C7e42F292c6912E7710c838347Ae178B4a',
      learned: '使用 PAT 登录',
    })
    expect(result.action).toBe('block')
  })
})

// ============================================================
// 中风险：redact
// ============================================================

describe('中风险检测 → redact', () => {
  it('内网 IPv4 地址', () => {
    const result = sanitize({
      tried: '访问 http://192.168.1.100:8080/api/v1/users',
      learned: '内网服务需要 VPN',
    })
    expect(result.action).toBe('redact')
    expect(result.content!.tried).toContain('[PRIVATE_URL]')
    expect(result.content!.tried).not.toContain('192.168.1.100')
  })

  it('10.x.x.x 内网地址', () => {
    const result = sanitize({
      tried: 'curl http://10.0.0.15:3000/health',
      learned: '内网健康检查',
    })
    expect(result.action).toBe('redact')
    expect(result.content!.tried).toContain('[PRIVATE_URL]')
  })

  it('172.16.x.x 内网地址', () => {
    const result = sanitize({
      tried: 'ping 172.16.0.1',
      learned: '网关连通性',
    })
    expect(result.action).toBe('redact')
    expect(result.content!.tried).toContain('[PRIVATE_IP]')
  })

  it('邮箱地址', () => {
    const result = sanitize({
      tried: '发邮件给 admin@company.internal',
      learned: '内部邮件格式',
    })
    expect(result.action).toBe('redact')
    expect(result.content!.tried).toContain('[EMAIL]')
    expect(result.content!.tried).not.toContain('admin@company')
  })

  it('手机号码（中国格式）', () => {
    const result = sanitize({
      tried: '发短信到 13812345678 验证',
      learned: '短信验证流程',
    })
    expect(result.action).toBe('redact')
    expect(result.content!.tried).toContain('[PHONE]')
  })

  it('绝对路径（/home/user/... 风格）', () => {
    const result = sanitize({
      tried: 'cp /home/david/projects/secret/config.yaml ./config.yaml',
      learned: '复制配置文件',
    })
    expect(result.action).toBe('redact')
    expect(result.content!.tried).toContain('[PATH]')
  })

  it('Windows 路径', () => {
    const result = sanitize({
      tried: 'copy C:\\Users\\david\\Desktop\\config.json .',
      learned: '复制文件',
    })
    expect(result.action).toBe('redact')
    expect(result.content!.tried).toContain('[PATH]')
  })

  it('多个中风险 → 全部替换', () => {
    const result = sanitize({
      tried: '联系 bob@acme.com，服务在 192.168.0.50:9000',
      learned: '需要联系管理员',
    })
    expect(result.action).toBe('redact')
    expect(result.content!.tried).not.toContain('bob@acme')
    expect(result.content!.tried).not.toContain('192.168')
  })
})

// ============================================================
// 干净内容 → pass
// ============================================================

describe('干净内容 → pass', () => {
  it('纯技术操作', () => {
    const result = sanitize({
      tried: 'docker restart my-container',
      learned: '重启容器可以清除 DNS 缓存',
    })
    expect(result.action).toBe('pass')
    expect(result.content!.tried).toBe('docker restart my-container')
  })

  it('公共 URL 不拦截', () => {
    const result = sanitize({
      tried: '访问 https://api.openai.com/v1/chat/completions',
      learned: '使用 OpenAI API',
    })
    expect(result.action).toBe('pass')
  })

  it('普通 IP（公网）不拦截', () => {
    const result = sanitize({
      tried: 'curl https://8.8.8.8/resolve',
      learned: 'DNS over HTTPS',
    })
    expect(result.action).toBe('pass')
  })

  it('含内网关键词但是在说明文字里 → pass（无实际 IP）', () => {
    const result = sanitize({
      tried: '配置 nginx 反向代理到后端服务',
      learned: '内网服务通过 nginx 暴露，无需直接访问内网 IP',
    })
    expect(result.action).toBe('pass')
  })

  it('空内容通过', () => {
    const result = sanitize({ tried: '', learned: '无操作' })
    expect(result.action).toBe('pass')
  })
})

// ============================================================
// 返回结构完整性
// ============================================================

describe('返回结构', () => {
  it('block 时 content 可为 undefined', () => {
    const result = sanitize({
      tried: 'export KEY=sk-test12345678901234567890123456',
      learned: '测试',
    })
    expect(result.action).toBe('block')
    expect(result.reason).toBeDefined()
  })

  it('pass 时 content 原样返回', () => {
    const input = { tried: 'npm install', learned: '安装依赖' }
    const result = sanitize(input)
    expect(result.action).toBe('pass')
    expect(result.content).toEqual(input)
  })

  it('redact 时返回脱敏后内容', () => {
    const result = sanitize({
      tried: '连接 192.168.1.1',
      learned: '内网连接',
    })
    expect(result.action).toBe('redact')
    expect(result.content).toBeDefined()
    expect(result.redacted_fields).toBeDefined()
    expect(result.redacted_fields!.length).toBeGreaterThan(0)
  })
})
