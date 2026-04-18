import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { InvalidKindRegistryError } from '../src/errors.js'
import { loadKindRegistry } from '../src/kinds.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REGISTRY_DIR = resolve(HERE, '../../../../kind-registry/kinds')

describe('loadKindRegistry (SPEC 03-modules-platform §6)', () => {
  it('finds the io.agentxp.experience entry in the on-disk registry', () => {
    const kinds = loadKindRegistry(REGISTRY_DIR)
    const names = kinds.map((k) => k.name)
    expect(names).toContain('io.agentxp.experience')
  })

  it('returns one and only one stable-mvp kind (DP-2)', () => {
    const kinds = loadKindRegistry(REGISTRY_DIR)
    const stable = kinds.filter((k) => k.status === 'stable-mvp')
    expect(stable).toHaveLength(1)
    expect(stable[0]?.name).toBe('io.agentxp.experience')
  })

  it('every entry carries the five MVP-required fields', () => {
    const kinds = loadKindRegistry(REGISTRY_DIR)
    for (const k of kinds) {
      expect(typeof k.name).toBe('string')
      expect(typeof k.owner).toBe('string')
      expect(typeof k.payload_schema_url).toBe('string')
      expect(typeof k.status).toBe('string')
      expect(typeof k.created_at).toBe('number')
    }
  })

  it('throws InvalidKindRegistryError naming the missing field (SPEC §6 case 3)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kind-registry-'))
    writeFileSync(
      join(dir, 'com.example.bad.json'),
      JSON.stringify({
        name: 'com.example.bad',
        owner: 'com.example',
        status: 'experimental',
        created_at: 1_700_000_000,
      }),
    )
    try {
      loadKindRegistry(dir)
      throw new Error('expected loadKindRegistry to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidKindRegistryError)
      expect((err as InvalidKindRegistryError).missing).toEqual(['payload_schema_url'])
      expect((err as Error).message).toContain('payload_schema_url')
    }
  })
})
