#!/usr/bin/env tsx
// Gemini Flash × 5-Group A/B Test (includes D' selective-context group)
// Model: anthropic/claude-opus-4 (via OpenRouter)
// Groups: A(bare) B(preloaded only) C(reflection only) D(preloaded+reflection) D'(selective context)
// Tasks: tasks-gemini-90.json (90 tasks, 15 per category)
// Judge: Claude Sonnet (Anthropic)
// Concurrency: max 5 simultaneous API calls
//
// D' key insight: instead of dumping all 5000 chars of preloaded knowledge,
// select only the 2-3 most relevant items for the task's category.
// This keeps context under ~1000 words vs D's 5000+ chars.
// Reflection also accumulates per-category; once we have >=2 own lessons,
// we rely on those instead of the preloaded text (learning replaces teaching).

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename2 = fileURLToPath(import.meta.url)
const EXPERIMENT_DIR = dirname(__filename2)
const TASKS_FILE = join(EXPERIMENT_DIR, 'tasks-gemini-90.json')
const RESULTS_DIR = join(EXPERIMENT_DIR, 'results-opus-f-group')

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
  id: 'claude-opus',
  label: 'Claude Opus 4',
  provider: 'openrouter',
  model: 'anthropic/claude-opus-4',
}

const JUDGE_CONFIG: ModelConfig = {
  id: 'judge',
  label: 'Claude Sonnet (Judge)',
  provider: 'openrouter',
  model: 'claude-sonnet-4-20250514',
}

// Max simultaneous requests (test model + judge combined)
const CONCURRENCY_LIMIT = 5

interface GroupConfig {
  id: string
  label: string
  preloaded: boolean
  reflection: boolean
  dprime: boolean
  oneliner?: boolean
  fgroup?: boolean
}

const GROUPS: GroupConfig[] = [
  { id: 'F-selective-oneliner', label: 'F: Selective preload + one-line learned', preloaded: false, reflection: false, dprime: false, oneliner: false, fgroup: true },
]

// ─── Task Type ────────────────────────────────────────────────────────────────

interface Task {
  id: number
  category: string
  trap: string
  task: string
  solution_hint: string
}

// ─── Reflection entry with category tag ──────────────────────────────────────

interface ReflectionEntry {
  category: string
  lesson: string
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

// ─── D' Selective Context ─────────────────────────────────────────────────────

// Mapping: category → which mistake indices (1-based) and lesson indices (1-based) are most relevant
const CATEGORY_KNOWLEDGE_MAP: Record<string, { mistakeIndices: number[]; lessonIndices: number[] }> = {
  'file-io':           { mistakeIndices: [4],    lessonIndices: [3] },
  'input-validation':  { mistakeIndices: [4],    lessonIndices: [3] },
  'network':           { mistakeIndices: [4, 5], lessonIndices: [3, 5] },
  'concurrency':       { mistakeIndices: [1],    lessonIndices: [2] },
  'resource-mgmt':     { mistakeIndices: [4],    lessonIndices: [3] },
  'security':          { mistakeIndices: [4],    lessonIndices: [3] },
}

// Pre-parsed knowledge items (populated in main)
interface KnowledgeItem {
  index: number
  title: string
  body: string
}

let parsedMistakes: KnowledgeItem[] = []
let parsedLessons: KnowledgeItem[] = []

/**
 * Parse numbered sections from markdown.
 * Sections start with "## N. Title" pattern.
 */
function parseNumberedSections(markdown: string): KnowledgeItem[] {
  const items: KnowledgeItem[] = []
  // Split on lines that look like "## N. ..."
  const sectionRegex = /^## (\d+)\. (.+)$/m
  const parts = markdown.split(/(?=^## \d+\. )/m)

  for (const part of parts) {
    const match = part.match(sectionRegex)
    if (!match) continue
    const index = parseInt(match[1], 10)
    const title = match[2].trim()
    // Body = everything after the heading line
    const body = part.replace(/^## \d+\. .+\n/, '').trim()
    items.push({ index, title, body })
  }
  return items
}

/**
 * Select the 2-3 most relevant knowledge items for a given category.
 * Returns a compact text block under ~600 chars.
 */
function selectKnowledgeForCategory(category: string): { text: string; titles: string[] } {
  const mapping = CATEGORY_KNOWLEDGE_MAP[category] ?? { mistakeIndices: [4], lessonIndices: [3] }

  const selectedMistakes = mapping.mistakeIndices
    .map(i => parsedMistakes.find(m => m.index === i))
    .filter(Boolean) as KnowledgeItem[]

  const selectedLessons = mapping.lessonIndices
    .map(i => parsedLessons.find(l => l.index === i))
    .filter(Boolean) as KnowledgeItem[]

  const titles: string[] = []
  const parts: string[] = []

  for (const m of selectedMistakes) {
    // Extract just the Rule line to keep it compact
    const ruleLine = m.body.match(/\*\*Rule:\*\*[^\n]+/)?.[0] ?? m.body.slice(0, 200)
    parts.push(`❌ Mistake #${m.index} — ${m.title}:\n${ruleLine}`)
    titles.push(`Mistake #${m.index}: ${m.title}`)
  }

  for (const l of selectedLessons) {
    // First paragraph of lesson body (the explanation, skip code blocks)
    const firstPara = l.body.split('\n\n')[0].replace(/```[\s\S]*?```/g, '').trim()
    parts.push(`✅ Lesson #${l.index} — ${l.title}:\n${firstPara.slice(0, 300)}`)
    titles.push(`Lesson #${l.index}: ${l.title}`)
  }

  return { text: parts.join('\n\n'), titles }
}

/**
 * Build the D' prompt.
 * Total context target: ~1000 words.
 * Logic:
 *   - If categoryReflections >= 2: use own reflections INSTEAD of preloaded knowledge
 *   - Otherwise: use the 2-3 selected preloaded items
 */
function buildDPrimePrompt(
  task: Task,
  dpReflectionLog: ReflectionEntry[],
): { prompt: string; selectedTitles: string[] } {
  const categoryReflections = dpReflectionLog.filter(r => r.category === task.category)

  let contextBlock = ''
  let selectedTitles: string[] = []

  if (categoryReflections.length >= 2) {
    // Use own accumulated reflections — they've earned it
    contextBlock =
      `Lessons you've already learned from similar ${task.category} tasks:\n` +
      categoryReflections.map(r => `- ${r.lesson}`).join('\n') +
      '\n\nApply these to the task below.\n\n'
    selectedTitles = ['(own reflections)']
  } else {
    // Use the 2-3 selected preloaded items
    const { text, titles } = selectKnowledgeForCategory(task.category)
    contextBlock =
      `Relevant engineering lessons for ${task.category} tasks:\n\n` +
      text +
      '\n\nApply these lessons to the task below.\n\n'
    selectedTitles = titles
  }

  const prompt = `${contextBlock}Task: ${task.task}\n\nWrite ONLY the code solution. No explanation.`
  return { prompt, selectedTitles }
}

// ─── Build Prompt (original groups A–D) ──────────────────────────────────────

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
  selectedContext?: string[]   // D' only: which knowledge items were used
  usedOwnReflections?: boolean // D' only: did we use own reflections vs preloaded?
}

async function runGroup(
  group: GroupConfig,
  tasks: Task[],
  preloadedText: string,
  progressCallback: (done: number, total: number) => void,
): Promise<{ results: TaskResult[]; reflectionLog: string[]; dpReflectionLog: ReflectionEntry[] }> {
  const reflectionLog: string[] = []        // for original groups C, D
  const dpReflectionLog: ReflectionEntry[] = [] // for D' with category tags
  const results: TaskResult[] = []

  // Process tasks sequentially so reflection accumulates correctly
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]

    let response: string
    let selectedTitles: string[] = []
    let usedOwnReflections = false

    if (group.fgroup) {
      // ── F path: selective preload + one-line learned ──────────────────
      // Selective preload from D' (category-matched 2-3 items)
      const { text: preloadText } = selectKnowledgeForCategory(task.category)
      
      let context = `Key lessons for ${task.category} tasks:\n${preloadText}\n\n`
      
      // Plus accumulated one-liner lessons from previous tasks (like E)
      if (reflectionLog.length > 0) {
        context += `Your lessons from earlier tasks:\n${reflectionLog.slice(-10).join('\n')}\n\n`
      }
      
      const prompt = `${context}Task: ${task.task}\n\nWrite ONLY the code solution. No explanation.`

      try {
        response = await callLLM(TEST_MODEL, prompt)
      } catch (e: any) {
        response = `// ERROR: ${e.message?.slice(0, 100)}`
      }

      // One-line reflection (same as E)
      const reflectPrompt = `You just wrote code for: "${task.task}"\nYour code: ${response.slice(0, 500)}\nIn one sentence, what is the key lesson? Reply with ONLY the lesson, nothing else.`

      try {
        const lesson = (await callLLM(TEST_MODEL, reflectPrompt)).trim()
        if (lesson) reflectionLog.push(`- ${lesson}`)
      } catch { /* non-fatal */ }

    } else if (group.oneliner) {
      // ── E path: one-line learned only, no preloaded knowledge ────────────
      let context = ''
      if (reflectionLog.length > 0) {
        context = `Quick reminders from previous tasks:\n${reflectionLog.slice(-10).join('\n')}\n\n`
      }
      const prompt = `${context}Task: ${task.task}\n\nWrite ONLY the code solution. No explanation.`

      try {
        response = await callLLM(TEST_MODEL, prompt)
      } catch (e: any) {
        response = `// ERROR: ${e.message?.slice(0, 100)}`
      }

      const reflectPrompt = `You just wrote code for: "${task.task}"\nYour code: ${response.slice(0, 500)}\nIn one sentence, what is the key lesson? Reply with ONLY the lesson, nothing else.`

      try {
        const lesson = (await callLLM(TEST_MODEL, reflectPrompt)).trim()
        if (lesson) reflectionLog.push(`- ${lesson}`)
      } catch { /* non-fatal */ }

    } else if (group.dprime) {
      // ── D' path ──────────────────────────────────────────────────────────
      const { prompt, selectedTitles: titles } = buildDPrimePrompt(task, dpReflectionLog)
      usedOwnReflections = dpReflectionLog.filter(r => r.category === task.category).length >= 2
      selectedTitles = titles

      try {
        response = await callLLM(TEST_MODEL, prompt)
      } catch (e: any) {
        response = `// ERROR: ${e.message?.slice(0, 100)}`
      }

      // D' reflection: category-tagged, focused on what was ACTUALLY used
      const { text: usedLessonsText } = usedOwnReflections
        ? { text: dpReflectionLog.filter(r => r.category === task.category).map(r => r.lesson).join('; ') }
        : selectKnowledgeForCategory(task.category)

      const reflectPrompt =
        `You just solved a ${task.category} task: "${task.task}"
Your code: ${response.slice(0, 500)}
The specific lessons you were given were: ${usedLessonsText}
In one sentence, what did you learn from THIS task that goes beyond those lessons?
Format: [${task.category}] Your lesson here`

      try {
        const raw = await callLLM(TEST_MODEL, reflectPrompt)
        const lesson = raw.trim()
        if (lesson) {
          dpReflectionLog.push({ category: task.category, lesson })
        }
      } catch { /* non-fatal */ }

    } else {
      // ── Original A/B/C/D path ─────────────────────────────────────────────
      const prompt = buildPrompt(group, task, preloadedText, reflectionLog)

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
    }

    // Judge the response
    const judgment = await judgeResponse(task, response)
    results.push({
      taskId: task.id,
      passed: judgment.passed,
      reason: judgment.reason,
      ...(group.dprime ? { selectedContext: selectedTitles, usedOwnReflections } : {}),
    })

    progressCallback(i + 1, tasks.length)

    // Small polite delay between tasks
    await new Promise(r => setTimeout(r, 200))
  }

  return { results, reflectionLog, dpReflectionLog }
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

  const totalAPICalls = tasks.length * GROUPS.length * 2
  console.log(`\n${'═'.repeat(65)}`)
  console.log("Gemini Flash 5-Group A/B Test (with D' Selective Context)")
  console.log(`${'═'.repeat(65)}`)
  console.log(`Tasks:          ${tasks.length} (${categories.join(', ')})`)
  console.log(`Model:          ${TEST_MODEL.label} (${TEST_MODEL.model})`)
  console.log(`Judge:          ${JUDGE_CONFIG.model}`)
  console.log(`Groups:         ${GROUPS.map(g => g.id).join(', ')}`)
  console.log(`Concurrency:    max ${CONCURRENCY_LIMIT} simultaneous requests`)
  console.log(`Est. API calls: ~${totalAPICalls}+ (${tasks.length} × ${GROUPS.length} groups × code+judge)`)
  console.log(`Output:         ${RESULTS_DIR}/`)
  console.log(`${'═'.repeat(65)}`)
  console.log(``)
  console.log(`D' Design:`)
  console.log(`  - Selects 2-3 most relevant knowledge items per task category`)
  console.log(`  - Context budget: ~1000 words (vs D's 5000+ chars)`)
  console.log(`  - After ≥2 same-category reflections: switches to own lessons`)
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

  // Parse knowledge items for D' selective selection
  parsedMistakes = parseNumberedSections(preloadedMistakes)
  parsedLessons = parseNumberedSections(preloadedLessons)

  console.log(`Parsed knowledge: ${parsedMistakes.length} mistakes, ${parsedLessons.length} lessons`)
  console.log(`D' category mappings:`)
  for (const [cat, mapping] of Object.entries(CATEGORY_KNOWLEDGE_MAP)) {
    console.log(`  ${cat.padEnd(18)}: mistakes [${mapping.mistakeIndices.join(',')}], lessons [${mapping.lessonIndices.join(',')}]`)
  }
  console.log('')

  // Full preloaded text for original groups B and D
  const preloadedText = [preloadedMistakes.slice(0, 3000), preloadedLessons.slice(0, 2000)].join('\n')

  // Prepare results output dir
  mkdirSync(RESULTS_DIR, { recursive: true })

  // Per-task detail array
  const taskDetails: Array<{
    taskId: number
    category: string
    trap: string
    results: Record<string, { passed: boolean; reason: string; selectedContext?: string[]; usedOwnReflections?: boolean }>
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
    if (group.dprime) {
      console.log(`   [D' mode: selective context, category-tagged reflection, self-replace after ≥2 same-cat lessons]`)
    }
    console.log(`   Running ${tasks.length} tasks...`)

    const tracker = makeProgressTracker(group.label, tasks.length)
    const { results, reflectionLog, dpReflectionLog } = await runGroup(group, tasks, preloadedText, tracker)

    const summary = aggregateResults(results, tasks)
    groupSummaries[group.id] = summary
    console.log(`\n   ✓ ${group.label}: ${summary.rate} (${summary.passed}/${summary.total})`)

    // Fill per-task details
    for (let i = 0; i < results.length; i++) {
      taskDetails[i].results[group.id] = {
        passed: results[i].passed,
        reason: results[i].reason,
        ...(group.dprime ? {
          selectedContext: results[i].selectedContext,
          usedOwnReflections: results[i].usedOwnReflections,
        } : {}),
      }
    }

    // Save reflection log if present
    if (reflectionLog.length > 0) {
      writeFileSync(
        join(RESULTS_DIR, `${group.id}-reflection.md`),
        reflectionLog.join('\n'),
      )
    }

    // Save D' category-tagged reflection log
    if (dpReflectionLog.length > 0) {
      const dpLines = dpReflectionLog.map(r => `[${r.category}] ${r.lesson}`)
      writeFileSync(
        join(RESULTS_DIR, `${group.id}-reflection.md`),
        dpLines.join('\n'),
      )

      // Also save per-category breakdown
      const byCat: Record<string, string[]> = {}
      for (const r of dpReflectionLog) {
        if (!byCat[r.category]) byCat[r.category] = []
        byCat[r.category].push(r.lesson)
      }
      writeFileSync(
        join(RESULTS_DIR, `${group.id}-reflection-by-category.json`),
        JSON.stringify(byCat, null, 2),
      )
    }
  }

  // ─── Summary ───────────────────────────────────────────────────────────────

  console.log(`\n\n${'═'.repeat(65)}`)
  console.log("RESULTS — Gemini Flash × 5 Groups (D' Selective Context)")
  console.log(`${'═'.repeat(65)}\n`)

  // Main table
  console.log('| Group              | Passed | Total | Pass Rate |')
  console.log('|--------------------|--------|-------|-----------|')
  for (const group of GROUPS) {
    const s = groupSummaries[group.id]
    console.log(`| ${group.label.padEnd(18)} | ${String(s.passed).padStart(6)} | ${String(s.total).padStart(5)} | ${s.rate.padStart(9)} |`)
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

  // Synergy check (original D)
  const b = groupSummaries['B-preloaded'].passed
  const c = groupSummaries['C-reflection'].passed
  const d = groupSummaries['D-full'].passed
  const dp = groupSummaries["D'-selective"].passed
  const synergy = d - Math.max(b, c)
  const dpVsD = dp - d
  const dpVsBest = dp - Math.max(b, c, d)
  console.log(`\n  Synergy D − max(B,C):   ${synergy >= 0 ? '+' : ''}${synergy} tasks`)
  console.log(`  D' vs D:                ${dpVsD >= 0 ? '+' : ''}${dpVsD} tasks`)
  console.log(`  D' vs best(B,C,D):      ${dpVsBest >= 0 ? '+' : ''}${dpVsBest} tasks`)

  // Per-category breakdown (all 5 groups)
  console.log('\n── Per-Category Breakdown ──')
  console.log(`${'Category'.padEnd(18)} | A    | B    | C    | D    | D'   `)
  console.log(`${'─'.repeat(18)}-+------+------+------+------+------`)
  for (const cat of categories) {
    const a = groupSummaries['A-bare'].byCategory[cat] ?? { passed: 0, total: 0 }
    const bCat = groupSummaries['B-preloaded'].byCategory[cat] ?? { passed: 0, total: 0 }
    const cCat = groupSummaries['C-reflection'].byCategory[cat] ?? { passed: 0, total: 0 }
    const dCat = groupSummaries['D-full'].byCategory[cat] ?? { passed: 0, total: 0 }
    const dpCat = groupSummaries["D'-selective"].byCategory[cat] ?? { passed: 0, total: 0 }
    const fmt = (x: { passed: number; total: number }) => `${x.passed}/${x.total}`.padStart(4)
    console.log(`${cat.padEnd(18)} | ${fmt(a)} | ${fmt(bCat)} | ${fmt(cCat)} | ${fmt(dCat)} | ${fmt(dpCat)}`)
  }

  // ─── Save Report ───────────────────────────────────────────────────────────

  const report = {
    timestamp: new Date().toISOString(),
    metadata: taskData.metadata,
    model: TEST_MODEL,
    judge: JUDGE_CONFIG.model,
    groups: GROUPS,
    concurrency_limit: CONCURRENCY_LIMIT,
    dprime_design: {
      description: "Selective context: 2-3 relevant items per category vs full 5000-char dump",
      context_budget_chars: 1000,
      category_mappings: CATEGORY_KNOWLEDGE_MAP,
      self_replace_threshold: 2,
    },
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
