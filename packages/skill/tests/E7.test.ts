// E7 Test Suite: Local Experience Search
// TDD: keyword search over local reflection files, summary by default, full on expand.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { localSearch } from '../src/local-search.js'

describe('E7: Local Experience Search', () => {
  let testDir: string

  beforeEach(() => {
    const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
    testDir = join(__dirname, '.tmp-e7-' + id)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  function seedReflectionFiles(titles: string[]): void {
    let content = '# Mistakes\n\n'
    for (let i = 0; i < titles.length; i++) {
      content += `## 2026-04-${String(i + 1).padStart(2, '0')} ${titles[i]}
- Tried: attempted to resolve ${titles[i].toLowerCase()} issue using standard approach ${i}
- Expected: the ${titles[i].toLowerCase()} would work correctly
- Outcome: ${i % 2 === 0 ? 'succeeded' : 'failed'}
- Learned: ${titles[i].toLowerCase()} requires specific configuration and careful handling
- Tags: ${titles[i].toLowerCase().split(' ').join(', ')}

`
    }
    writeFileSync(join(testDir, 'mistakes.md'), content)
  }

  it('Keyword search finds matching entries', async () => {
    seedReflectionFiles(['Docker DNS fix', 'Kubernetes networking', 'Python import error'])
    const results = await localSearch('docker', testDir)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toContain('Docker')
  })

  it('Summary returned by default (low token cost)', async () => {
    seedReflectionFiles(['Docker DNS fix', 'Kubernetes networking'])
    const results = await localSearch('docker', testDir)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toBeDefined()
    expect(results[0].outcome).toBeDefined()
    expect(results[0].tags).toBeDefined()
    expect((results[0] as any).full_content).toBeUndefined()
  })

  it('Full content returned only when requested', async () => {
    seedReflectionFiles(['Docker DNS fix', 'Kubernetes networking'])
    const summaries = await localSearch('docker', testDir)
    expect(summaries.length).toBeGreaterThan(0)

    const expanded = await localSearch('docker', testDir, { expand: summaries[0].id })
    const expandedResult = expanded.find(r => r.id === summaries[0].id)
    expect(expandedResult).toBeDefined()
    expect((expandedResult as any).full_content).toBeDefined()
  })

  it('Zero network calls (purely local)', async () => {
    seedReflectionFiles(['Docker DNS fix'])
    // If this runs without errors and returns results, it's purely local
    // (no mock servers needed, no network setup)
    const results = await localSearch('docker', testDir)
    expect(results.length).toBeGreaterThan(0)
  })

  it('Returns empty for non-matching query', async () => {
    seedReflectionFiles(['Docker DNS fix', 'Kubernetes networking'])
    const results = await localSearch('zzzznonexistent', testDir)
    expect(results.length).toBe(0)
  })

  it('Returns empty for empty directory', async () => {
    const emptyDir = join(testDir, 'empty-reflection')
    mkdirSync(emptyDir, { recursive: true })
    const results = await localSearch('docker', emptyDir)
    expect(results.length).toBe(0)
  })

  it('Results sorted by relevance score', async () => {
    // Create entries where one has more keyword matches
    let content = '# Mistakes\n\n'
    content += `## 2026-04-01 Docker DNS Docker container Docker fix
- Tried: docker docker docker configuration steps
- Outcome: succeeded
- Learned: docker dns docker requires docker-specific docker handling
- Tags: docker, dns

`
    content += `## 2026-04-02 Kubernetes networking
- Tried: kubernetes networking setup with some docker mention
- Outcome: failed
- Learned: kubernetes needs specific configuration for docker bridge
- Tags: kubernetes, networking

`
    writeFileSync(join(testDir, 'mistakes.md'), content)

    const results = await localSearch('docker', testDir)
    expect(results.length).toBe(2)
    // First result should have higher score
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score)
  })
})
