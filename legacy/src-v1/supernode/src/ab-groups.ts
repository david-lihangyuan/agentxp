// A/B experiment group configuration (H9).
//
// Source of truth:
//   - If AB_GROUPS_PATH is set, load the JSON file at that path.
//   - Otherwise, fall back to DEFAULT_AB_GROUPS below.
//
// JSON file format: an array of { label, pubkey } objects, where pubkey
// is exactly 64 lowercase hex characters. Example:
//   [
//     { "label": "curiosity-opus", "pubkey": "52f4...de63" },
//     { "label": "reward-gpt5",   "pubkey": "0d4b...8fa8" }
//   ]
//
// Invalid paths or malformed JSON throw — silent fallback on a
// misconfigured AB_GROUPS_PATH would be confusing to operators.

import { readFileSync } from 'node:fs'
import { validatePubkey } from './validate'

export interface ABGroup {
  label: string
  pubkey: string
}

/** Built-in default cohort for the H9 experiment. */
export const DEFAULT_AB_GROUPS: ReadonlyArray<ABGroup> = [
  { label: 'curiosity-opus', pubkey: '52f44025f7094129959c5d67d9042359e38e677802ab3564d82fb0bcdd43de63' },
  { label: 'curiosity-opus', pubkey: 'beb1ba732652fdc4cfea6e2e42836814a4652670ab30eb07a60580f58981e787' },
  { label: 'reward-gpt5', pubkey: '0d4bd5a6077bb5c88a60c8b085549b8c29f6bfeb5dac05b408bccc0d65aa8fa8' },
  { label: 'reward-gpt5', pubkey: '0de23c09c5dc6f6645741c33c2878d0c4946bd85bc88fb8e65f207a38dfbf287' },
  { label: 'seeker-gpt5', pubkey: '544de8ac97e56d5cd0ef3d0cbf1d453eec92a4749ec123673002ce7f1b4fb3ec' },
  { label: 'seeker-gpt5', pubkey: '76816215292f4f9102143ac656c0675022a2c10338bd57e19bcb12f65e4ee58d' },
]

/**
 * Load A/B groups from a JSON file, or return the built-in defaults
 * when no path is provided.
 *
 * Throws on any validation failure (missing file, malformed JSON,
 * wrong shape, invalid pubkey) rather than silently falling back —
 * a set AB_GROUPS_PATH signals deliberate configuration.
 */
export function loadABGroups(path?: string | undefined): ABGroup[] {
  if (path === undefined || path === '') {
    return [...DEFAULT_AB_GROUPS]
  }

  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`AB_GROUPS_PATH: failed to read ${path}: ${msg}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`AB_GROUPS_PATH: invalid JSON in ${path}: ${msg}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`AB_GROUPS_PATH: ${path} must contain a JSON array`)
  }

  const result: ABGroup[] = []
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i]
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`AB_GROUPS_PATH: entry ${i} must be an object`)
    }
    const rec = entry as Record<string, unknown>
    const label = rec['label']
    const pubkey = rec['pubkey']
    if (typeof label !== 'string' || label.length === 0) {
      throw new Error(`AB_GROUPS_PATH: entry ${i} has missing or non-string label`)
    }
    const pubkeyCheck = validatePubkey(pubkey)
    if (!pubkeyCheck.valid) {
      throw new Error(`AB_GROUPS_PATH: entry ${i} (${label}): ${pubkeyCheck.error}`)
    }
    result.push({ label, pubkey: pubkey as string })
  }

  return result
}
