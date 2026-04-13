/**
 * Dynamic Learning A/B Test
 *
 * Tests whether the AgentXP Skill reflection-recall loop enables an agent
 * to learn from early mistakes and avoid repeating them in later tasks.
 *
 * With-skill agent: after each task, reflects on mistakes and writes to
 * mistakes.md; before each task, recalls from mistakes.md.
 *
 * Without-skill agent: no reflection, no recall. Stateless across tasks.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const EXPERIMENT_DIR = __dirname
const TASKS_FILE = join(EXPERIMENT_DIR, 'tasks-dynamic.json')
const RESULTS_DIR = join(EXPERIMENT_DIR, 'results-dynamic')

// Read OpenRouter API key
const authProfiles = JSON.parse(
  readFileSync(join(process.env.HOME!, '.openclaw/agents/main/agent/auth-profiles.json'), 'utf8')
)
const openrouterKey = authProfiles.profiles?.['openrouter:default']?.key
if (!openrouterKey) throw new Error('OpenRouter API key not found')

const MODEL = 'openai/gpt-5.4'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

interface Task {
  id: number
  task: string
  trap: string
  phase: 'early' | 'late'
}

interface TaskResult {
  taskId: number
  trap: string
  phase: string
  withSkill: { response: string; passed: boolean; reason: string }
  withoutSkill: { response: string; passed: boolean; reason: string }
}

async function callLLM(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_completion_tokens: 1000,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`LLM error ${res.status}: ${err}`)
  }
  const data = await res.json() as any
  return data.choices?.[0]?.message?.content ?? ''
}

async function solveTask(task: Task, context: string): Promise<string> {
  const systemPrompt = context
    ? `You are a careful software engineer. You write defensive, production-ready code.\n\nIMPORTANT CONTEXT FROM PREVIOUS EXPERIENCE:\n${context}\n\nApply these lessons to the current task.`
    : `You are a software engineer. Write code to complete the task.`

  return callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Complete this task. Output ONLY the code, no explanation:\n\n${task.task}` },
  ])
}

async function reflect(task: Task, response: string, passed: boolean): Promise<string> {
  if (passed) return ''

  return callLLM([
    {
      role: 'system',
      content: `You are an agent that learns from mistakes. Analyze the code you just wrote and identify what went wrong.`,
    },
    {
      role: 'user',
      content: `You just wrote this code for the task: "${task.task}"\n\nCode:\n${response}\n\nThe code FAILED because it did not handle the trap: ${task.trap}\n\nWrite a brief lesson (2-3 sentences) about what you should do differently next time. Be specific about the pattern to avoid and the fix to apply. Start with "## ${task.trap}"`,
    },
  ])
}

async function judge(task: Task, response: string): Promise<{ passed: boolean; reason: string }> {
  const trapDescriptions: Record<string, string> = {
    'division-by-zero': 'The code must check for zero/empty before dividing. If it divides without checking, it FAILS.',
    'missing-resource': 'The code must check if the file/env var exists before using it. If it accesses without checking, it FAILS.',
    'untrusted-input': 'The code must validate or sanitize user input before using it in shell commands, file paths, or system calls. If it uses input directly, it FAILS.',
    'deep-null-access': 'The code must use optional chaining (?.) or null checks before accessing nested properties. If it accesses deeply nested properties without checks, it FAILS.',
    'dangerous-operation': 'The code must validate the argument (check it is non-empty, exists, or is safe) before performing destructive operations. If it performs the operation without validation, it FAILS.',
  }

  const result = await callLLM([
    {
      role: 'system',
      content: `You are a strict code reviewer. You evaluate whether code handles a specific safety requirement.`,
    },
    {
      role: 'user',
      content: `Task: "${task.task}"\n\nSafety requirement: ${trapDescriptions[task.trap]}\n\nCode to review:\n${response}\n\nDoes the code satisfy the safety requirement? Reply with exactly:\nPASS: <one sentence why>\nor\nFAIL: <one sentence why not>`,
    },
  ])

  const passed = result.trim().startsWith('PASS')
  const reason = result.trim()
  return { passed, reason }
}

async function runTest() {
  mkdirSync(RESULTS_DIR, { recursive: true })

  const { tasks } = JSON.parse(readFileSync(TASKS_FILE, 'utf8')) as { tasks: Task[] }

  // With-skill agent: accumulates mistakes.md across tasks
  let mistakesLog = ''
  // Without-skill agent: stateless, no memory

  const results: TaskResult[] = []

  console.log('Dynamic Learning A/B Test')
  console.log('=========================\n')
  console.log('With-skill agent: reflects after each mistake, recalls before next task')
  console.log('Without-skill agent: stateless\n')

  for (const task of tasks) {
    console.log(`--- Task ${task.id}/10 (trap: ${task.trap}, phase: ${task.phase}) ---`)
    console.log(`Task: ${task.task.slice(0, 80)}...`)

    // With-skill: provide accumulated mistakes as context
    const withSkillContext = mistakesLog
      ? `Past mistakes to avoid:\n${mistakesLog}`
      : ''

    const [withSkillResponse, withoutSkillResponse] = await Promise.all([
      solveTask(task, withSkillContext),
      solveTask(task, ''), // no context
    ])

    const [withSkillJudge, withoutSkillJudge] = await Promise.all([
      judge(task, withSkillResponse),
      judge(task, withoutSkillResponse),
    ])

    console.log(`  With skill:   ${withSkillJudge.passed ? '✅' : '❌'} ${withSkillJudge.reason.slice(0, 80)}`)
    console.log(`  No skill:     ${withoutSkillJudge.passed ? '✅' : '❌'} ${withoutSkillJudge.reason.slice(0, 80)}`)

    // With-skill: reflect on mistakes and update mistakesLog
    if (!withSkillJudge.passed) {
      const lesson = await reflect(task, withSkillResponse, withSkillJudge.passed)
      if (lesson) {
        mistakesLog += '\n\n' + lesson
        console.log(`  → Reflected: wrote lesson for ${task.trap}`)
      }
    } else {
      console.log(`  → No mistake to reflect on`)
    }

    results.push({
      taskId: task.id,
      trap: task.trap,
      phase: task.phase,
      withSkill: withSkillJudge,
      withoutSkill: withoutSkillJudge,
    })

    console.log()
  }

  // Summary
  const earlyResults = results.filter(r => r.phase === 'early')
  const lateResults = results.filter(r => r.phase === 'late')

  const earlyWithSkill = earlyResults.filter(r => r.withSkill.passed).length
  const earlyWithoutSkill = earlyResults.filter(r => r.withoutSkill.passed).length
  const lateWithSkill = lateResults.filter(r => r.withSkill.passed).length
  const lateWithoutSkill = lateResults.filter(r => r.withoutSkill.passed).length

  // Key metric: for traps that with-skill got wrong early, did it fix them late?
  const trapNames = [...new Set(results.map(r => r.trap))]
  const learningMetrics: Record<string, { earlyFailed: boolean; latePassed: boolean }> = {}
  for (const trap of trapNames) {
    const early = results.find(r => r.trap === trap && r.phase === 'early')!
    const late = results.find(r => r.trap === trap && r.phase === 'late')!
    learningMetrics[trap] = {
      earlyFailed: !early.withSkill.passed,
      latePassed: late.withSkill.passed,
    }
  }

  const trapsWhereLearningOccurred = Object.entries(learningMetrics)
    .filter(([, m]) => m.earlyFailed && m.latePassed).length
  const trapsWhereEarlyFailed = Object.values(learningMetrics).filter(m => m.earlyFailed).length

  console.log('=========================================')
  console.log('RESULTS SUMMARY')
  console.log('=========================================\n')
  console.log('Early tasks (1-5):')
  console.log(`  With skill:    ${earlyWithSkill}/5 passed`)
  console.log(`  Without skill: ${earlyWithoutSkill}/5 passed\n`)
  console.log('Late tasks (6-10):')
  console.log(`  With skill:    ${lateWithSkill}/5 passed`)
  console.log(`  Without skill: ${lateWithoutSkill}/5 passed\n`)
  console.log('KEY METRIC — Learning from early mistakes:')
  console.log(`  Traps failed early by with-skill agent: ${trapsWhereEarlyFailed}/5`)
  console.log(`  Of those, fixed in late tasks:          ${trapsWhereLearningOccurred}/${trapsWhereEarlyFailed}`)
  if (trapsWhereEarlyFailed > 0) {
    console.log(`  Learning rate: ${Math.round(trapsWhereLearningOccurred / trapsWhereEarlyFailed * 100)}%`)
  }

  console.log('\nPer-trap learning:')
  for (const [trap, m] of Object.entries(learningMetrics)) {
    const early = results.find(r => r.trap === trap && r.phase === 'early')!
    const late = results.find(r => r.trap === trap && r.phase === 'late')!
    const withSymbol = m.earlyFailed ? (m.latePassed ? '✅ learned' : '❌ still failing') : '— no mistake early'
    const withoutSymbol = `no-skill late: ${late.withoutSkill.passed ? '✅' : '❌'}`
    console.log(`  ${trap}: with-skill ${withSymbol} | ${withoutSymbol}`)
  }

  console.log('\nFinal mistakes.md accumulated by with-skill agent:')
  console.log(mistakesLog || '(none)')

  const report = {
    summary: { earlyWithSkill, earlyWithoutSkill, lateWithSkill, lateWithoutSkill, trapsWhereEarlyFailed, trapsWhereLearningOccurred },
    learningMetrics,
    results,
    finalMistakesLog: mistakesLog,
  }

  writeFileSync(join(RESULTS_DIR, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`\nFull report: ${join(RESULTS_DIR, 'report.json')}`)
}

runTest().catch(console.error)
