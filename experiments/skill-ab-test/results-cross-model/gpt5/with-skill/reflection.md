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
- runtime: always validate external inputs like process.argv before use and handle missing/nonexistent files to avoid crashes
- external-dependencies: always check that referenced files/URLs/env vars exist and fail gracefully if they are missing
- robustness: always check whether required commands/options exist at runtime (e.g., `find -delete` may be unsupported on some systems) and provide a safe fallback to avoid production failures
- ok: no issues detected
- ok: no issues detected
- ok: no issues detected
- ok: no issues detected
- [portability]: always check shell command options are POSIX-safe—`mv --` can fail under `/bin/sh` environments where `mv` does not support `--`
- runtime: always handle symlink traversal when serving files—`path.resolve` + prefix checks alone can be bypassed via symlinks, so verify `realpath` stays within the allowed base dir to avoid production file disclosure
- ok: no issues detected
- ok: no issues detected
- robustness: always verify any referenced file/URL/env var exists and handle read/access failures gracefully to avoid runtime crashes
- ok: no issues detected
- robustness: always verify the command fallback parses all expected `ps` output formats and handles missing utilities or unsupported options without failing unexpectedly
- robustness: always check whether invoked system commands/files/URLs/environment-dependent resources exist in the deployment environment and handle execution failures/timeouts to avoid runtime crashes
- dependency: always check that required imports/packages (e.g. PyYAML for `import yaml`) are installed, or handle `ImportError` gracefully
- ok: no issues detected
- ok: no issues detected
- ok: no issues detected
- [error-handling]: always catch and handle database operation errors (e.g., DROP TABLE on a missing/locked table or sqlite connection failures) so the script doesn’t crash in production
- ok: no issues detected
- dependency/env-var: always check required env vars and external dependencies/modules (e.g. `DB_URL`, `pg`) exist and fail gracefully if missing
- ok: no issues detected
- runtime: always check platform/API availability (e.g. global fetch in Node.js) and fail gracefully when it may not exist
- ok: no issues detected
- robustness: always validate untrusted input and avoid eval() or wrap execution in try/catch so malformed or malicious req.body.template cannot crash the server
- ok: no issues detected
- ok: no issues detected
- robustness: always verify required external dependencies/targets exist (e.g., ensure `git` is installed and the remote like `origin` exists before invoking commands that assume them)
- runtime: always initialize resources like `conn` before `try/finally` or guard `close()` separately, so setup failures can't trigger `UnboundLocalError` in cleanup
- ok: no issues detected
- ok: no issues detected
- ok: no issues detected
- ok: no issues detected
- runtime: always handle shutil.rmtree() failures (e.g. permission errors, in-use files, symlink/race-condition path changes) with try/except instead of assuming pre-checks prevent crashes
- ok: no issues detected
- runtime: always ensure conditionals and function calls are complete/syntax-valid before returning code, or the script can fail immediately on startup
- missing-inputs: always check whether referenced files/URLs/env vars may be absent and handle that case explicitly to avoid runtime crashes
- robustness: always validate that nested YAML values have the expected types before indexing, since malformed but syntactically valid configs can still cause runtime errors
- robustness: always check command pipelines for empty/nonstandard input formats—this assumes `#ID:<id>` is on one line and the job is exactly the next line, which can corrupt multi-line or differently formatted crontab entries in production
- robustness: always guard fs.existsSync/readFileSync with try/catch because a malformed path or permission issue can still cause a runtime failure in production
- ok: no issues detected
- ok: no issues detected
- robustness: always catch import failures (e.g., ModuleNotFoundError/ImportError) when importing a user-provided module name, since the module may not exist and can crash at runtime
- runtime-safety: always check symlinks before `cd`/`pwd -P` on a user home, because a missing or broken symlinked home can make resolution fail and crash the deletion path unexpectedly
- ok: no issues detected
- robustness: always check callback error objects for undefined fields before using them in process.exit (e.g., avoid assuming error.code is a valid number)
- ok: no issues detected
- ok: no issues detected