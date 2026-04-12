import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as child_process from 'node:child_process';
import { fetchPendingSolutions, verifySolution } from '../verify.js';
import { generateOperatorKey } from '../../../packages/protocol/src/index.js';

// Mock child_process.spawnSync
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawnSync: vi.fn(),
  };
});

const RELAY_URL = 'https://relay.example.com';

function makeSolution(eventId: string, solutionText: string) {
  return {
    event_id: eventId,
    payload: {
      data: {
        solution: solutionText,
      },
    },
  };
}

describe('fetchPendingSolutions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches solutions from relay with correct URL', async () => {
    const mockSolutions = [{ event_id: 'abc12345' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSolutions),
    }));

    const result = await fetchPendingSolutions(RELAY_URL, 10);

    expect(fetch).toHaveBeenCalledWith(
      `${RELAY_URL}/api/cold-start/solutions?status=pending&limit=10`,
    );
    expect(result).toEqual(mockSolutions);
  });

  it('fetches without limit when not specified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }));

    await fetchPendingSolutions(RELAY_URL);

    expect(fetch).toHaveBeenCalledWith(
      `${RELAY_URL}/api/cold-start/solutions?status=pending`,
    );
  });

  it('throws on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));

    await expect(fetchPendingSolutions(RELAY_URL)).rejects.toThrow(
      'Failed to fetch solutions: HTTP 500',
    );
  });
});

describe('verifySolution', () => {
  let operatorKey: { publicKey: string; privateKey: Uint8Array };
  const publishedEvents: unknown[] = [];

  beforeEach(async () => {
    vi.restoreAllMocks();
    publishedEvents.length = 0;
    operatorKey = await generateOperatorKey();

    // Mock fetch for publishEvent calls
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/events')) {
        const body = JSON.parse(init?.body as string);
        publishedEvents.push(body);
        return { ok: true, status: 200, statusText: 'OK' };
      }
      return { ok: true, json: () => Promise.resolve([]) };
    }));
  });

  it('publishes verification.pass when command exits with code 0', async () => {
    const spawnSyncMock = vi.mocked(child_process.spawnSync);
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'all tests passed',
      stderr: '',
      pid: 1234,
      output: ['', 'all tests passed', ''],
      signal: null,
    });

    const solution = makeSolution(
      'abc12345def67890',
      '```js\nconsole.log("hello");\n```\nRun: `node file_0.js`',
    );

    const config = { relayUrl: RELAY_URL, operatorKey };
    const result = await verifySolution(solution, config);

    expect(result.ok).toBe(true);
    expect(result.passed).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalled();

    // Check published event is verification.pass
    expect(publishedEvents.length).toBe(1);
    const event = publishedEvents[0] as Record<string, unknown>;
    expect(event.kind).toBe('verification.pass');
    const payload = event.payload as { type: string; data: { solution_id: string; output: string } };
    expect(payload.type).toBe('verification.pass');
    expect(payload.data.solution_id).toBe('abc12345def67890');
    expect(payload.data.output).toBe('all tests passed');
  });

  it('publishes verification.fail when command exits with non-zero code', async () => {
    const spawnSyncMock = vi.mocked(child_process.spawnSync);
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'Error: test failed',
      pid: 1234,
      output: ['', '', 'Error: test failed'],
      signal: null,
    });

    const solution = makeSolution(
      'fail1234abcd5678',
      '```js\nthrow new Error("bad");\n```\nRun: `node file_0.js`',
    );

    const config = { relayUrl: RELAY_URL, operatorKey };
    const result = await verifySolution(solution, config);

    expect(result.ok).toBe(true);
    expect(result.passed).toBe(false);
    expect(spawnSyncMock).toHaveBeenCalled();

    // Check published event is verification.fail
    expect(publishedEvents.length).toBe(1);
    const event = publishedEvents[0] as Record<string, unknown>;
    expect(event.kind).toBe('verification.fail');
    const payload = event.payload as { type: string; data: { solution_id: string; step_failed: string; error: string } };
    expect(payload.type).toBe('verification.fail');
    expect(payload.data.solution_id).toBe('fail1234abcd5678');
    expect(payload.data.step_failed).toBe('execution');
    expect(payload.data.error).toBe('Error: test failed');
  });

  it('returns error when solution has no text', async () => {
    const solution = {
      event_id: 'empty1234567890a',
      payload: { data: {} },
    };

    const config = { relayUrl: RELAY_URL, operatorKey };
    const result = await verifySolution(solution, config);

    expect(result.ok).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.error).toBe('No solution text found');
  });

  it('extracts npm test command from solution text', async () => {
    const spawnSyncMock = vi.mocked(child_process.spawnSync);
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'tests passed',
      stderr: '',
      pid: 1234,
      output: ['', 'tests passed', ''],
      signal: null,
    });

    const solution = makeSolution(
      'npm12345test6789',
      '```js\nmodule.exports = { add: (a,b) => a+b };\n```\nRun `npm test` to verify.',
    );

    const config = { relayUrl: RELAY_URL, operatorKey };
    await verifySolution(solution, config);

    // Should have called spawnSync with 'npm test'
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'npm test',
      expect.objectContaining({
        shell: true,
        timeout: 30_000,
      }),
    );
  });
});
