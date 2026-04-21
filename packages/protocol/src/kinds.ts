// Kind-registry loader.
// Per docs/spec/03-modules-platform.md §6.
//
// Each file under kind-registry/kinds/*.json MUST carry the five MVP
// metadata fields (name, owner, payload_schema_url, status, created_at).
// The rest of the file is a JSON Schema describing the payload; it is
// opaque to this loader.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { InvalidKindRegistryError } from './errors.js'

export type KindStatus = 'stable-mvp' | 'experimental' | 'deprecated'

export interface KindRegistryEntry {
  readonly name: string
  readonly owner: string
  readonly payload_schema_url: string
  readonly status: KindStatus
  readonly created_at: number
}

const REQUIRED_FIELDS = ['name', 'owner', 'payload_schema_url', 'status', 'created_at'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Synchronously load every `*.json` entry in the given directory and
 * return the normalised metadata. Throws InvalidKindRegistryError on
 * the first entry missing a required field (SPEC §6 acceptance 3).
 */
export function loadKindRegistry(dir: string): KindRegistryEntry[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  const entries: KindRegistryEntry[] = []

  for (const file of files) {
    const path = join(dir, file)
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!isRecord(parsed)) {
      throw new InvalidKindRegistryError(file, REQUIRED_FIELDS as unknown as string[])
    }

    const missing = REQUIRED_FIELDS.filter((field) => !(field in parsed))
    if (missing.length > 0) {
      throw new InvalidKindRegistryError(file, missing)
    }

    entries.push({
      name: String(parsed.name),
      owner: String(parsed.owner),
      payload_schema_url: String(parsed.payload_schema_url),
      status: parsed.status as KindStatus,
      created_at: Number(parsed.created_at),
    })
  }

  return entries
}
