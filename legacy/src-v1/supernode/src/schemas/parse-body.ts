// parseBody — read+validate a request JSON body against a zod schema.
// On failure returns a pre-built 400 response carrying { error: string };
// on success returns the typed parsed data.

import type { Context } from 'hono'
import { z } from 'zod'

/**
 * Usage:
 *   const parsed = await parseBody(c, PulseOutcomeBody)
 *   if (!parsed.ok) return parsed.response
 *   // parsed.data is fully typed
 */
export async function parseBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return { ok: false, response: c.json({ error: 'invalid JSON' }, 400) }
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue.path.join('.')
    const msg = path ? `${path}: ${issue.message}` : issue.message
    return { ok: false, response: c.json({ error: msg }, 400) }
  }
  return { ok: true, data: parsed.data }
}
