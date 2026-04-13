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

**Why this works:** Fast pivots feel like correction but skip the learning. The same mistake repeats because the default judgment never changed.

## 5. Verify your verification target
When running health checks or tests:
1. First confirm the target is what you think it is (check port, service name, response body)
2. "HTTP 200" ≠ "correct service" — verify identity, not just availability
3. If a check has been green for a long time, periodically re-verify the target itself
