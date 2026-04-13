#!/usr/bin/env npx tsx
// A/B Test: AgentXP Reflection Skill effectiveness
// Uses OpenRouter GPT-5.4 for both agents (cheap + fast)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

import { fileURLToPath } from 'url'
import { dirname } from 'path'
const __filename2 = fileURLToPath(import.meta.url)
const EXPERIMENT_DIR = dirname(__filename2)
const RESULTS_DIR = join(EXPERIMENT_DIR, 'results')
const TASKS_FILE = join(EXPERIMENT_DIR, 'tasks-v3.json')

// Load OpenRouter key
const configPath = join(process.env.HOME ?? '~', '.openclaw/agents/main/agent/auth-profiles.json')
const profiles = JSON.parse(readFileSync(configPath, 'utf8'))
const OR_KEY = profiles.profiles['openrouter:default'].key

interface Task {
  id: number
  task: string
  trap: string
  trap_desc: string
  expected: string | null
}

async function callLLM(prompt: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OR_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-5.4',
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 1000,
    }),
  })
  const data = await res.json() as any
  return data.choices?.[0]?.message?.content ?? ''
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
- For "empty-collection": did they check for empty list/array before operating on it?
- For "deep-access": did they use optional chaining or null checks on nested object access?
- For "dangerous-delete": did they validate the argument exists and is safe before the destructive operation?

Reply with EXACTLY one line:
PASS: [reason]
or
FAIL: [reason]`

  const verdict = await callLLM(judgePrompt)
  const passed = verdict.trim().toUpperCase().startsWith('PASS')
  return { passed, reason: verdict.trim() }
}

async function main() {
  mkdirSync(join(RESULTS_DIR, 'with-skill'), { recursive: true })
  mkdirSync(join(RESULTS_DIR, 'without-skill'), { recursive: true })

  const tasks: Task[] = JSON.parse(readFileSync(TASKS_FILE, 'utf8')).tasks
  // Pre-load mistakes and lessons from templates (simulating installed skill)
  const preloadedMistakes = readFileSync(join(EXPERIMENT_DIR, '../../packages/skill/templates/preloaded-mistakes.md'), 'utf8')
  const preloadedLessons = readFileSync(join(EXPERIMENT_DIR, '../../packages/skill/templates/preloaded-lessons.md'), 'utf8')
  const reflectionLog: string[] = [
    'PRE-LOADED KNOWLEDGE (from AgentXP Skill installation):',
    preloadedMistakes.slice(0, 3000),
    preloadedLessons.slice(0, 2000),
  ]
  
  const results: Array<{
    taskId: number
    trap: string
    withSkill: { response: string; passed: boolean; reason: string }
    withoutSkill: { response: string; passed: boolean; reason: string }
  }> = []

  for (const task of tasks) {
    console.log(`\n--- Task ${task.id}/20 (trap: ${task.trap}) ---`)
    console.log(`Task: ${task.task.slice(0, 80)}...`)

    // === Agent WITH skill ===
    const skillContext = reflectionLog.length > 0
      ? `BEFORE YOU START: Review lessons from past tasks:\n${reflectionLog.join('\n')}\n\nApply these lessons to the current task.\n\n`
      : ''
    
    const skillPrompt = `${skillContext}Task: ${task.task}\n\nWrite ONLY the code/command solution. No explanation.`
    const skillResponse = await callLLM(skillPrompt)
    writeFileSync(join(RESULTS_DIR, 'with-skill', `task-${task.id}.txt`), skillResponse)

    // Reflection step (skill behavior)
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
      
      const lesson = await callLLM(reflectPrompt)
      if (lesson.trim()) {
        reflectionLog.push(lesson.trim())
      }
    }

    // === Agent WITHOUT skill ===
    const noSkillPrompt = `Task: ${task.task}\n\nWrite ONLY the code/command solution. No explanation.`
    const noSkillResponse = await callLLM(noSkillPrompt)
    writeFileSync(join(RESULTS_DIR, 'without-skill', `task-${task.id}.txt`), noSkillResponse)

    // === Judge both ===
    const skillJudge = await judgeResponse(task, skillResponse)
    const noSkillJudge = await judgeResponse(task, noSkillResponse)

    results.push({
      taskId: task.id,
      trap: task.trap,
      withSkill: { response: skillResponse.slice(0, 200), passed: skillJudge.passed, reason: skillJudge.reason },
      withoutSkill: { response: noSkillResponse.slice(0, 200), passed: noSkillJudge.passed, reason: noSkillJudge.reason },
    })

    const sIcon = skillJudge.passed ? '✅' : '❌'
    const nIcon = noSkillJudge.passed ? '✅' : '❌'
    console.log(`  With skill: ${sIcon} ${skillJudge.reason.slice(0, 60)}`)
    console.log(`  No skill:   ${nIcon} ${noSkillJudge.reason.slice(0, 60)}`)
  }

  // === Summary ===
  console.log('\n\n=========================================')
  console.log('RESULTS SUMMARY')
  console.log('=========================================\n')

  let skillPass = 0, skillFail = 0, noSkillPass = 0, noSkillFail = 0
  let skillRepeatPass = 0, skillRepeatTotal = 0, noSkillRepeatPass = 0, noSkillRepeatTotal = 0
  const firstSeen = new Set<string>()

  for (const r of results) {
    if (r.withSkill.passed) skillPass++; else skillFail++
    if (r.withoutSkill.passed) noSkillPass++; else noSkillFail++

    // Track repeat traps
    if (r.trap !== 'none' && r.trap !== 'no-parse-error-handling') {
      if (firstSeen.has(r.trap)) {
        // This is a REPEAT of a previously seen trap
        skillRepeatTotal++
        noSkillRepeatTotal++
        if (r.withSkill.passed) skillRepeatPass++
        if (r.withoutSkill.passed) noSkillRepeatPass++
      } else {
        firstSeen.add(r.trap)
      }
    }
  }

  console.log('Overall:')
  console.log(`  With skill:    ${skillPass}/20 passed (${skillFail} failed)`)
  console.log(`  Without skill: ${noSkillPass}/20 passed (${noSkillFail} failed)`)
  console.log('')
  console.log('Repeat trap avoidance (KEY METRIC):')
  console.log(`  With skill:    ${skillRepeatPass}/${skillRepeatTotal} avoided on repeat`)
  console.log(`  Without skill: ${noSkillRepeatPass}/${noSkillRepeatTotal} avoided on repeat`)
  console.log('')

  // Save full results
  const report = { results, summary: { skillPass, skillFail, noSkillPass, noSkillFail, skillRepeatPass, skillRepeatTotal, noSkillRepeatPass, noSkillRepeatTotal }, reflectionLog }
  writeFileSync(join(RESULTS_DIR, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`Full report: ${join(RESULTS_DIR, 'report.json')}`)
  
  // Save reflection log
  writeFileSync(join(RESULTS_DIR, 'with-skill', 'reflection.md'), reflectionLog.join('\n'))
}

main().catch(err => { console.error(err); process.exit(1) })
