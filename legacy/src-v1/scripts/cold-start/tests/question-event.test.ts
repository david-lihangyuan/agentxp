import { describe, it, expect } from 'vitest'
import { generateOperatorKey, verifyEvent } from '../../../packages/protocol/src/index.js'
import { questionToEvent } from '../question-event.js'
import type { SOQuestion } from '../so-client.js'

const mockQuestion: SOQuestion = {
  id: 12345,
  title: 'How to use TypeScript generics?',
  body: '<p>I want to learn about generics.</p>',
  tags: ['typescript', 'generics'],
  score: 42,
  link: 'https://stackoverflow.com/questions/12345',
  creation_date: 1700000000,
}

describe('questionToEvent', () => {
  it('produces an event with kind intent.question', async () => {
    const key = await generateOperatorKey()
    const event = await questionToEvent(mockQuestion, key)
    expect(event.kind).toBe('intent.question')
  })

  it('embeds question fields in payload.data', async () => {
    const key = await generateOperatorKey()
    const event = await questionToEvent(mockQuestion, key)
    const data = (event.payload as { type: string; data: Record<string, unknown> }).data
    expect(data.source).toBe('stackoverflow')
    expect(data.url).toBe(mockQuestion.link)
    expect(data.title).toBe(mockQuestion.title)
    expect(data.body).toBe(mockQuestion.body)
    expect(data.tags).toEqual(mockQuestion.tags)
    expect(data.score).toBe(mockQuestion.score)
  })

  it('includes question tags in event tags', async () => {
    const key = await generateOperatorKey()
    const event = await questionToEvent(mockQuestion, key)
    expect(event.tags).toEqual(mockQuestion.tags)
  })

  it('produces a valid Ed25519 signature', async () => {
    const key = await generateOperatorKey()
    const event = await questionToEvent(mockQuestion, key)
    const valid = await verifyEvent(event)
    expect(valid).toBe(true)
  })
})
