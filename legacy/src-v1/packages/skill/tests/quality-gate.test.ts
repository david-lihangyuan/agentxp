// quality-gate.test.ts — Tests for draft quality gate before publishing
import { describe, it, expect } from 'vitest'
import { qualityGate } from '../src/publisher.js'
import type { DraftEntry } from '../src/publisher.js'

function makeDraft(overrides: Partial<DraftEntry> = {}): DraftEntry {
  return {
    what: 'Fix TypeScript compilation error in src/index.ts',
    tried: 'Updated tsconfig.json strict mode to true and recompiled',
    outcome: 'succeeded',
    learned: 'Setting strict:true in tsconfig.json catches implicit any errors at compile time',
    retry_count: 0,
    last_attempt: null,
    ...overrides,
  }
}

describe('qualityGate', () => {
  describe('passing drafts', () => {
    it('passes a well-formed draft with file path in learned', () => {
      const result = qualityGate(makeDraft())
      expect(result.pass).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('passes a draft with backtick command in learned', () => {
      const result = qualityGate(makeDraft({
        learned: 'Run `npm install --legacy-peer-deps` to resolve peer dependency conflicts',
      }))
      expect(result.pass).toBe(true)
    })

    it('passes a draft with error code number in learned', () => {
      const result = qualityGate(makeDraft({
        learned: 'Exit code 127 means the command was not found in PATH',
        tried: 'Tried running the binary directly with full path resolution',
      }))
      expect(result.pass).toBe(true)
    })

    it('passes a draft with dotted config key in learned', () => {
      const result = qualityGate(makeDraft({
        learned: 'Setting proxy.host in config.yaml enables SOCKS5 tunneling through the gateway',
      }))
      expect(result.pass).toBe(true)
    })

    it('passes a draft with Windows path (backslash) in learned', () => {
      const result = qualityGate(makeDraft({
        learned: 'Config file is at C:\\Users\\user\\AppData\\Local\\app\\config.json and must be edited manually',
      }))
      expect(result.pass).toBe(true)
    })
  })

  describe('failing drafts — what too short', () => {
    it('fails when what is exactly 10 chars', () => {
      const result = qualityGate(makeDraft({ what: '1234567890' }))
      expect(result.pass).toBe(false)
      expect(result.reason).toContain('"what"')
    })

    it('fails when what is empty', () => {
      const result = qualityGate(makeDraft({ what: '' }))
      expect(result.pass).toBe(false)
    })

    it('passes when what is 11 chars', () => {
      const result = qualityGate(makeDraft({ what: '12345678901' }))
      expect(result.pass).toBe(true)
    })
  })

  describe('failing drafts — learned too short', () => {
    it('fails when learned is exactly 20 chars', () => {
      const result = qualityGate(makeDraft({ learned: '12345678901234567890' }))
      expect(result.pass).toBe(false)
      expect(result.reason).toContain('"learned"')
    })

    it('fails when learned is empty', () => {
      const result = qualityGate(makeDraft({ learned: '' }))
      expect(result.pass).toBe(false)
    })

    it('passes when learned is 21 chars but has concrete detail', () => {
      const result = qualityGate(makeDraft({ learned: 'Use /path to configure' }))
      expect(result.pass).toBe(true)
    })
  })

  describe('failing drafts — tried too short', () => {
    it('fails when tried is exactly 20 chars', () => {
      const result = qualityGate(makeDraft({ tried: '12345678901234567890' }))
      expect(result.pass).toBe(false)
      expect(result.reason).toContain('"tried"')
    })

    it('fails when tried is empty', () => {
      const result = qualityGate(makeDraft({ tried: '' }))
      expect(result.pass).toBe(false)
    })
  })

  describe('failing drafts — learned lacks concrete detail', () => {
    it('fails when learned has no path, command, number, or dotted key', () => {
      const result = qualityGate(makeDraft({
        outcome: 'failed',
        learned: 'This approach works better than the other approach we tried before',
      }))
      expect(result.pass).toBe(false)
      expect(result.reason).toContain('concrete detail')
    })

    it('fails when learned is generic lesson without specifics', () => {
      const result = qualityGate(makeDraft({
        outcome: 'failed',
        learned: 'Always check the documentation before making assumptions about behavior',
      }))
      // "documentation" contains a dot? No. Let's check: no path, no backtick, no number, no dotted word.
      // Actually "documentation" doesn't contain a dot, so this should fail.
      // BUT "behavior" also no dot. This should fail.
      expect(result.pass).toBe(false)
    })
  })

  describe('order of checks', () => {
    it('checks what length first', () => {
      const result = qualityGate(makeDraft({
        what: 'short',    // fails what check
        tried: 'x',       // would also fail tried check
        learned: 'x',     // would also fail learned check
      }))
      expect(result.pass).toBe(false)
      expect(result.reason).toContain('"what"')
    })
  })
})

  describe('CJK and success exemption', () => {
    it('passes when learned contains Chinese technical terms', () => {
      const result = qualityGate(makeDraft({
        outcome: 'failed',
        learned: '端口 3141 被占用导致服务启动失败，需要先检查端口占用情况',
      }))
      expect(result.pass).toBe(true)
    })

    it('passes succeeded outcome with long learned even without concrete markers', () => {
      const result = qualityGate(makeDraft({
        outcome: 'succeeded',
        learned: 'Discovered that this pattern works much better when applied consistently across all modules in the project',
      }))
      expect(result.pass).toBe(true)
    })

    it('fails succeeded outcome with short learned without concrete markers', () => {
      const result = qualityGate(makeDraft({
        outcome: 'succeeded',
        learned: 'This works better now yeah',
      }))
      expect(result.pass).toBe(false)
    })
  })
