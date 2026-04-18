/**
 * serendip.ts — Thin adapter: LocalReflection → signed SerendipEvent.
 *
 * 2026-04-17 航远+斯文:
 *   Plugin v3 IS a Serendip participant. We depend on `@agentxp/protocol`
 *   for the authoritative event envelope, canonicalization, and signing.
 *   This file does nothing but shape conversion — no custom crypto, no
 *   custom canonicalization.
 */

import {
  createEvent,
  signEvent,
  type SerendipEvent,
  type AgentKey,
} from '@agentxp/protocol';
import * as ed from '@noble/ed25519';

export interface LocalReflection {
  id: number;
  title: string;
  tried: string;
  expected?: string | null;
  outcome: string;
  learned: string;
  why_wrong?: string | null;
  tags: string[];
  visibility: string;
  /** Unix seconds. */
  created_at: number;
}

export type { SerendipEvent };

/**
 * Convert a local reflection into a signed Serendip event.
 *
 * Local-only fields (expected, why_wrong) are intentionally stripped —
 * they are reflection-time context, not part of the shared experience.
 */
export async function toSerendipEvent(
  reflection: LocalReflection,
  agentPrivkey: Uint8Array,
  operatorPubkey: string,
): Promise<SerendipEvent> {
  // Derive agent pubkey from private key
  const pubkeyBytes = await ed.getPublicKeyAsync(agentPrivkey);
  const agentPubkey = Buffer.from(pubkeyBytes).toString('hex');

  // Build AgentKey object expected by @agentxp/protocol.
  // In plugin-v3's current simple identity model, the operator delegated
  // to itself (operator_pubkey === agent pubkey). `expiresAt` is required
  // by the protocol type; we set it far in the future since the plugin
  // does not manage key rotation itself.
  const agentKey: AgentKey = {
    publicKey: agentPubkey,
    privateKey: agentPrivkey,
    delegatedBy: operatorPubkey,
    expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365, // +1y
  };

  // Build unsigned event via protocol helper (includes v:1, default visibility, etc.)
  const unsigned = createEvent(
    'intent.broadcast',
    {
      type: 'experience',
      data: {
        what: reflection.title,
        tried: reflection.tried,
        outcome: reflection.outcome,
        learned: reflection.learned,
        tags: reflection.tags,
        visibility: reflection.visibility,
      },
    },
    reflection.tags,
  );

  // Override fields that createEvent defaults
  const enriched = {
    ...unsigned,
    created_at: reflection.created_at,
    visibility: (reflection.visibility === 'private' ? 'private' : 'public') as 'public' | 'private',
  };

  return signEvent(enriched, agentKey);
}

export type VerificationOutcome = 'confirmed' | 'refuted' | 'partial';

/**
 * Build and sign an `io.agentxp.verification` event. Outcome semantics:
 * `confirmed` — target experience was applied and the session succeeded;
 * `refuted` — target was applied and the session failed;
 * `partial`  — mixed or inconclusive signal.
 *
 * Payload follows the `{ type, data }` envelope accepted by the relay's
 * VerificationPayload schema; `target_event_id` must be the protocol-level
 * id (SHA-256 hex) of the experience being verified.
 */
export async function toVerificationEvent(
  params: {
    targetEventId: string;
    outcome: VerificationOutcome;
    notes?: string;
  },
  agentPrivkey: Uint8Array,
  operatorPubkey: string,
): Promise<SerendipEvent> {
  const pubkeyBytes = await ed.getPublicKeyAsync(agentPrivkey);
  const agentPubkey = Buffer.from(pubkeyBytes).toString('hex');

  const agentKey: AgentKey = {
    publicKey: agentPubkey,
    privateKey: agentPrivkey,
    delegatedBy: operatorPubkey,
    expiresAt: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
  };

  const data: { target_event_id: string; outcome: VerificationOutcome; notes?: string } = {
    target_event_id: params.targetEventId,
    outcome: params.outcome,
  };
  if (params.notes) data.notes = params.notes;

  const unsigned = createEvent(
    'io.agentxp.verification',
    { type: 'verification', data },
    [],
  );

  return signEvent(unsigned, agentKey);
}
