// Pulse routes — GET /api/v1/pulse, POST /api/v1/pulse/outcome

import type { Hono } from 'hono'
import type { PulseAPI } from '../agentxp/pulse-api'
import { validatePubkey, parseNonNegInt } from '../validate'
import { parseBody, PulseOutcomeBody } from '../schemas'

export interface PulseDeps {
  pulseAPI: PulseAPI
}

export function registerPulseRoutes(api: Hono, deps: PulseDeps): void {
  const { pulseAPI } = deps

  api.get('/pulse', (c) => {
    const pubkey = c.req.query('pubkey')
    if (!pubkey) {
      return c.json({ error: 'pubkey is required' }, 400)
    }
    const pubkeyCheck = validatePubkey(pubkey)
    if (!pubkeyCheck.valid) {
      return c.json({ error: pubkeyCheck.error }, 400)
    }
    const since = parseNonNegInt(c.req.query('since'), 0)
    const result = pulseAPI.pull({ pubkey, since })
    return c.json(result)
  })

  api.post('/pulse/outcome', async (c) => {
    const parsed = await parseBody(c, PulseOutcomeBody)
    if (!parsed.ok) return parsed.response

    const result = pulseAPI.reportOutcome({
      experienceId: parsed.data.experience_id,
      reporterPubkey: parsed.data.reporter_pubkey,
      outcome: parsed.data.outcome,
      context: parsed.data.context,
    })

    if (!result.ok) {
      return c.json({ error: result.error }, 400)
    }

    return c.json({ ok: true }, 201)
  })
}
