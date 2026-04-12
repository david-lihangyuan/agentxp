import type { SerendipEvent } from '../../packages/protocol/src/types.js';

export async function publishEvent(
  event: SerendipEvent,
  relayUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`${relayUrl}/api/cold-start/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });

    if (response.ok || response.status === 409) {
      return { ok: true };
    }

    return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}
