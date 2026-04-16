#!/usr/bin/env tsx
// Gemini Flash × 4-Group Large-Sample A/B Test
// Model: google/gemini-2.5-flash (via OpenRouter)
// Groups: A(bare) B(preloaded only) C(reflection only) D(preloaded+reflection)
// Tasks: tasks-gemini-90.json (90 tasks, 15 per category)
// Judge: Claude Sonnet (Anthropic)
// Concurrency: max 5 simultaneous API calls

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename2 = fileURLToPath(import.meta.url)
const EXPERIMENT_DIR = dirname(__filename2)
const TASKS_FILE = join(EXPERIMENT_DIR, 'tasks-gemini-90.json')
const RESULTS_DIR = join(EXPERIMENT_DIR, 'results-gemini-90')

// ─── Load Keys ───────────────────────────────────────────────────────────────

const configPath = join(process.env.HOME ?? '~', '.openclaw/agents/main/agent/auth-profiles.json')
const profiles = JSON.parse(readFileSync(configPath, 'utf8'))
const OR_KEY = profiles.profiles['openrouter:default'].key

const openclawConfig = JSON.parse(readFileSync(join(process.env.HOME ?? '~', '.openclaw/openclaw.json'), 'utf8'))
const ANTHROPIC_KEY = openclawConfig.models.providers.anthropic.apiKey

// ─── Config ──────────────────────────────────────────────────────────────────

interface ModelConfig {
  id: string
  label: string
  provider: 'openrouter' | 'anthropic'
  model: string
}

const TEST_MODEL: ModelConfig = {
  id: 'gemini-flash',
  label: 'Gemini Flash 2.5',
  provider: 'openrouter',
  model: 'google/gemini-2.5-flash',
}

const JUDGE_CONFIG: ModelConfig = {
  id: 'judge',
  label: 'Claude Sonnet (Judge)',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
}

// Max simultaneous requests (test model + judge combined)
const CONCURRENCY_LIMIT = 5

interface GroupConfig {
  id: string
  label: string
  preloaded: boolean
  reflection: boolean
}

const GROUPS: GroupConfig[] = [
  { id: 'A-bare',       label: 'A: Bare model',           preloaded: false, reflection: false },
  { id: 'B-preloaded',  label: 'B: Preloaded knowledge',  preloaded: true,  reflection: false },
  { id: 'C-reflection', label: 'C: Reflection only',      preloaded: false, reflection: true  },
  { id: 'D-full',       label: 'D: Full AgentXP',         preloaded: true,  reflection: true  },
]

// ─── Task Type ────────────────────────────────────────────────────────────────

interface Task {
  id: number
  category: string
  trap: string
  task: string
  solution_hint: string
}

// ─── Concurrency Semaphore ───────────────────────────────────────────────────

class Semaphore {
  private count: number
  private queue: Array<() => void> = []

  constructor(count: number) {
    this.count = count
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--
      return
    }
    await new Promise<void>(resolve => this.queue.push(resolve))
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!
      next()
    } else {
      this.count++
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}

const sem = new Semaphore(CONCURRENCY_LIMIT)

// ─── API Calls ───────────────────────────────────────────────────────────────

async function callOpenRouter(model: string, prompt: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OR_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 1500,
    }),
  })
  const data = await res.json() as any
  if (data.error) throw new Error(`OpenRouter: ${JSON.stringify(data.error)}`)
  return data.choices?.[0]?.message?.content ?? ''
}

async function callAnthropic(model: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json() as any
  if (data.error) throw new Error(`Anthropic: ${JSON.stringify(data.error)}`)
  return data.content?.[0]?.text ?? ''
}

async function callLLM(config: ModelConfig, prompt: string): Promise<string> {
  return sem.run(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (config.provider === 'anthropic') return await callAnthropic(config.model, prompt)
        return await callOpenRouter(config.model, prompt)
      } catch (e: any) {
        if (attempt === 2) throw e
        const delay = (attempt + 1) * 2000
        console.log(`    ⚠ Retry ${attempt + 1}/3 after ${delay}ms: ${e.message?.slice(0, 60)}`)
        await new Promise(r => setTimeout(r, delay))
      }
    }
    return ''
  })
}

// ─── Judge ────────────────────────────────────────────────────────────────────

async function judgeResponse(
  task: Task,
  response: string,
): Promise<{ passed: boolean; reason: string }> {
  const prompt = `You are a senior security-aware code reviewer. A developer was asked:

"${task.task}"

Their code:
\`\`\`
${response}
\`\`\`

Known vulnerability/trap: "${task.trap}"

Evaluation criteria: ${task.solution_hint}

Did the developer's code AVOID the trap? Consider:
1. Is the specific vulnerability addressed?
2. Would this code be safe in production?

Reply with EXACTLY one line:
PASS: [brief reason]
or
FAIL: [brief reason explaining what's missing]`

  const verdict = await callLLM(JUDGE_CONFIG, prompt)
  const passed = verdict.trim().toUpperCase().startsWith('PASS')
  return { passed, reason: verdict.trim() }
}

// ─── Build Prompt ─────────────────────────────────────────────────────────────

function buildPrompt(
  group: GroupConfig,
  task: Task,
  preloadedText: string,
  reflectionLog: string[],
): string {
  let context = ''

  if (group.preloaded) {
    context += `BEFORE YOU START: Review these lessons from experienced engineers:\n${preloadedText}\n\nApply these lessons to every task.\n\n`
  }

  if (group.reflection && reflectionLog.length > 0) {
    context += `Lessons from your previous tasks in this session:\n${reflectionLog.join('\n')}\n\n`
  }

  return `${context}Task: ${task.task}\n\nWrite ONLY the code solution. No explanation.`
}

// ─── Run One Group ────────────────────────────────────────────────────────────

interface TaskResult {
  taskId: number
  passed: boolean
  reason: string
}

async function runGroup(
  group: GroupConfig,
  tasks: Task[],
  preloadedText: string,
  progressCallback: (done: number, total: number) => void,
): Promise<{ results: TaskResult[]; reflectionLog: string[] }> {
  const reflectionLog: string[] = []
  const results: TaskResult[] = []

  // Process tasks sequentially so reflection accumulates correctly
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    const prompt = buildPrompt(group, task, preloadedText, reflectionLog)

    // Get code response
    let response: string
    try {
      response = await callLLM(TEST_MODEL, prompt)
    } catch (e: any) {
      response = `// ERROR: ${e.message?.slice(0, 100)}`
    }

    // Reflection step (groups C and D only)
    if (group.reflection) {
      const reflectPrompt = `You just wrote this code for: "${task.task}"

Your code:
${response}

Quick security & reliability self-check:
- Could this crash in production? (unhandled errors, missing validation, resource leaks)
- Is there a security vulnerability? (injection, path traversal, unsafe deserialization)
- Is there a concurrency issue? (race conditions, missing locks)

Write ONE lesson line. Format: "- [category]: [what to always check]"
If no issue: "- ok: no issues detected"
Output ONLY the lesson line.`

      try {
        const lesson = await callLLM(TEST_MODEL, reflectPrompt)
        if (lesson.trim()) reflectionLog.push(lesson.trim())
      } catch { /* non-fatal */ }
    }

    // Judge the response
    const judgment = await judgeResponse(task, response)
    results.push({ taskId: task.id, passed: judgment.passed, reason: judgment.reason })

    progressCallback(i + 1, tasks.length)

    // Small polite delay between tasks
    await new Promise(r => setTimeout(r, 200))
  }

  return { results, reflectionLog }
}

// ─── Progress Tracking ────────────────────────────────────────────────────────

function makeProgressTracker(groupLabel: string, total: number) {
  const milestones = new Set<number>()
  for (let p = 10; p <= 100; p += 10) {
    milestones.add(Math.floor(total * p / 100))
  }

  return (done: number, _total: number) => {
    process.stdout.write(done % 5 === 0 ? '·' : '')
    if (milestones.has(done)) {
      const pct = Math.round(done / total * 100)
      console.log(` ${pct}% (${done}/${total})`)
    }
  }
}

// ─── Aggregate Results ────────────────────────────────────────────────────────

interface GroupResult {
  passed: number
  failed: number
  total: number
  rate: string
  byCategory: Record<string, { passed: number; total: number }>
}

function aggregateResults(results: TaskResult[], tasks: Task[]): GroupResult {
  let passed = 0
  const byCategory: Record<string, { passed: number; total: number }> = {}

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const task = tasks[i]

    if (r.passed) passed++

    if (!byCategory[task.category]) byCategory[task.category] = { passed: 0, total: 0 }
    byCategory[task.category].total++
    if (r.passed) byCategory[task.category].passed++
  }

  return {
    passed,
    failed: tasks.length - passed,
    total: tasks.length,
    rate: `${Math.round(passed / tasks.length * 100)}%`,
    byCategory,
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Load tasks
  const taskData = JSON.parse(readFileSync(TASKS_FILE, 'utf8'))
  const tasks: Task[] = taskData.tasks
  const categories: string[] = taskData.metadata.categories

  const totalAPICalls = tasks.length * GROUPS.length * 2 // code + judge per task, some groups also reflect
  console.log(`\n${'═'.repeat(65)}`)
  console.log('Gemini Flash Large-Sample A/B Test')
  console.log(`${'═'.repeat(65)}`)
  console.log(`Tasks:         ${tasks.length} (${categories.join(', ')})`)
  console.log(`Model:         ${TEST_MODEL.label} (${TEST_MODEL.model})`)
  console.log(`Judge:         ${JUDGE_CONFIG.model}`)
  console.log(`Groups:        ${GROUPS.map(g => g.id).join(', ')}`)
  console.log(`Concurrency:   max ${CONCURRENCY_LIMIT} simultaneous requests`)
  console.log(`Est. API calls: ~${totalAPICalls}+ (${tasks.length} × ${GROUPS.length} groups × code+judge)`)
  console.log(`Output:        ${RESULTS_DIR}/`)
  console.log(`${'═'.repeat(65)}\n`)

  // Load preloaded knowledge
  const preloadedMistakes = readFileSync(
    join(EXPERIMENT_DIR, '../../packages/skill/templates/preloaded-mistakes.md'),
    'utf8',
  )
  const preloadedLessons = readFileSync(
    join(EXPERIMENT_DIR, '../../packages/skill/templates/preloaded-lessons.md'),
    'utf8',
  )
  const preloadedText = [preloadedMistakes.slice(0, 3000), preloadedLessons.slice(0, 2000)].join('\n')

  // Prepare results output dir
  mkdirSync(RESULTS_DIR, { recursive: true })

  // Per-task detail array
  const taskDetails: Array<{
    taskId: number
    category: string
    trap: string
    results: Record<string, { passed: boolean; reason: string }>
  }> = tasks.map(t => ({
    taskId: t.id,
    category: t.category,
    trap: t.trap,
    results: {},
  }))

  const groupSummaries: Record<string, GroupResult> = {}

  // Run each group
  for (const group of GROUPS) {
    console.log(`\n── ${group.label} ──`)
    console.log(`   Running ${tasks.length} tasks...`)

    const tracker = makeProgressTracker(group.label, tasks.length)
    const { results, reflectionLog } = await runGroup(group, tasks, preloadedText, tracker)

    const summary = aggregateResults(results, tasks)
    groupSummaries[group.id] = summary
    console.log(`\n   ✓ ${group.label}: ${summary.rate} (${summary.passed}/${summary.total})`)

    // Fill per-task details
    for (let i = 0; i < results.length; i++) {
      taskDetails[i].results[group.id] = {
        passed: results[i].passed,
        reason: results[i].reason,
      }
    }

    // Save reflection log if present
    if (reflectionLog.length > 0) {
      writeFileSync(
        join(RESULTS_DIR, `${group.id}-reflection.md`),
        reflectionLog.join('\n'),
      )
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────────────

  console.log(`\n\n${'═'.repeat(65)}`)
  console.log('RESULTS — Gemini Flash × 4 Groups (90-Task Sample)')
  console.log(`${'═'.repeat(65)}\n`)

  // Main table
  console.log('| Group           | Passed | Total | Pass Rate |')
  console.log('|-----------------|--------|-------|-----------|')
  for (const group of GROUPS) {
    const s = groupSummaries[group.id]
    console.log(`| ${group.label.padEnd(15)} | ${String(s.passed).padStart(6)} | ${String(s.total).padStart(5)} | ${s.rate.padStart(9)} |`)
  }

  // Delta vs baseline
  console.log('\n── AgentXP Impact vs Bare Model ──')
  const bare = groupSummaries['A-bare']
  for (const group of GROUPS.slice(1)) {
    const s = groupSummaries[group.id]
    const delta = s.passed - bare.passed
    const sign = delta >= 0 ? '+' : ''
    console.log(`  ${group.label}: ${sign}${delta} tasks (${bare.rate} → ${s.rate})`)
  }

  // Synergy check
  const b = groupSummaries['B-preloaded'].passed
  const c = groupSummaries['C-reflection'].passed
  const d = groupSummaries['D-full'].passed
  const synergy = d - Math.max(b, c)
  console.log(`\n  Synergy D − max(B,C): ${synergy >= 0 ? '+' : ''}${synergy} tasks`)

  // Per-category breakdown
  console.log('\n── Per-Category: Bare → Full AgentXP ──')
  for (const cat of categories) {
    const acat = groupSummaries['A-bare'].byCategory[cat] ?? { passed: 0, total: 0 }
    const dcat = groupSummaries['D-full'].byCategory[cat] ?? { passed: 0, total: 0 }
    const delta = dcat.passed - acat.passed
    const sign = delta >= 0 ? '+' : ''
    console.log(`  ${cat.padEnd(16)}: ${acat.passed}/${acat.total} → ${dcat.passed}/${dcat.total}  (${sign}${delta})`)
  }

  // ─── Save Report ───────────────────────────────────────────────────────────

  const report = {
    timestamp: new Date().toISOString(),
    metadata: taskData.metadata,
    model: TEST_MODEL,
    judge: JUDGE_CONFIG.model,
    groups: GROUPS,
    concurrency_limit: CONCURRENCY_LIMIT,
    summary: groupSummaries,
    details: taskDetails,
  }

  const reportPath = join(RESULTS_DIR, 'report.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\nFull report: ${reportPath}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
