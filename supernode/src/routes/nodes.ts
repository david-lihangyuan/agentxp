// G1: Node registry routes — /api/v1/nodes/*

import type { Hono } from 'hono'
import type { NodeRegistry } from '../protocol/node-registry'
import { generateChallenge } from '../protocol/node-registry'
import { validatePubkeyMiddleware } from '../validate'
import { parseBody, RegisterNodeBody } from '../schemas'

export interface NodesDeps {
  nodeRegistry: NodeRegistry
}

export function registerNodesRoutes(api: Hono, deps: NodesDeps): void {
  const { nodeRegistry } = deps

  // GET /api/v1/nodes/challenge — issue a registration challenge
  api.get('/nodes/challenge', (c) => {
    const challengeData = generateChallenge()
    return c.json(challengeData)
  })

  // GET /api/v1/nodes — list registered nodes with last_seen and status
  api.get('/nodes', (c) => {
    return c.json({ nodes: nodeRegistry.listWithStatus() })
  })

  // POST /api/v1/nodes/register — register with challenge-response proof
  // Supports both the challenge-response interface (relay_pubkey/challenge/
  // signature/url) and the legacy interface (pubkey/url/challengeSignature).
  api.post('/nodes/register', async (c) => {
    const parsed = await parseBody(c, RegisterNodeBody)
    if (!parsed.ok) return parsed.response

    const result = 'relay_pubkey' in parsed.data
      ? await nodeRegistry.registerWithProof(parsed.data)
      : await nodeRegistry.register(parsed.data)

    if (!result.ok) {
      return c.json({ error: result.error }, 400)
    }

    return c.json({ success: true }, 201)
  })

  // POST /api/v1/nodes/:pubkey/heartbeat — update last_seen
  api.post('/nodes/:pubkey/heartbeat', validatePubkeyMiddleware('pubkey'), (c) => {
    const pubkey = c.req.param('pubkey')
    const result = nodeRegistry.heartbeat(pubkey)
    if (!result.ok) {
      return c.json({ error: result.error }, 404)
    }
    return c.json({ ok: true })
  })
}
