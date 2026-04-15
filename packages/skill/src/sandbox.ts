// sandbox.ts — Code block extraction and risk assessment for experience content.
// Extracts code blocks from markdown, evaluates their risk level, and wraps
// dangerous/cautious blocks with safety markers.

export interface CodeBlock {
  language: string
  code: string
  lineStart: number
  lineEnd: number
}

export type RiskLevel = 'safe' | 'caution' | 'dangerous'

export interface RiskAssessment {
  risk: RiskLevel
  reasons: string[]
}

/**
 * Patterns that indicate dangerous code — destructive, remote execution, or
 * arbitrary code evaluation.
 */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+-[^\s]*r[^\s]*f|rm\s+-[^\s]*f[^\s]*r/i, reason: 'recursive force-delete (rm -rf)' },
  { pattern: /\brm\s+--no-preserve-root/i, reason: 'rm --no-preserve-root' },
  { pattern: /drop\s+table/i, reason: 'SQL DROP TABLE' },
  { pattern: /drop\s+database/i, reason: 'SQL DROP DATABASE' },
  { pattern: /truncate\s+table/i, reason: 'SQL TRUNCATE TABLE' },
  { pattern: /curl[^|]*\|[^|]*bash/i, reason: 'curl|bash remote execution' },
  { pattern: /curl[^|]*\|[^|]*sh\b/i, reason: 'curl|sh remote execution' },
  { pattern: /wget[^|]*\|[^|]*bash/i, reason: 'wget|bash remote execution' },
  { pattern: /wget[^|]*\|[^|]*sh\b/i, reason: 'wget|sh remote execution' },
  { pattern: /\beval\s*\(/i, reason: 'eval() arbitrary code execution' },
  { pattern: /\bexec\s*\(/i, reason: 'exec() arbitrary code execution' },
  { pattern: /__import__\s*\(\s*['"]os['"]\s*\)/i, reason: "__import__('os') unsafe import" },
  { pattern: /\bsubprocess\s*\./i, reason: 'subprocess module usage' },
  { pattern: /\bos\.system\s*\(/i, reason: 'os.system() shell execution' },
  { pattern: /\bsystem\s*\(\s*["']/i, reason: 'system() shell execution' },
  { pattern: /\bshell_exec\s*\(/i, reason: 'shell_exec() PHP shell execution' },
  { pattern: /\bpassthru\s*\(/i, reason: 'passthru() PHP shell execution' },
  { pattern: /\bpopen\s*\(/i, reason: 'popen() shell pipe' },
  { pattern: /\bspawnSync\s*\(|\bexecSync\s*\(|\bspawn\s*\(/i, reason: 'Node.js child_process spawn/exec' },
  { pattern: /\bchild_process\b/i, reason: 'Node.js child_process module' },
  { pattern: /:\s*\(\s*\)\s*\{.*:\s*\|.*&/i, reason: 'fork bomb pattern' },
  { pattern: /\bshutil\.rmtree\s*\(/i, reason: 'shutil.rmtree() recursive delete' },
  { pattern: /\bos\.remove\s*\(|os\.unlink\s*\(/i, reason: 'os.remove/unlink file deletion' },
  { pattern: /\bFormat-Volume\b|\bFormat-Disk\b/i, reason: 'PowerShell disk format' },
  { pattern: /\bdd\s+if=.*of=\/dev\//i, reason: 'dd disk overwrite' },
  { pattern: /mkfs\s*\./i, reason: 'mkfs filesystem format' },
]

/**
 * Patterns that indicate cautious code — file I/O, network, env access.
 */
const CAUTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // File write
  { pattern: /\bopen\s*\(.*['"]w['"]/i, reason: 'file write (open with w mode)' },
  { pattern: /\bopen\s*\(.*['"]a['"]/i, reason: 'file append (open with a mode)' },
  { pattern: /\bfs\.writeFile\b|\bfs\.appendFile\b|\bfs\.writeFileSync\b/i, reason: 'Node.js file write' },
  { pattern: /\bwriteFile\s*\(|\bappendFile\s*\(/i, reason: 'file write call' },
  { pattern: /\bFile\.write\b|\bFileWriter\b/i, reason: 'file write object' },
  { pattern: /\bfwrite\s*\(|\bfputs\s*\(/i, reason: 'C file write' },

  // Network requests
  { pattern: /\bfetch\s*\(|\baxios\s*\.\s*(get|post|put|delete|patch)\b/i, reason: 'network request (fetch/axios)' },
  { pattern: /\brequests\s*\.\s*(get|post|put|delete|patch)\s*\(/i, reason: 'Python requests network call' },
  { pattern: /\bhttp\.get\b|\bhttp\.post\b|\bhttps\.get\b|\bhttps\.post\b/i, reason: 'Node.js http(s) network call' },
  { pattern: /\bxmlhttprequest\b/i, reason: 'XMLHttpRequest network call' },
  { pattern: /\burllib\s*\.\s*request\b|\burllib\.urlopen\b/i, reason: 'Python urllib network call' },
  { pattern: /\bcurl\b/i, reason: 'curl network call' },
  { pattern: /\bwget\b/i, reason: 'wget network download' },

  // Environment variable access
  { pattern: /\bprocess\.env\b/i, reason: 'Node.js process.env access' },
  { pattern: /\bos\.environ\b|\bos\.getenv\s*\(/i, reason: 'Python os.environ/getenv access' },
  { pattern: /\bgetenv\s*\(/i, reason: 'getenv() environment variable access' },
  { pattern: /\$ENV\{|\$\{?[A-Z_]{2,}\}?/i, reason: 'shell environment variable expansion' },
  { pattern: /\bSystem\.getenv\b/i, reason: 'Java System.getenv access' },

  // Database queries (non-destructive but impactful)
  { pattern: /\bINSERT\s+INTO\b/i, reason: 'SQL INSERT' },
  { pattern: /\bUPDATE\s+\w+\s+SET\b/i, reason: 'SQL UPDATE' },
  { pattern: /\bDELETE\s+FROM\b/i, reason: 'SQL DELETE' },
]

/**
 * Extract all fenced code blocks from markdown text.
 * Returns an array of CodeBlock objects with language, code, and line numbers.
 */
export function extractCodeBlocks(text: string): CodeBlock[] {
  const lines = text.split('\n')
  const blocks: CodeBlock[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // Match opening fence: ``` or ``` followed by optional language
    const openMatch = line.match(/^(`{3,}|~{3,})(\S*)/)
    if (openMatch) {
      const fence = openMatch[1]
      const language = openMatch[2] ?? ''
      const lineStart = i + 1 // 1-indexed
      const codeLines: string[] = []
      i++

      // Collect lines until matching closing fence
      while (i < lines.length) {
        const closingFence = lines[i].match(/^(`{3,}|~{3,})/)
        if (closingFence && lines[i].trim() === fence.slice(0, closingFence[1].length).padEnd(fence.length, fence[0])) {
          break
        }
        // More robust: closing fence must start with same fence chars and same length
        if (lines[i].trimEnd() === fence) {
          break
        }
        codeLines.push(lines[i])
        i++
      }

      const lineEnd = i + 1 // 1-indexed, points to closing fence line
      blocks.push({
        language,
        code: codeLines.join('\n'),
        lineStart,
        lineEnd,
      })
    }
    i++
  }

  return blocks
}

/**
 * Assess the risk level of a code block.
 * Returns a RiskLevel and an array of reasons.
 */
export function assessCodeRisk(block: CodeBlock): RiskAssessment {
  const reasons: string[] = []

  // Check dangerous patterns first
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(block.code)) {
      reasons.push(reason)
    }
  }

  if (reasons.length > 0) {
    return { risk: 'dangerous', reasons }
  }

  // Check caution patterns
  for (const { pattern, reason } of CAUTION_PATTERNS) {
    if (pattern.test(block.code)) {
      reasons.push(reason)
    }
  }

  if (reasons.length > 0) {
    return { risk: 'caution', reasons }
  }

  return { risk: 'safe', reasons: [] }
}

const DANGEROUS_MARKER = '⚠️ DANGEROUS - DO NOT EXECUTE'
const CAUTION_MARKER = '⚠️ Review before executing'

/**
 * Wrap dangerous and cautious code blocks in the markdown text with safety markers.
 * Returns the full text with warning annotations inserted above each flagged block.
 */
export function sandboxWrap(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const openMatch = line.match(/^(`{3,}|~{3,})(\S*)/)

    if (openMatch) {
      const fence = openMatch[1]
      const language = openMatch[2] ?? ''
      const codeLines: string[] = []
      const fenceLines: string[] = [line]
      i++

      // Collect until closing fence
      while (i < lines.length) {
        if (lines[i].trimEnd() === fence) {
          fenceLines.push(lines[i])
          i++
          break
        }
        codeLines.push(lines[i])
        fenceLines.push(lines[i])
        i++
      }

      const block: CodeBlock = {
        language,
        code: codeLines.join('\n'),
        lineStart: 0,
        lineEnd: 0,
      }

      const { risk } = assessCodeRisk(block)

      if (risk === 'dangerous') {
        result.push(`> ${DANGEROUS_MARKER}`)
        result.push(...fenceLines)
      } else if (risk === 'caution') {
        result.push(`> ${CAUTION_MARKER}`)
        result.push(...fenceLines)
      } else {
        result.push(...fenceLines)
      }
    } else {
      result.push(line)
      i++
    }
  }

  return result.join('\n')
}
