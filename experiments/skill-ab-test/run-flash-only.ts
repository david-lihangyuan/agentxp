// Re-run only Gemini Flash with corrected model ID
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename2 = fileURLToPath(import.meta.url)
const EXPERIMENT_DIR = dirname(__filename2)

// Load existing report
const report = JSON.parse(readFileSync(join(EXPERIMENT_DIR, 'results-real/report.json'), 'utf8'))

// Import and patch the main test
const { MODELS, GROUPS } = await import('./run-real-test.ts').catch(() => {
  console.log('Direct import failed, running inline...')
  return { MODELS: null, GROUPS: null }
})

// Just test the API call
const configPath = join(process.env.HOME ?? '~', '.openclaw/agents/main/agent/auth-profiles.json')
const profiles = JSON.parse(readFileSync(configPath, 'utf8'))
const OR_KEY = profiles.profiles['openrouter:default'].key

const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'google/gemini-2.5-flash',
    messages: [{ role: 'user', content: 'Write a Python function that reads a JSON file safely. Code only.' }],
    max_completion_tokens: 500,
  }),
})
const data = await res.json() as any
if (data.error) {
  console.error('API error:', data.error)
  process.exit(1)
}
console.log('Gemini Flash test response (first 200 chars):')
console.log(data.choices?.[0]?.message?.content?.slice(0, 200))
console.log('\n✅ Model ID works. Re-run the full test with: tsx run-real-test.ts')
