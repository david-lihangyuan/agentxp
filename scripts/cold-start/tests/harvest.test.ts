import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SOQuestion } from '../so-client.js'
import type { SerendipEvent } from '../../../packages/protocol/src/types.js'

// Mocks must be declared before importing the module under test
vi.mock('../so-client.js', () => ({
  fetchQuestions: vi.fn(),
}))

vi.mock('../question-event.js', () => ({
  questionToEvent: vi.fn(),
}))

vi.mock('../publish.js', () => ({
  publishEvent: vi.fn(),
}))

vi.mock('../../../packages/protocol/src/index.js', () => ({
  generateOperatorKey: vi.fn().mockResolvedValue({
    publicKey: 'abcdef1234567890abcdef1234567890',
    privateKey: new Uint8Array(32),
  }),
}))

import { fetchQuestions } from '../so-client.js'
import { questionToEvent } from '../question-event.js'
import { publishEvent } from '../publish.js'
import { main } from '../harvest.js'

const mockFetchQuestions = vi.mocked(fetchQuestions)
const mockQuestionToEvent = vi.mocked(questionToEvent)
const mockPublishEvent = vi.mocked(publishEvent)

function makeQuestion(id: number): SOQuestion {
  return {
    id,
    title: `Question ${id}`,
    body: `Body of question ${id}`,
    tags: ['ai-agent'],
    score: 5,
    link: `https://stackoverflow.com/q/${id}`,
    creation_date: 1700000000,
  }
}

const mockEvent = { id: 'event-1' } as unknown as SerendipEvent

describe('harvest main', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // Default: questionToEvent always returns a mock event
    mockQuestionToEvent.mockResolvedValue(mockEvent)
  })

  it('publishes all successfully fetched questions and returns correct counts', async () => {
    const questions = [makeQuestion(1), makeQuestion(2), makeQuestion(3)]
    mockFetchQuestions.mockResolvedValue(questions)
    mockPublishEvent.mockResolvedValue({ ok: true })

    const result = await main(['--tags=ai-agent', '--limit=10', '--relay=http://localhost:3141'])

    expect(result.published).toBe(3)
    expect(result.skipped).toBe(0)
    expect(result.failed).toBe(0)
    expect(mockPublishEvent).toHaveBeenCalledTimes(3)
  })

  it('skips a tag when fetchQuestions throws and continues with remaining tags', async () => {
    // First tag fails, second tag succeeds
    mockFetchQuestions
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce([makeQuestion(10)])
    mockPublishEvent.mockResolvedValue({ ok: true })

    const result = await main(['--tags=bad-tag,good-tag', '--limit=5', '--relay=http://localhost:3141'])

    expect(result.published).toBe(1)
    expect(result.failed).toBe(0)
    // fetchQuestions called for both tags
    expect(mockFetchQuestions).toHaveBeenCalledTimes(2)
  })

  it('increments failed count when publishEvent returns ok:false', async () => {
    const questions = [makeQuestion(1), makeQuestion(2)]
    mockFetchQuestions.mockResolvedValue(questions)
    mockPublishEvent
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: 'HTTP 500: Internal Server Error' })

    const result = await main(['--tags=ai-agent', '--limit=5', '--relay=http://localhost:3141'])

    expect(result.published).toBe(1)
    expect(result.failed).toBe(1)
  })

  it('increments failed count when questionToEvent throws', async () => {
    mockFetchQuestions.mockResolvedValue([makeQuestion(1)])
    mockQuestionToEvent.mockRejectedValueOnce(new Error('signing error'))

    const result = await main(['--tags=ai-agent', '--limit=5', '--relay=http://localhost:3141'])

    expect(result.published).toBe(0)
    expect(result.failed).toBe(1)
    expect(mockPublishEvent).not.toHaveBeenCalled()
  })
})
