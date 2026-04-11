/**
 * Serendip 反思规则解析器
 *
 * 0 token — 纯正则/字符串匹配，不用 LLM。
 * 从符合模板格式的反思文本中提取经验草稿。
 *
 * 输入格式（SKILL.md 定义的模板）：
 * ```
 * ## HH:MM 反思
 *
 * ### Mistakes
 * - 做了什么：[具体操作]
 *   结果：failed | partial
 *   教训：[可复用的经验]
 *
 * ### Lessons
 * - 做了什么：[具体操作]
 *   结果：succeeded
 *   收获：[可复用的经验]
 * ```
 */

export type Outcome = 'succeeded' | 'failed' | 'partial'
export type Section = 'mistakes' | 'lessons'

export interface ReflectionDraft {
  /** 做了什么 / 尝试了什么 */
  tried: string
  /** 结果 */
  outcome: Outcome
  /** 教训 / 收获 */
  learned: string
  /** 来自哪个段落 */
  section: Section
}

// --- 质量门控 ---
const MIN_TRIED_LENGTH = 20
const MIN_LEARNED_LENGTH = 20
const VALID_OUTCOMES: Set<string> = new Set(['succeeded', 'failed', 'partial'])

/**
 * 从反思文本中解析经验草稿
 *
 * 只处理符合模板格式的内容。不猜测、不推断。
 * 这是 0 token 解析器——如果格式不对，就返回空数组。
 */
export function parseReflection(text: string): ReflectionDraft[] {
  if (!text || !text.trim()) return []

  const drafts: ReflectionDraft[] = []
  const lines = text.split('\n')

  let currentSection: Section | null = null

  // 当前正在解析的条目
  let currentTried: string | null = null
  let currentOutcome: string | null = null
  let currentLearned: string | null = null

  function flushEntry() {
    if (currentTried && currentOutcome && currentLearned && currentSection) {
      const tried = currentTried.trim()
      const outcome = currentOutcome.trim()
      const learned = currentLearned.trim()

      // 质量门控
      if (
        tried.length >= MIN_TRIED_LENGTH &&
        learned.length >= MIN_LEARNED_LENGTH &&
        VALID_OUTCOMES.has(outcome)
      ) {
        drafts.push({
          tried,
          outcome: outcome as Outcome,
          learned,
          section: currentSection,
        })
      }
    }
    currentTried = null
    currentOutcome = null
    currentLearned = null
  }

  for (const line of lines) {
    const trimmed = line.trim()

    // 检测段落标题
    if (/^###\s*Mistakes/i.test(trimmed)) {
      flushEntry()
      currentSection = 'mistakes'
      continue
    }
    if (/^###\s*Lessons/i.test(trimmed)) {
      flushEntry()
      currentSection = 'lessons'
      continue
    }

    // 新的反思块标题（## HH:MM）不重置 section
    // 但如果遇到其他 ## 或 ### 标题，flush 当前条目
    if (/^##[^#]/.test(trimmed) && !/^###/.test(trimmed)) {
      flushEntry()
      // 不重置 currentSection — 下一个 ### 会重置
      continue
    }
    if (/^###/.test(trimmed)) {
      flushEntry()
      currentSection = null
      continue
    }

    if (!currentSection) continue

    // 匹配 "- 做了什么：..." 或 "- 做了什么: ..."
    const triedMatch = trimmed.match(/^-\s*做了什么[：:]\s*(.+)/)
    if (triedMatch) {
      flushEntry() // flush 上一条
      currentTried = triedMatch[1].trim()
      continue
    }

    // 匹配 "结果：..." 或 "结果: ..."
    const outcomeMatch = trimmed.match(/^结果[：:]\s*(.+)/)
    if (outcomeMatch) {
      currentOutcome = outcomeMatch[1].trim()
      continue
    }

    // 匹配 "教训：..." / "教训: ..." / "收获：..." / "收获: ..."
    const learnedMatch = trimmed.match(/^(?:教训|收获)[：:]\s*(.+)/)
    if (learnedMatch) {
      currentLearned = learnedMatch[1].trim()
      continue
    }
  }

  // 别忘了最后一条
  flushEntry()

  return drafts
}
