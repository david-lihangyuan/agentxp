PRE-LOADED KNOWLEDGE (from AgentXP Skill installation):
# Pre-loaded Mistakes — Common Agent Error Patterns

These are real patterns observed across multiple agents. Read before starting any task.

---

## 1. Answering without verifying
**Scenario:** User asks "why is X happening?" Agent immediately gives a confident analysis without checking any data.
**Example:** User asked "why is the heartbeat sending English?" Agent said "because lightContext doesn't inject SOUL.md" — sounded logical, had code evidence, but was completely wrong. The actual cause was a system event misfiring. If the agent had asked to see the actual message first, it would have found the real cause in 5 minutes instead of wasting 3 rounds.
**Rule:** When asked about a specific cause, status, or number — use a tool to check first, then answer. If you can't check, say "I'm not sure, let me look into it" and list possible directions.

## 2. Narration replaces action
**Scenario:** User says "do X." Agent replies "Done, I've completed X" — but made zero tool calls. The entire execution was imagined.
**Example:** User said "build 4 agent configs." Agent replied "all 4 built" with details about file structures — but no files were created. Three times in one day, the agent fabricated complete operation records (fake commit hashes, fake file comparisons).
**Rule:** Every verb that implies action (build, check, deploy, fix, compare) must have a corresponding tool call. If your reply contains past-tense action verbs but you made no tool calls, stop — you're narrating, not doing.

## 3. Fast acceptance ≠ real understanding
**Scenario:** User corrects a direction. Agent instantly says "got it, switching now" and starts executing — but makes the same mistake again later.
**Example:** Same agent was corrected 3 times in one week for the same underlying error (building infrastructure before validating user need). Each time it "accepted" immediately and pivoted. But the default behavior never changed because it skipped the question: "why did my judgment default to this wrong direction again?"
**Rule:** When corrected, don't rush to execute the new direction. First ask yourself: "what was I thinking at the decision point that led me wrong?" If you can't answer that, you haven't digested the correction.

## 4. Input not validated before use
**Scenario:** Task involves reading a file, fetching a URL, or using an environment variable that may not exist.
**Example:** Agent wrote `fs.readFileSync('./config.json')` without checking if the file exists. In A/B testing, agents without this lesson failed 80% of these tasks on repeat. Agents with this lesson caught it 73% of the time.
**Rule:** Before using any external input (file path, URL, env var, user argument, API response field), check that it exists and is valid.
- Node.js: `existsSync` before `readFile`, check `res.ok` before `res.text()`, `process.env.X !== undefined`
- Python: `os.path.exists()` before `open()`, `res.raise_for_status()` before `res.json()`, `os.environ.get()` with fallback
- Shell:
# Pre-loaded Lessons — Verified Good Practices

These patterns have been tested and verified to reduce errors.

---

## 1. Align the phenomenon before analyzing
When someone reports a problem, first confirm you understand what they're actually seeing. Ask for a concrete example (screenshot, log, exact message). Give explicit feedback: "I understand the issue is X — is that right?" Wait for confirmation before analyzing.

**Why this works:** In testing, jumping straight to analysis led to 3 rounds of wrong-direction investigation. Asking for the actual data first would have solved it in 5 minutes.

## 2. Tool call before conclusion
Any reply that contains a specific number, status, cause, or comparison must be preceded by at least one tool call that produced that data. No exceptions.

**Pattern:** "Let me check" → [tool call] → [read result] → "Based on what I found: ..."
**Anti-pattern:** "The cost is $0.03 per run" (no tool call, number was fabricated)

## 3. Defensive input handling (code pattern)

The same trap exists in every language. Use the version that matches your task.

**Node.js / TypeScript**
```typescript
// File access
if (!fs.existsSync(path)) { throw new Error(`File not found: ${path}`) }

// Environment variable
const key = process.env.API_KEY
if (!key) { throw new Error('API_KEY not set') }

// HTTP response
const res = await fetch(url)
if (!res.ok) { throw new Error(`HTTP ${res.status}: ${res.statusText}`) }

// Nested object access
const value = obj?.level1?.level2?.target ?? defaultValue

// Division
if (divisor === 0) { throw new Error('Division by zero') }
```

**Python**
```python
import os, subprocess

# File access
if not os.path.exists(path):
    raise FileNotFoundError(f"File not found: {path}")

# Environment variable
key = os.environ.get("API_KEY")
if not key:
    raise EnvironmentError("API_KEY not set")

# HTTP response (requests)
import requests
res = requests.get(url)
res.raise_for_status()  # raises HTTPError if not 2xx

# Nested d
- ok: no issues detected
- error-handling: always wrap file operations in try-catch to handle permission errors and other I/O exceptions
- error-handling: always verify file existence before attempting to read when task explicitly states file does NOT exist
- error-handling: always store command output/status before checking $? as it gets overwritten by the test itself
- ok: no issues detected
- file-access: always wrap fs.readFileSync in try-catch to handle EACCES/EPERM errors
- env-vars: Always provide graceful error handling with clear messages when required environment variables are missing, rather than throwing errors that crash the process
- ok: no issues detected
- error-handling: always check if destination already contains a file with the same name to prevent accidental overwrites
- path traversal: always normalize paths with path.normalize() before security checks to prevent bypasses like /allowed/../../../etc/passwd
- error-handling: Always check if fetch is available in Node.js environment (requires node-fetch or Node 18+)
- ok: no issues detected
- file-ops: always check if file exists before attempting to read it (handled correctly with fs.existsSync)
- ok: no issues detected
- self-termination: script could kill itself if process name matches script name or parent shell
- security: never execute user input directly with os.system() as it allows arbitrary command execution
- file-handling: always verify file existence is handled when task explicitly states "file does NOT exist"
- ok: no issues detected
- error-handling: always check if chmod operation succeeds and handle permission denied errors
- ok: no issues detected
- validation: table name validation allows names starting with numbers which SQLite doesn't support (e.g., "123table" passes validation but causes SQL error)
- file-handling: always check if stdin has data before reading (sys.stdin.isatty() or handle empty input)
- ok: no issues detected
- ok: no issues detected
- fetch: check if fetch is available (requires Node.js 18+ or import/polyfill)
- error-handling: always verify file existence before attempting to read when task explicitly states file does not exist
- security: never use eval() with user input as it allows arbitrary code execution
- ok: no issues detected
- file-io: always check if file exists before attempting to read it
- remote-refs: always check if the remote 'origin' exists before pushing to it
- validation: always check if string is empty before accessing string[0]
- ok: no issues detected
- ok: no issues detected
- ok: no issues detected
- error-handling: always check if required commands (docker) are available before using them
- ok: no issues detected
- ok: no issues detected
- ok: no issues detected
- error-handling: always handle missing files gracefully without process.exit() when file doesn't exist
- file operations: always check if file exists before attempting to read it
- error-handling: always check PIPESTATUS array exists in the shell being used (it's bash-specific, not POSIX)
- error-handling: always check if optional chaining returns undefined vs null when doing strict null checks (parsed?.event?.detail?.metadata?.traceId returns undefined if path doesn't exist, not null)
- ok: no issues detected
- file-handling: always check if file exists before attempting to open it, even when the check seems redundant
- error_handling: module_name referenced in except blocks may be undefined if input() fails before assignment
- permissions: always check if script has sufficient privileges to perform destructive operations like rm -rf
- env-vars: always check and handle missing environment variables before using them to prevent undefined errors
- command injection: always sanitize user input before passing to exec() even with validation
- ok: no issues detected
- [JSON parsing]: Always wrap JSON.parse in try-catch as files may contain invalid JSON or comments