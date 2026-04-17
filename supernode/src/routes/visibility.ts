// D3: Operator visibility API — GET/PATCH /api/v1/visibility/:operator_pubkey

import type { Hono } from 'hono'
import type { VisibilityManager } from '../agentxp/visibility'
import { validatePubkeyMiddleware } from '../validate'
import { parseBody, VisibilityBody } from '../schemas'

export interface VisibilityDeps {
  visibilityManager: VisibilityManager
}

export function registerVisibilityRoutes(api: Hono, deps: VisibilityDeps): void {
  const { visibilityManager } = deps

  // GET /api/v1/visibility/:operator_pubkey → { default_visibility }
  api.get('/visibility/:operator_pubkey', validatePubkeyMiddleware('operator_pubkey'), (c) => {
    const operatorPubkey = c.req.param('operator_pubkey')
    const visibility = visibilityManager.getOperatorVisibility(operatorPubkey)
    if (visibility === null) {
      return c.json({ default_visibility: 'public' })
    }
    return c.json({ default_visibility: visibility })
  })

  // PATCH /api/v1/visibility/:operator_pubkey { default_visibility }
  api.patch('/visibility/:operator_pubkey', validatePubkeyMiddleware('operator_pubkey'), async (c) => {
    const operatorPubkey = c.req.param('operator_pubkey')
    const parsed = await parseBody(c, VisibilityBody)
    if (!parsed.ok) return parsed.response
    visibilityManager.setOperatorVisibility(operatorPubkey, parsed.data.default_visibility)
    return c.json({ ok: true, default_visibility: parsed.data.default_visibility })
  })
}
