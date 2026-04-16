#!/usr/bin/env tsx
// Cross-Model × 4-Group A/B Test with real engineering tasks
// Groups: A(bare) B(preloaded only) C(reflection only) D(preloaded+reflection)
// Models: Claude Opus, GPT-5.4, Gemini Flash

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename2 = fileURLToPath(import.meta.url)
const EXPERIMENT_DIR = dirname(__filename2)
const TASKS_FILE = join(EXPERIMENT_DIR, 'tasks-real-v1.json')

// Load keys
const configPath = join(process.env.HOME ?? '~', '.openclaw/agents/main/agent/auth-profiles.json')
const profiles = JSON.parse(readFileSync(configPath, 'utf8'))
const OR_KEY = profiles.profiles['openrouter:default'].key

const openclawConfig = JSON.parse(readFileSync(join(process.env.HOME ?? '~', '.openclaw/openclaw.json'), 'utf8'))
const ANTHROPIC_KEY = openclawConfig.models.providers.anthropic.apiKey

// ─── Models ──────────────────────────────────────────────────────────────────

interface ModelConfig {
  id: string
  label: string
  provider: 'openrouter' | 'anthropic'
  model: string
}

const MODELS: ModelConfig[] = [
  { id: 'claude-opus', label: 'Claude Opus 4', provider: 'anthropic', model: 'claude-opus-4-20250514' },
  { id: 'gpt5', label: 'GPT-5.4', provider: 'openrouter', model: 'openai/gpt-5.4' },
  { id: 'gemini-flash', label: 'Gemini Flash', provider: 'openrouter', model: 'google/gemini-2.5-flash' },
]

// Use Claude Sonnet as judge (different from all test models to avoid bias)
const JUDGE_CONFIG: ModelConfig = {
  id: 'judge', label: 'Judge', provider: 'anthropic', model: 'claude-sonnet-4-20250514'
}

// ─── Groups ──────────────────────────────────────────────────────────────────

interface GroupConfig {
  id: string
  label: string
  preloaded: boolean
  reflection: boolean
}

const GROUPS: GroupConfig[] = [
  { id: 'A-bare', label: 'A: Bare model', preloaded: false, reflection: false },
  { id: 'B-preloaded', label: 'B: Preloaded knowledge', preloaded: true, reflection: false },
  { id: 'C-reflection', label: 'C: Reflection only', preloaded: false, reflection: true },
  { id: 'D-full', label: 'D: Full AgentXP', preloaded: true, reflection: true },
]

// ─── API Calls ───────────────────────────────────────────────────────────────

async function callOpenRouter(model: string, prompt: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_completion_tokens: 1500 }),
  })
  const data = await res.json() as any
  if (data.error) throw new Error(`OpenRouter: ${JSON.stringify(data.error)}`)
  return data.choices?.[0]?.message?.content ?? ''
}

async function callAnthropic(model: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
  })
  const data = await res.json() as any
  if (data.error) throw new Error(`Anthropic: ${JSON.stringify(data.error)}`)
  return data.content?.[0]?.text ?? ''
}

async function callLLM(config: ModelConfig, prompt: string): Promise<string> {
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
}

// ─── Task & Judging ──────────────────────────────────────────────────────────

interface Task {
  id: number
  category: string
  source: string
  task: string
  trap: string
  trap_desc: string
  judge_criteria: string
}

async function judgeResponse(task: Task, response: string): Promise<{ passed: boolean; reason: string }> {
  const prompt = `You are a senior security-aware code reviewer. A developer was asked:

"${task.task}"

Their code:
\`\`\`
${response}
\`\`\`

Known vulnerability/trap: "${task.trap_desc}"

Evaluation criteria: ${task.judge_criteria}

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

// ─── Main ────────────────────────────────────────────────────────────────────

interface GroupResult {
  passed: number
  failed: number
  total: number
  rate: string
  byCategory: Record<string, { passed: number; total: number }>
}

interface ModelGroupResults {
  modelId: string
  modelLabel: string
  groups: Record<string, GroupResult>
  details: Array<{
    taskId: number
    category: string
    trap: string
    results: Record<string, { passed: boolean; reason: string }>
  }>
}

async function runTest(model: ModelConfig, group: GroupConfig, tasks: Task[], preloadedText: string): Promise<{
  results: Array<{ taskId: number; passed: boolean; reason: string }>
  reflectionLog: string[]
}> {
  const reflectionLog: string[] = []
  const results: Array<{ taskId: number; passed: boolean; reason: string }> = []

  // Build initial context
  let context = ''
  if (group.preloaded) {
    context = `BEFORE YOU START: Review these lessons from experienced engineers:\n${preloadedText}\n\nApply these lessons to every task.\n\n`
  }
  if (group.reflection && reflectionLog.length > 0) {
    context += `Lessons from your previous tasks in this session:\n${reflectionLog.join('\n')}\n\n`
  }

  for (const task of tasks) {
    // Build prompt with accumulated context
    let prompt = ''
    if (group.preloaded && !group.reflection) {
      prompt = `${context}Task: ${task.task}\n\nWrite ONLY the code solution. No explanation.`
    } else if (group.reflection) {
      let reflectionContext = ''
      if (group.preloaded) {
        reflectionContext = context  // includes preloaded
      }
      if (reflectionLog.length > 0) {
        reflectionContext += `Lessons from your previous tasks in this session:\n${reflectionLog.join('\n')}\n\n`
      }
      prompt = `${reflectionContext}Task: ${task.task}\n\nWrite ONLY the code solution. No explanation.`
    } else {
      prompt = `Task: ${task.task}\n\nWrite ONLY the code solution. No explanation.`
    }

    let response: string
    try {
      response = await callLLM(model, prompt)
    } catch (e: any) {
      response = `// ERROR: ${e.message?.slice(0, 100)}`
    }

    // Reflection step (only for groups C and D)
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
        const lesson = await callLLM(model, reflectPrompt)
        if (lesson.trim()) reflectionLog.push(lesson.trim())
      } catch { /* non-fatal */ }
    }

    // Judge
    const judgment = await judgeResponse(task, response)
    results.push({ taskId: task.id, passed: judgment.passed, reason: judgment.reason })

    await new Promise(r => setTimeout(r, 300))
  }

  return { results, reflectionLog }
}

async function main() {
  const taskData = JSON.parse(readFileSync(TASKS_FILE, 'utf8'))
  const tasks: Task[] = taskData.tasks
  console.log(`\nLoaded ${tasks.length} real-world tasks (${taskData.metadata.categories.join(', ')})`)
  console.log(`Models: ${MODELS.map(m => m.label).join(', ')}`)
  console.log(`Groups: ${GROUPS.map(g => g.label).join(', ')}`)
  console.log(`Judge: ${JUDGE_CONFIG.model}`)
  console.log(`Total runs: ${MODELS.length} × ${GROUPS.length} = ${MODELS.length * GROUPS.length}\n`)

  // Load preloaded knowledge
  const preloadedMistakes = readFileSync(join(EXPERIMENT_DIR, '../../packages/skill/templates/preloaded-mistakes.md'), 'utf8')
  const preloadedLessons = readFileSync(join(EXPERIMENT_DIR, '../../packages/skill/templates/preloaded-lessons.md'), 'utf8')
  const preloadedText = [preloadedMistakes.slice(0, 3000), preloadedLessons.slice(0, 2000)].join('\n')

  const allResults: ModelGroupResults[] = []

  for (const model of MODELS) {
    console.log(`\n${'═'.repeat(60)}`)
    console.log(`MODEL: ${model.label}`)
    console.log(`${'═'.repeat(60)}`)

    const modelResult: ModelGroupResults = {
      modelId: model.id,
      modelLabel: model.label,
      groups: {},
      details: [],
    }

    // Initialize details array
    for (const task of tasks) {
      modelResult.details.push({
        taskId: task.id,
        category: task.category,
        trap: task.trap,
        results: {},
      })
    }

    for (const group of GROUPS) {
      console.log(`\n  ── ${group.label} ──`)

      const { results, reflectionLog } = await runTest(model, group, tasks, preloadedText)

      // Aggregate
      let passed = 0
      const byCategory: Record<string, { passed: number; total: number }> = {}

      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        const task = tasks[i]
        if (r.passed) passed++

        if (!byCategory[task.category]) byCategory[task.category] = { passed: 0, total: 0 }
        byCategory[task.category].total++
        if (r.passed) byCategory[task.category].passed++

        modelResult.details[i].results[group.id] = { passed: r.passed, reason: r.reason }

        const icon = r.passed ? '✅' : '❌'
        process.stdout.write(icon)
      }

      const rate = `${Math.round(passed / tasks.length * 100)}%`
      modelResult.groups[group.id] = { passed, failed: tasks.length - passed, total: tasks.length, rate, byCategory }

      console.log(`\n  ${group.label}: ${rate} (${passed}/${tasks.length})`)

      // Save reflection log
      if (reflectionLog.length > 0) {
        const dir = join(EXPERIMENT_DIR, 'results-real', model.id)
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `${group.id}-reflection.md`), reflectionLog.join('\n'))
      }
    }

    allResults.push(modelResult)
  }

  // ─── Final Summary ───────────────────────────────────────────────────────

  console.log(`\n\n${'═'.repeat(70)}`)
  console.log('CROSS-MODEL × 4-GROUP RESULTS (Real Engineering Tasks)')
  console.log(`${'═'.repeat(70)}\n`)

  // Main table
  console.log('| Model | A: Bare | B: +Preloaded | C: +Reflection | D: Full AgentXP |')
  console.log('|-------|---------|---------------|-----------------|-----------------|')
  for (const r of allResults) {
    const a = r.groups['A-bare']
    const b = r.groups['B-preloaded']
    const c = r.groups['C-reflection']
    const d = r.groups['D-full']
    console.log(`| ${r.modelLabel} | ${a.rate} (${a.passed}/${a.total}) | ${b.rate} (${b.passed}/${b.total}) | ${c.rate} (${c.passed}/${c.total}) | ${d.rate} (${d.passed}/${d.total}) |`)
  }

  // Key insights
  console.log('\n--- Key Insights ---')
  for (const r of allResults) {
    const a = r.groups['A-bare'].passed
    const b = r.groups['B-preloaded'].passed
    const c = r.groups['C-reflection'].passed
    const d = r.groups['D-full'].passed
    console.log(`\n${r.modelLabel}:`)
    console.log(`  Preloaded knowledge alone: ${a} → ${b} (${b > a ? '+' : ''}${b - a})`)
    console.log(`  Reflection alone: ${a} → ${c} (${c > a ? '+' : ''}${c - a})`)
    console.log(`  Full AgentXP: ${a} → ${d} (${d > a ? '+' : ''}${d - a})`)
    console.log(`  Synergy (D - max(B,C)): ${d - Math.max(b, c) > 0 ? '+' : ''}${d - Math.max(b, c)}`)
  }

  // Cross-model insight
  const flash = allResults.find(r => r.modelId === 'gemini-flash')
  const opus = allResults.find(r => r.modelId === 'claude-opus')
  if (flash && opus) {
    console.log('\n--- Cost-Efficiency Insight ---')
    console.log(`Gemini Flash + Full AgentXP: ${flash.groups['D-full'].rate}`)
    console.log(`Claude Opus bare: ${opus.groups['A-bare'].rate}`)
    const flashD = flash.groups['D-full'].passed
    const opusA = opus.groups['A-bare'].passed
    if (flashD >= opusA) {
      console.log(`→ 🎯 Cheap model + AgentXP ≥ Expensive model alone!`)
    } else {
      console.log(`→ Gap: ${opusA - flashD} tasks`)
    }
  }

  // Per-category breakdown
  console.log('\n--- Per-Category Breakdown (Bare → Full AgentXP) ---')
  const categories = [...new Set(tasks.map(t => t.category))]
  for (const cat of categories) {
    const cells = allResults.map(r => {
      const a = r.groups['A-bare'].byCategory[cat] || { passed: 0, total: 0 }
      const d = r.groups['D-full'].byCategory[cat] || { passed: 0, total: 0 }
      return `${r.modelLabel}: ${a.passed}/${a.total}→${d.passed}/${d.total}`
    })
    console.log(`  ${cat}: ${cells.join(' | ')}`)
  }

  // Save full report
  const reportDir = join(EXPERIMENT_DIR, 'results-real')
  mkdirSync(reportDir, { recursive: true })
  writeFileSync(join(reportDir, 'report.json'), JSON.stringify({
    timestamp: new Date().toISOString(),
    metadata: taskData.metadata,
    models: MODELS,
    groups: GROUPS,
    judge: JUDGE_CONFIG.model,
    results: allResults,
  }, null, 2))
  console.log(`\nFull report: ${join(reportDir, 'report.json')}`)
}

main().catch(err => { console.error(err); process.exit(1) })
