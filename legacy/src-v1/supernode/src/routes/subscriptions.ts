// Subscription routes — GET/POST /api/v1/subscriptions

import type { Hono } from 'hono'
import type { SubscriptionManager } from '../agentxp/subscriptions'
import { parseBody, SubscriptionBody } from '../schemas'

export interface SubscriptionsDeps {
  subscriptionManager: SubscriptionManager
}

export function registerSubscriptionsRoutes(api: Hono, deps: SubscriptionsDeps): void {
  const { subscriptionManager } = deps

  api.post('/subscriptions', async (c) => {
    const parsed = await parseBody(c, SubscriptionBody)
    if (!parsed.ok) return parsed.response

    const result = subscriptionManager.subscribe({
      pubkey: parsed.data.pubkey,
      operatorPubkey: parsed.data.operator_pubkey ?? parsed.data.pubkey,
      query: parsed.data.query,
      tags: parsed.data.tags,
    })

    if (!result.ok) {
      return c.json({ error: result.error }, 400)
    }

    return c.json({ ok: true, id: result.id }, 201)
  })

  api.get('/subscriptions', (c) => {
    const operatorPubkey = c.req.query('operator_pubkey')
    const pubkey = c.req.query('pubkey')

    if (!operatorPubkey && !pubkey) {
      return c.json({ error: 'operator_pubkey or pubkey required' }, 400)
    }

    const subs = operatorPubkey
      ? subscriptionManager.listForOperator(operatorPubkey)
      : subscriptionManager.listForPubkey(pubkey!)

    return c.json({ subscriptions: subs })
  })
}
