// D2 Test Suite: Auto-Classification
// TDD: generic tech → 'public', internal keywords → 'private', uncertain → 'private' (safe default).
import { describe, it, expect } from 'vitest'
import { classify } from '../src/agentxp/classify'

describe('D2: Auto-Classification', () => {
  it('generic technical content classified as public', () => {
    const vis = classify({
      tried: 'docker run --dns 8.8.8.8 nginx',
      learned: 'specify DNS to fix container networking',
      tags: ['docker', 'networking'],
    })
    expect(vis).toBe('public')
  })

  it('internal keywords → private', () => {
    const vis = classify({
      tried: 'called internal Salesforce API at internal.company.com',
      learned: 'needs OAuth refresh',
      tags: ['salesforce', 'internal-api'],
    })
    expect(vis).toBe('private')
  })

  it('uncertain → private (safe default)', () => {
    const vis = classify({
      tried: 'configured custom webhook integration',
      learned: 'works with retries',
      tags: ['webhook'],
    })
    expect(vis).toBe('private')
  })

  it('kubernetes content classified as public', () => {
    const vis = classify({
      tried: 'kubectl apply -f deployment.yaml',
      learned: 'rolling update works with maxSurge=1',
      tags: ['kubernetes'],
    })
    expect(vis).toBe('public')
  })

  it('python content classified as public', () => {
    const vis = classify({
      tried: 'python -m pip install requests',
      learned: 'pip install works in venv',
      tags: ['python'],
    })
    expect(vis).toBe('public')
  })

  it('confidential keyword → private', () => {
    const vis = classify({
      tried: 'accessed confidential report endpoint',
      learned: 'needs special header',
      tags: ['api'],
    })
    expect(vis).toBe('private')
  })

  it('proprietary keyword → private', () => {
    const vis = classify({
      tried: 'integrated with proprietary billing system',
      learned: 'needs vendor key',
      tags: ['billing'],
    })
    expect(vis).toBe('private')
  })

  it('content with both public and private indicators defaults to private', () => {
    const vis = classify({
      tried: 'deployed docker container to internal staging server',
      learned: 'works with custom DNS',
      tags: ['docker', 'internal'],
    })
    expect(vis).toBe('private')
  })

  it('empty content defaults to private', () => {
    const vis = classify({})
    expect(vis).toBe('private')
  })

  it('git content classified as public', () => {
    const vis = classify({
      tried: 'git rebase -i HEAD~3',
      learned: 'interactive rebase squashes commits',
      tags: ['git'],
    })
    expect(vis).toBe('public')
  })

  it('company keyword → private', () => {
    const vis = classify({
      tried: 'deployed to company staging',
      learned: 'needs VPN',
      tags: ['deploy'],
    })
    expect(vis).toBe('private')
  })

  it('what field is considered in classification', () => {
    const vis = classify({
      what: 'docker networking fix',
      tried: 'restarted service',
      learned: 'works',
    })
    expect(vis).toBe('public')
  })
})
