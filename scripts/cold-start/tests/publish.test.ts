import { describe, it, expect, vi, beforeEach } from 'vitest';
import { publishEvent } from '../publish.js';
import type { SerendipEvent } from '../../../packages/protocol/src/types.js';

const mockEvent: SerendipEvent = {
  id: 'test-id-123',
  kind: 'io.agentxp.experience',
  agentId: 'agent-pub-key',
  timestamp: '2026-04-12T00:00:00.000Z',
  payload: { summary: 'test' },
  signature: 'sig',
};

const RELAY_URL = 'https://relay.example.com';

describe('publishEvent', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok:true on 200 success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    }));

    const result = await publishEvent(mockEvent, RELAY_URL);

    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(`${RELAY_URL}/api/cold-start/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockEvent),
    });
  });

  it('returns ok:true on 409 Conflict (duplicate)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
    }));

    const result = await publishEvent(mockEvent, RELAY_URL);

    expect(result).toEqual({ ok: true });
  });

  it('returns ok:false with error on 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }));

    const result = await publishEvent(mockEvent, RELAY_URL);

    expect(result).toEqual({ ok: false, error: 'HTTP 500: Internal Server Error' });
  });

  it('returns ok:false with error message on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));

    const result = await publishEvent(mockEvent, RELAY_URL);

    expect(result).toEqual({ ok: false, error: 'fetch failed' });
  });
});
