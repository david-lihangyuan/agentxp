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
**Rule:** Before using any external input (file path, URL, env var, user argument, API response field), check that it exists and is valid. This applies to: existsSync before readFile, status code before response.text, process.env.X !== undefined before using X, optional chaining on nested object access.

## 5. Looks like it's working ≠ actually working
**Scenario:** A monitoring
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
```
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

// Shell script argument
if [ -z "$1" ]; then echo "Usage: $0 <required-arg>"; exit 1; fi

// Division
if (divisor === 0) { throw new Error('Division by zero') }
```

## 4. When corrected, digest before pivoting
After receiving a correction:
1. Pause — don't immediately start executing the new direction
2. Ask: "What was I thinking at the decision point that led me wrong?"
3. Write down the answer (even one sentence)
4. Then execute the new direction

**Why this works:** Fast pivots feel like correction but skip the learning. The same mistake repeats because the default jud
- ok: no issues detected
- error-handling: always wrap file reads in try/catch and handle unreadable files/permissions, not just missing paths
- external-dependency: always check whether referenced files/URLs/env vars may be missing and handle that case before reading or using them
- robustness: always check target paths exist and that destructive operations like `find ... -delete` handle permission errors/failures safely instead of assuming they will succeed
- ok: no issues detected
- ok: no issues detected
- env-vars: always check required environment variables exist before using them and fail gracefully with a clear error
- ok: no issues detected
- portability: always check shell-command compatibility in `/bin/sh` scripts, e.g. `basename --` and `mv --` may fail on some POSIX shells/systems
- [security]: always restrict user-supplied file paths to an approved base directory and validate against path traversal, since serving req.query.path directly can expose arbitrary files and cause production-impacting data leaks
- ok: no issues detected
- ok: no issues detected
- robustness: always verify referenced files/URLs/env vars exist and fail gracefully instead of assuming availability
- ok: no issues detected
- safety: always check whether a kill pattern can match the script itself or unintended processes, and guard against self-termination or overbroad `pkill -f` matches
- robustness: always check that platform-dependent external commands/binaries (e.g., uptime/date/whoami) actually exist on the deployment environment and handle FileNotFoundError instead of assuming they’re available
- resilience: always check that referenced files/URLs/env vars may be missing and fail gracefully instead of assuming they exist
- ok: no issues detected
- ok: no issues detected
- ok: no issues detected
- robustness: always check whether DROP TABLE should tolerate missing tables (e.g., use IF EXISTS) to avoid runtime failures when the target table does not exist
- exception handling: always catch all explicitly raised exceptions too, e.g. ValueError for missing stdin input, or the script can still crash
- dependencies: always check that required runtime modules (e.g. 'pg') are installed or handle missing-package errors explicitly
- ok: no issues detected
- runtime: always validate the Node.js version/runtime support for required APIs like global fetch before relying on them in production
- assumptions: always check whether referenced files/URLs/env vars may be missing and handle the absence explicitly to avoid runtime failures
- safety: always check whether requested behavior is intentionally unsafe and fail closed with a valid response path that cannot execute user-controlled code
- ok: no issues detected
- ok: no issues detected
- robustness: always check the command’s exit status and handle remote/auth/network failures for `git push` so the script doesn’t fail ungracefully
- crash-risk: always check external dependencies like the database file path/env var exist before connecting, to avoid runtime failures
- ok: no issues detected
- ok: no issues detected
- ok: no issues detected
- robustness: always check external command exit paths and environment dependencies (e.g., docker daemon accessibility/permissions), not just argument presence and binary existence
- robustness: always guard destructive path operations against special cases like "." or ".." resolving to the current/parent directory, not just "/"
- ok: no issues detected
- ok: no issues detected
- ok: no issues detected
- ok: no issues detected
- runtime: always verify command semantics before treating an empty generated file as “remove everything” — here `grep -Fv` returns nonzero when all lines match, so the script can incorrectly call `crontab -r` and delete the entire crontab
- robustness: always check whether the CloudWatch log entry wraps the actual JSON in a string field (for example `message`) and parse that before accessing `event.detail.metadata.traceId`
- ok: no issues detected
- robustness: always verify external inputs/resources (files, URLs, env vars) exist and handle missing/invalid cases before loading to avoid production crashes
- runtime: always handle import failures from __import__() (e.g., missing/invalid module names) instead of letting ModuleNotFoundError crash the program
- safety: always check for symlinks before `rm -rf` a resolved home path, or you could delete an unintended directory in production
- env-vars: always validate required environment variables exist before using them and fail fast with a clear error message
- robustness: always check error object fields before using them—`process.exit(error.code || 1)` can throw if `error.code` is a non-numeric string like `'ETIMEDOUT'`
- ok: no issues detected
- runtime: always verify the API path exists and matches the task requirement (e.g., workspace.settings.editor.tabSize vs workspace.getConfiguration('editor').get('tabSize')) before calling methods