#!/usr/bin/env npx tsx
// Cross-Model A/B Test: AgentXP Reflection Skill effectiveness across different LLMs
// Tests 3 models × 2 conditions = 6 groups

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename2 = fileURLToPath(import.meta.url)
const EXPERIMENT_DIR = dirname(__filename2)
const TASKS_FILE = join(EXPERIMENT_DIR, 'tasks-v3.json')

// Load OpenRouter key
const configPath = join(process.env.HOME ?? '~', '.openclaw/agents/main/agent/auth-profiles.json')
const profiles = JSON.parse(readFileSync(configPath, 'utf8'))
const OR_KEY = profiles.profiles['openrouter:default'].key

// Load Anthropic key for direct Claude calls
const openclawConfig = JSON.parse(readFileSync(join(process.env.HOME ?? '~', '.openclaw/openclaw.json'), 'utf8'))
const ANTHROPIC_KEY = openclawConfig.models.providers.anthropic.apiKey

// ─── Models to test ──────────────────────────────────────────────────────────

interface ModelConfig {
  id: string
  label: string
  provider: 'openrouter' | 'anthropic'
  model: string
}

const MODELS: ModelConfig[] = [
  {
    id: 'claude-opus',
    label: 'Claude Opus 4',
    provider: 'anthropic',
    model: 'claude-opus-4-20250514',
  },
  {
    id: 'gpt5',
    label: 'GPT-5.4',
    provider: 'openrouter',
    model: 'openai/gpt-5.4',
  },
  {
    id: 'gemini-flash',
    label: 'Gemini Flash',
    provider: 'openrouter',
    model: 'google/gemini-2.5-flash-preview',
  },
]

// Use GPT-5.4 as judge (same as original test) for consistency
const JUDGE_MODEL = 'openai/gpt-5.4'

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
      max_completion_tokens: 1000,
    }),
  })
  const data = await res.json() as any
  if (data.error) throw new Error(`OpenRouter error: ${JSON.stringify(data.error)}`)
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
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json() as any
  if (data.error) throw new Error(`Anthropic error: ${JSON.stringify(data.error)}`)
  return data.content?.[0]?.text ?? ''
}

async function callLLM(config: ModelConfig, prompt: string): Promise<string> {
  if (config.provider === 'anthropic') {
    return callAnthropic(config.model, prompt)
  }
  return callOpenRouter(config.model, prompt)
}

async function callJudge(prompt: string): Promise<string> {
  return callOpenRouter(JUDGE_MODEL, prompt)
}

// ─── Task & Judging ──────────────────────────────────────────────────────────

interface Task {
  id: number
  task: string
  trap: string
  trap_desc: string
  expected: string | null
}

async function judgeResponse(task: Task, response: string): Promise<{ passed: boolean; reason: string }> {
  if (!task.trap || task.trap === 'none') {
    return { passed: true, reason: 'No trap in this task' }
  }

  const judgePrompt = `You are a code reviewer. A developer was asked to do this task:

"${task.task}"

Their response:
${response}

The known trap in this task: "${task.trap_desc}"
Trap type: "${task.trap}"

Did the developer AVOID the trap? Specifically:
- For "division-by-zero": did they check for zero divisor before dividing?
- For "untrusted-input": did they validate/sanitize user input before using it?
- For "missing-resource": did they check the resource exists before using it?
- For "deep-null-access": did they use optional chaining or null checks on nested object access?
- For "dangerous-operation": did they validate the argument exists and is safe before the destructive operation?

Reply with EXACTLY one line:
PASS: [reason]
or
FAIL: [reason]`

  const verdict = await callJudge(judgePrompt)
  const passed = verdict.trim().toUpperCase().startsWith('PASS')
  return { passed, reason: verdict.trim() }
}

// ─── Main ────────────────────────────────────────────────────────────────────

interface ModelResult {
  modelId: string
  modelLabel: string
  withSkill: { passed: number; failed: number; total: number; rate: string }
  withoutSkill: { passed: number; failed: number; total: number; rate: string }
  byTrap: Record<string, { withSkill: number; withoutSkill: number; total: number }>
  details: Array<{
    taskId: number
    trap: string
    withSkill: { passed: boolean; reason: string }
    withoutSkill: { passed: boolean; reason: string }
  }>
}

async function runModelTest(config: ModelConfig, tasks: Task[]): Promise<ModelResult> {
  const resultsDir = join(EXPERIMENT_DIR, 'results-cross-model', config.id)
  mkdirSync(join(resultsDir, 'with-skill'), { recursive: true })
  mkdirSync(join(resultsDir, 'without-skill'), { recursive: true })

  // Load preloaded experiences (same as original test)
  const preloadedMistakes = readFileSync(join(EXPERIMENT_DIR, '../../packages/skill/templates/preloaded-mistakes.md'), 'utf8')
  const preloadedLessons = readFileSync(join(EXPERIMENT_DIR, '../../packages/skill/templates/preloaded-lessons.md'), 'utf8')
  const reflectionLog: string[] = [
    'PRE-LOADED KNOWLEDGE (from AgentXP Skill installation):',
    preloadedMistakes.slice(0, 3000),
    preloadedLessons.slice(0, 2000),
  ]

  const details: ModelResult['details'] = []
  const byTrap: Record<string, { withSkill: number; withoutSkill: number; total: number }> = {}
  let skillPass = 0, noSkillPass = 0

  for (const task of tasks) {
    console.log(`  [${config.id}] Task ${task.id}/${tasks.length} (trap: ${task.trap})`)

    // === Agent WITH skill ===
    const skillContext = reflectionLog.length > 0
      ? `BEFORE YOU START: Review lessons from past tasks:\n${reflectionLog.join('\n')}\n\nApply these lessons to the current task.\n\n`
      : ''

    const skillPrompt = `${skillContext}Task: ${task.task}\n\nWrite ONLY the code/command solution. No explanation.`

    let skillResponse: string
    try {
      skillResponse = await callLLM(config, skillPrompt)
    } catch (e: any) {
      console.log(`    ⚠ Skill call failed: ${e.message?.slice(0, 80)}`)
      skillResponse = '// ERROR: API call failed'
    }
    writeFileSync(join(resultsDir, 'with-skill', `task-${task.id}.txt`), skillResponse)

    // Reflection step
    if (task.trap && task.trap !== 'none') {
      const reflectPrompt = `You just wrote this code for a task: "${task.task}"

Your code:
${skillResponse}

Quick self-check: Is there a potential runtime error? Specifically:
- If the task mentions a file/URL/env-var that might not exist, did you handle that?
- Could this crash in production?

Write ONE lesson line. Format: "- [category]: [what to always check]"
If no issue found, write: "- ok: no issues detected"
Output ONLY the lesson line.`

      try {
        const lesson = await callLLM(config, reflectPrompt)
        if (lesson.trim()) reflectionLog.push(lesson.trim())
      } catch {
        // Reflection failure is non-fatal
      }
    }

    // === Agent WITHOUT skill ===
    const noSkillPrompt = `Task: ${task.task}\n\nWrite ONLY the code/command solution. No explanation.`
    let noSkillResponse: string
    try {
      noSkillResponse = await callLLM(config, noSkillPrompt)
    } catch (e: any) {
      console.log(`    ⚠ No-skill call failed: ${e.message?.slice(0, 80)}`)
      noSkillResponse = '// ERROR: API call failed'
    }
    writeFileSync(join(resultsDir, 'without-skill', `task-${task.id}.txt`), noSkillResponse)

    // === Judge both ===
    const skillJudge = await judgeResponse(task, skillResponse)
    const noSkillJudge = await judgeResponse(task, noSkillResponse)

    if (skillJudge.passed) skillPass++
    if (noSkillJudge.passed) noSkillPass++

    // Track by trap type
    if (!byTrap[task.trap]) byTrap[task.trap] = { withSkill: 0, withoutSkill: 0, total: 0 }
    byTrap[task.trap].total++
    if (skillJudge.passed) byTrap[task.trap].withSkill++
    if (noSkillJudge.passed) byTrap[task.trap].withoutSkill++

    details.push({
      taskId: task.id,
      trap: task.trap,
      withSkill: { passed: skillJudge.passed, reason: skillJudge.reason },
      withoutSkill: { passed: noSkillJudge.passed, reason: noSkillJudge.reason },
    })

    const sIcon = skillJudge.passed ? '✅' : '❌'
    const nIcon = noSkillJudge.passed ? '✅' : '❌'
    console.log(`    Skill: ${sIcon}  No-skill: ${nIcon}`)

    // Rate limit: small delay between tasks
    await new Promise(r => setTimeout(r, 500))
  }

  // Save reflection log
  writeFileSync(join(resultsDir, 'with-skill', 'reflection.md'), reflectionLog.join('\n'))

  return {
    modelId: config.id,
    modelLabel: config.label,
    withSkill: {
      passed: skillPass,
      failed: tasks.length - skillPass,
      total: tasks.length,
      rate: `${Math.round(skillPass / tasks.length * 100)}%`,
    },
    withoutSkill: {
      passed: noSkillPass,
      failed: tasks.length - noSkillPass,
      total: tasks.length,
      rate: `${Math.round(noSkillPass / tasks.length * 100)}%`,
    },
    byTrap,
    details,
  }
}

async function main() {
  const tasks: Task[] = JSON.parse(readFileSync(TASKS_FILE, 'utf8')).tasks
  console.log(`\nLoaded ${tasks.length} tasks`)
  console.log(`Testing ${MODELS.length} models: ${MODELS.map(m => m.label).join(', ')}`)
  console.log(`Judge: ${JUDGE_MODEL}\n`)

  const allResults: ModelResult[] = []

  for (const model of MODELS) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`MODEL: ${model.label} (${model.model})`)
    console.log(`${'='.repeat(60)}\n`)

    const result = await runModelTest(model, tasks)
    allResults.push(result)

    console.log(`\n  ${model.label}: With skill ${result.withSkill.rate} (${result.withSkill.passed}/${result.withSkill.total}) | Without ${result.withoutSkill.rate} (${result.withoutSkill.passed}/${result.withoutSkill.total})`)
  }

  // ─── Final Summary ───────────────────────────────────────────────────────

  console.log(`\n\n${'='.repeat(60)}`)
  console.log('CROSS-MODEL RESULTS')
  console.log(`${'='.repeat(60)}\n`)

  // Summary table
  console.log('| Model | Without AgentXP | With AgentXP | Improvement |')
  console.log('|-------|----------------|--------------|-------------|')
  for (const r of allResults) {
    const improvement = r.withSkill.passed - r.withoutSkill.passed
    const improvPct = r.withoutSkill.passed > 0
      ? `+${Math.round((improvement / r.withoutSkill.passed) * 100)}%`
      : `+${improvement}`
    console.log(`| ${r.modelLabel} | ${r.withoutSkill.rate} (${r.withoutSkill.passed}/${r.withoutSkill.total}) | ${r.withSkill.rate} (${r.withSkill.passed}/${r.withSkill.total}) | ${improvPct} |`)
  }

  // Per-trap breakdown
  console.log('\nPer-trap breakdown:')
  const allTraps = [...new Set(tasks.map(t => t.trap))]
  console.log(`| Trap Type | ${MODELS.map(m => `${m.label} (no/yes)`).join(' | ')} |`)
  console.log(`|-----------|${MODELS.map(() => '-------------|').join('')}`)
  for (const trap of allTraps) {
    const cells = allResults.map(r => {
      const t = r.byTrap[trap] || { withSkill: 0, withoutSkill: 0, total: 0 }
      return `${t.withoutSkill}/${t.total} → ${t.withSkill}/${t.total}`
    })
    console.log(`| ${trap} | ${cells.join(' | ')} |`)
  }

  // Key insight: does AgentXP help cheap models catch up?
  const cheapModel = allResults.find(r => r.modelId === 'gemini-flash')
  const expensiveModel = allResults.find(r => r.modelId === 'claude-opus')
  if (cheapModel && expensiveModel) {
    console.log('\n--- Key Insight ---')
    console.log(`Gemini Flash + AgentXP: ${cheapModel.withSkill.rate}`)
    console.log(`Claude Opus without AgentXP: ${expensiveModel.withoutSkill.rate}`)
    if (cheapModel.withSkill.passed >= expensiveModel.withoutSkill.passed) {
      console.log(`→ Cheap model + AgentXP ≥ Expensive model alone! 🎯`)
    } else {
      const gap = expensiveModel.withoutSkill.passed - cheapModel.withSkill.passed
      console.log(`→ Gap remaining: ${gap} tasks (${Math.round(gap / tasks.length * 100)}%)`)
    }
  }

  // Save full report
  const reportDir = join(EXPERIMENT_DIR, 'results-cross-model')
  mkdirSync(reportDir, { recursive: true })
  writeFileSync(join(reportDir, 'report.json'), JSON.stringify({
    timestamp: new Date().toISOString(),
    models: MODELS.map(m => ({ id: m.id, label: m.label, model: m.model })),
    judge: JUDGE_MODEL,
    taskCount: tasks.length,
    results: allResults,
  }, null, 2))
  console.log(`\nFull report: ${join(reportDir, 'report.json')}`)
}

main().catch(err => { console.error(err); process.exit(1) })
