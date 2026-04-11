import { describe, it, expect } from 'vitest'
import { buildMerkleRoot, getMerkleProof, verifyMerkleProof } from '../src/merkle.js'

describe('A4: Merkle Hash 完整性校验', () => {
  const events = [
    { id: 'aaa111', content: 'experience 1' },
    { id: 'bbb222', content: 'experience 2' },
    { id: 'ccc333', content: 'experience 3' },
    { id: 'ddd444', content: 'experience 4' },
  ]

  const eventIds = events.map(e => e.id)

  it('buildMerkleRoot 返回 root hash', () => {
    const root = buildMerkleRoot(eventIds)

    expect(root).toBeDefined()
    expect(root).toMatch(/^[0-9a-f]+$/)
    expect(root).toHaveLength(64) // SHA-256
  })

  it('同一组事件的 root 确定性', () => {
    const root1 = buildMerkleRoot(eventIds)
    const root2 = buildMerkleRoot(eventIds)

    expect(root1).toBe(root2)
  })

  it('不同事件集产生不同 root', () => {
    const root1 = buildMerkleRoot(eventIds)
    const root2 = buildMerkleRoot(['xxx', 'yyy'])

    expect(root1).not.toBe(root2)
  })

  it('getMerkleProof 获取包含证明', () => {
    const proof = getMerkleProof(eventIds, 'aaa111')

    expect(proof).toBeDefined()
    expect(proof.leaf).toBe('aaa111')
    expect(proof.root).toBe(buildMerkleRoot(eventIds))
    expect(proof.path.length).toBeGreaterThan(0)
    expect(proof.path.every(p => p.position === 'left' || p.position === 'right')).toBe(true)
  })

  it('verifyMerkleProof 验证合法包含证明', () => {
    const root = buildMerkleRoot(eventIds)

    for (const id of eventIds) {
      const proof = getMerkleProof(eventIds, id)
      expect(verifyMerkleProof(id, proof, root)).toBe(true)
    }
  })

  it('verifyMerkleProof 拒绝伪造 id', () => {
    const root = buildMerkleRoot(eventIds)
    const proof = getMerkleProof(eventIds, 'aaa111')

    expect(verifyMerkleProof('fake-id', proof, root)).toBe(false)
  })

  it('verifyMerkleProof 拒绝篡改的 root', () => {
    const proof = getMerkleProof(eventIds, 'aaa111')

    expect(verifyMerkleProof('aaa111', proof, 'f'.repeat(64))).toBe(false)
  })

  it('单个事件的 Merkle tree', () => {
    const single = ['only-one']
    const root = buildMerkleRoot(single)
    const proof = getMerkleProof(single, 'only-one')

    expect(proof.path).toHaveLength(0)
    expect(verifyMerkleProof('only-one', proof, root)).toBe(true)
  })

  it('奇数个事件也能正确处理', () => {
    const odd = ['a', 'b', 'c']
    const root = buildMerkleRoot(odd)

    for (const id of odd) {
      const proof = getMerkleProof(odd, id)
      expect(verifyMerkleProof(id, proof, root)).toBe(true)
    }
  })

  it('大量事件性能测试', () => {
    const many = Array.from({ length: 1000 }, (_, i) => `event-${i}`)
    const root = buildMerkleRoot(many)

    // 随机抽 5 个验证
    for (const idx of [0, 100, 499, 500, 999]) {
      const proof = getMerkleProof(many, many[idx])
      expect(verifyMerkleProof(many[idx], proof, root)).toBe(true)
    }
  })

  it('事件不存在时 getMerkleProof 抛错', () => {
    expect(() => getMerkleProof(eventIds, 'nonexistent')).toThrow()
  })

  it('空数组时 buildMerkleRoot 抛错', () => {
    expect(() => buildMerkleRoot([])).toThrow()
  })
})
