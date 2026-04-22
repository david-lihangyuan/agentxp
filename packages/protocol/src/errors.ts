// Typed errors thrown by @agentxp/protocol.
// Per docs/spec/03-modules-platform.md §1 acceptance cases 2 and 3.

/**
 * Thrown by signEvent when the UTF-8 byte length of JSON.stringify(payload)
 * exceeds MAX_PAYLOAD_BYTES (65 536). Matches SPEC 02-data-model.md §1.1.
 */
export class PayloadTooLargeError extends Error {
  readonly code = 'payload_too_large' as const
  readonly actualBytes: number
  readonly maxBytes: number

  constructor(actualBytes: number, maxBytes: number) {
    super(`payload is ${actualBytes} bytes; limit is ${maxBytes} bytes`)
    this.name = 'PayloadTooLargeError'
    this.actualBytes = actualBytes
    this.maxBytes = maxBytes
  }
}

/**
 * Thrown by createEvent / signEvent when `kind` is not one of the
 * seven protocol-layer kinds enumerated in SPEC 02-data-model.md §2.
 */
export class InvalidKindError extends Error {
  readonly code = 'invalid_kind' as const
  readonly kind: string

  constructor(kind: string) {
    super(`kind "${kind}" is not a protocol-layer Serendip kind`)
    this.name = 'InvalidKindError'
    this.kind = kind
  }
}

/**
 * Thrown by loadKindRegistry when a registry file is missing one of
 * the five MVP-required fields enumerated in SPEC 03-modules-platform
 * §6 (name, owner, payload_schema_url, status, created_at).
 */
export class InvalidKindRegistryError extends Error {
  readonly code = 'invalid_kind_registry' as const
  readonly file: string
  readonly missing: readonly string[]

  constructor(file: string, missing: readonly string[]) {
    super(`registry entry ${file} missing required field(s): ${missing.join(', ')}`)
    this.name = 'InvalidKindRegistryError'
    this.file = file
    this.missing = missing
  }
}
