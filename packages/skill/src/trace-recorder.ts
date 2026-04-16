// trace-recorder.ts — L2 轨迹实时记录器
// Agent 生产侧模块：在任务执行过程中实时记录推理轨迹

import { readFileSync, appendFileSync, existsSync } from 'fs'

// ─── 类型定义 ───────────────────────────────────────────────────────────────

export type TraceAction =
  | 'observe'
  | 'hypothesize'
  | 'investigate'
  | 'decide'
  | 'verify'
  | 'backtrack'
  | 'delegate'
  | 'conclude'

export type StepSignificance = 'key' | 'routine' | 'context'

export interface TraceStep {
  action: TraceAction
  action_raw?: string
  content: string
  significance: StepSignificance
  references?: string[]
  timestamp: number
}

export interface DeadEnd {
  step_index: number
  tried: string
  why_abandoned: string
}

export interface TraceExport {
  steps: TraceStep[]
  dead_ends: DeadEnd[]
  trace_summary: string
  confidence: number | null
  duration_seconds: number
  trace_worthiness: 'low' | 'high'
  computed_difficulty: {
    computed: string
    steps_count: number
    dead_ends_count: number
  }
}

// JSONL 文件中存储的单行格式
interface TraceFileLine {
  type: 'meta' | 'step' | 'dead_end' | 'confidence'
  data: unknown
}

interface MetaData {
  contextAtStart: string
  startTime: number
}

// ─── normalizeAction 映射表 ──────────────────────────────────────────────────

// 每个 action 对应的关键词列表（中英文）
const ACTION_KEYWORDS: Record<TraceAction, string[]> = {
  observe: [
    '观察', '读', '看', '查看', '浏览', '扫描', '注意到', '发现', '读文件', '查文件',
    'observe', 'read', 'look', 'view', 'scan', 'notice', 'found', 'see', 'check file',
    '看到', '读取', '看了', '读了',
  ],
  hypothesize: [
    '假设', '猜测', '推测', '估计', '可能', '也许', '或许', '怀疑', '假想',
    'hypothesize', 'guess', 'assume', 'estimate', 'maybe', 'perhaps', 'suspect', 'suppose',
    '推断', '猜',
  ],
  investigate: [
    '查', '调查', '研究', '分析', '探索', '排查', '检查', '追踪', '源码', '源代码',
    '查源码', '查了源码', '看源码', '读源码', '调试', '挖掘', '深入',
    'investigate', 'research', 'analyze', 'explore', 'debug', 'trace', 'dig', 'examine',
    'source', 'inspect', '查阅', '排除',
  ],
  decide: [
    '决定', '选择', '确定', '方案', '采用', '用', '选用', '定了', '决策',
    'decide', 'choose', 'select', 'determine', 'pick', 'opt', 'go with', 'settle on',
    '定', '用方案', '决定用',
  ],
  verify: [
    '验证', '测试', '确认', '检验', '核实', '核对', '跑', '运行', '测', '试',
    '确认了', '验证了',
    'verify', 'test', 'confirm', 'validate', 'check', 'run', 'execute', 'assert',
    '校验',
  ],
  backtrack: [
    '回退', '撤销', '放弃', '重来', '换方向', '重新', '退回', '取消',
    'backtrack', 'rollback', 'revert', 'undo', 'retry', 'restart', 'abandon', 'back',
    '退', '改方向',
  ],
  delegate: [
    '委托', '分配', '交给', '派遣', '让', '转交', '移交',
    'delegate', 'assign', 'handoff', 'transfer', 'pass', 'dispatch',
    '交', '给',
  ],
  conclude: [
    '结论', '完成', '总结', '得出', '最终', '结果', '解决', '完工', '收尾',
    'conclude', 'conclusion', 'done', 'finish', 'complete', 'final', 'result', 'solved', 'summary',
    '得出结论', '最终结论',
  ],
}

// ─── TraceRecorder 类 ────────────────────────────────────────────────────────

export class TraceRecorder {
  private steps: TraceStep[] = []
  private deadEnds: DeadEnd[] = []
  private startTime: number
  private contextAtStart: string
  private confidence: number | null = null

  constructor(contextAtStart: string) {
    this.contextAtStart = contextAtStart
    this.startTime = Date.now()
  }

  /**
   * 记录一步（实时调用，不是事后回忆）(#21)
   */
  addStep(
    action: TraceAction,
    content: string,
    opts?: {
      significance?: StepSignificance
      action_raw?: string
      references?: string[]
    }
  ): void {
    const step: TraceStep = {
      action,
      content,
      significance: opts?.significance ?? 'routine',
      timestamp: Date.now(),
    }
    if (opts?.action_raw !== undefined) {
      step.action_raw = opts.action_raw
    }
    if (opts?.references && opts.references.length > 0) {
      step.references = opts.references
    }
    this.steps.push(step)
  }

  /**
   * 记录死胡同 (#2)
   */
  addDeadEnd(tried: string, whyAbandoned: string): void {
    this.deadEnds.push({
      step_index: this.steps.length - 1,
      tried,
      why_abandoned: whyAbandoned,
    })
  }

  /**
   * 标记回退 — 自动添加 backtrack step
   */
  backtrack(reason: string): void {
    this.addStep('backtrack', reason, { significance: 'key' })
  }

  /**
   * 归一化 action (#18)
   * 接受自由文本，映射到标准枚举
   * 映射不上的用 'investigate' 兜底，原文存 action_raw
   */
  static normalizeAction(raw: string): { action: TraceAction; action_raw?: string } {
    const lower = raw.toLowerCase().trim()

    for (const [action, keywords] of Object.entries(ACTION_KEYWORDS) as [TraceAction, string[]][]) {
      for (const kw of keywords) {
        if (lower.includes(kw.toLowerCase())) {
          // 如果原文和标准枚举完全相同，不存 action_raw
          if (lower === action) {
            return { action }
          }
          return { action, action_raw: raw }
        }
      }
    }

    // 兜底
    return { action: 'investigate', action_raw: raw }
  }

  /**
   * 自动评估轨迹价值 (#22)
   * high 条件：steps >= 3 且 (有 dead_ends 或 有 backtrack 或 steps >= 8)
   */
  assessWorthiness(): 'low' | 'high' {
    if (this.steps.length < 3) return 'low'
    const hasDeadEnds = this.deadEnds.length > 0
    const hasBacktrack = this.steps.some(s => s.action === 'backtrack')
    const manySteps = this.steps.length >= 8
    if (hasDeadEnds || hasBacktrack || manySteps) return 'high'
    return 'low'
  }

  /**
   * 自动推算难度 (#11)
   */
  computeDifficulty(): { computed: string; steps_count: number; dead_ends_count: number } {
    const steps_count = this.steps.length
    const dead_ends_count = this.deadEnds.length

    let computed: string
    if (steps_count <= 2 && dead_ends_count === 0) {
      computed = 'trivial'
    } else if (steps_count <= 5 && dead_ends_count === 0) {
      computed = 'easy'
    } else if (steps_count <= 10 && dead_ends_count <= 1) {
      computed = 'medium'
    } else if (steps_count <= 20 || dead_ends_count <= 3) {
      computed = 'hard'
    } else {
      computed = 'expert'
    }

    return { computed, steps_count, dead_ends_count }
  }

  /**
   * 生成一句话摘要 (#16)
   * 格式："[action1] → [action2] → ... → [conclude]，关键转折：[key step 内容]"
   */
  generateSummary(): string {
    if (this.steps.length === 0) return '（无步骤）'

    const actionChain = this.steps.map(s => s.action).join(' → ')
    const keySteps = this.steps.filter(s => s.significance === 'key')
    const keyPart =
      keySteps.length > 0
        ? `，关键转折：${keySteps.map(s => s.content).join('；')}`
        : ''

    return `${actionChain}${keyPart}`
  }

  /**
   * 导出完整轨迹
   */
  export(): TraceExport {
    return {
      steps: [...this.steps],
      dead_ends: [...this.deadEnds],
      trace_summary: this.generateSummary(),
      confidence: this.confidence,
      duration_seconds: Math.round((Date.now() - this.startTime) / 1000),
      trace_worthiness: this.assessWorthiness(),
      computed_difficulty: this.computeDifficulty(),
    }
  }

  /**
   * 设置 confidence（agent 在 conclude 时手动调用）
   * 值域 0-1
   */
  setConfidence(value: number): void {
    if (value < 0 || value > 1) {
      throw new RangeError(`confidence 必须在 0-1 之间，收到：${value}`)
    }
    this.confidence = value
  }

  /**
   * 序列化到 JSONL 文件（实时追加）(#21)
   * 每次调用追加当前最新 step 和 dead_end
   * 文件格式：每行一个 JSON 对象
   */
  async appendToFile(filepath: string): Promise<void> {
    // 追加当前状态：meta + 所有 steps + dead_ends + confidence
    // 每次调用都写完整快照（覆盖写，用临时策略：先 truncate 后重写）
    // 为了真正"实时追加"语义，每次调用只追加增量步骤是复杂的
    // 这里采用"重写整个文件"策略，保持简单且正确
    const { writeFileSync } = await import('fs')

    const lines: string[] = []

    // 第一行：meta
    const metaLine: TraceFileLine = {
      type: 'meta',
      data: {
        contextAtStart: this.contextAtStart,
        startTime: this.startTime,
      } satisfies MetaData,
    }
    lines.push(JSON.stringify(metaLine))

    // 后续行：每个 step
    for (const step of this.steps) {
      const stepLine: TraceFileLine = { type: 'step', data: step }
      lines.push(JSON.stringify(stepLine))
    }

    // dead_ends
    for (const de of this.deadEnds) {
      const deLine: TraceFileLine = { type: 'dead_end', data: de }
      lines.push(JSON.stringify(deLine))
    }

    // confidence（如果设置了）
    if (this.confidence !== null) {
      const confLine: TraceFileLine = { type: 'confidence', data: this.confidence }
      lines.push(JSON.stringify(confLine))
    }

    writeFileSync(filepath, lines.join('\n') + '\n', 'utf8')
  }

  /**
   * 从 JSONL 文件恢复（任务中断后恢复）
   */
  static loadFromFile(filepath: string): TraceRecorder {
    const content = readFileSync(filepath, 'utf8')
    const lines = content.split('\n').filter(l => l.trim().length > 0)

    let recorder: TraceRecorder | null = null

    for (const line of lines) {
      const parsed: TraceFileLine = JSON.parse(line)

      if (parsed.type === 'meta') {
        const meta = parsed.data as MetaData
        recorder = new TraceRecorder(meta.contextAtStart)
        recorder.startTime = meta.startTime
      } else if (parsed.type === 'step') {
        if (!recorder) throw new Error('JSONL 文件格式错误：meta 行必须在最前面')
        recorder.steps.push(parsed.data as TraceStep)
      } else if (parsed.type === 'dead_end') {
        if (!recorder) throw new Error('JSONL 文件格式错误：meta 行必须在最前面')
        recorder.deadEnds.push(parsed.data as DeadEnd)
      } else if (parsed.type === 'confidence') {
        if (!recorder) throw new Error('JSONL 文件格式错误：meta 行必须在最前面')
        recorder.confidence = parsed.data as number
      }
    }

    if (!recorder) throw new Error('JSONL 文件为空或格式不正确')
    return recorder
  }
}
