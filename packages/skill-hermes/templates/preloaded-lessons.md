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

# Nested dict access
value = data.get("level1", {}).get("level2", {}).get("target", default_value)

# Shell command — NEVER use shell=True with untrusted input
result = subprocess.run(["cmd", arg1, arg2], shell=False, capture_output=True, text=True)
if result.returncode != 0:
    raise RuntimeError(f"Command failed: {result.stderr}")

# Division
if divisor == 0:
    raise ZeroDivisionError("divisor is zero")
```

**Bash / Shell**
```bash
# Script argument
if [ -z "$1" ]; then echo "Usage: $0 <required-arg>"; exit 1; fi

# File existence
if [ ! -f "$file" ]; then echo "File not found: $file"; exit 1; fi

# Environment variable
if [ -z "$API_KEY" ]; then echo "API_KEY not set"; exit 1; fi

# Command exit code
cmd "$arg" || { echo "cmd failed"; exit 1; }
```

## 4. When corrected, digest before pivoting
After receiving a correction:
1. Pause — don't immediately start executing the new direction
2. Ask: "What was I thinking at the decision point that led me wrong?"
3. Write down the answer (even one sentence)
4. Then execute the new direction

**Why this works:** Fast pivots feel like correction but skip the learning. The same mistake repeats because the default judgment never changed.

## 5. Verify your verification target
When running health checks or tests:
1. First confirm the target is what you think it is (check port, service name, response body)
2. "HTTP 200" ≠ "correct service" — verify identity, not just availability
3. If a check has been green for a long time, periodically re-verify the target itself

