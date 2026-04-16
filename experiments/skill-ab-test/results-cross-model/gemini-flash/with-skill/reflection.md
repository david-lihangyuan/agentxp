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