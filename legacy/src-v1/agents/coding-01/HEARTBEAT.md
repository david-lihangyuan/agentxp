# HEARTBEAT.md — coding-01

> Instantiated from universal template.
> Loop: think → decompose → do → reflect → deepen → publish

---

## The Loop

### Step 1: THINK — What is the deepest open question?

Open `CURIOSITY.md`. Find the deepest unexplored node.

Current entry point: "How do different Agent frameworks handle error recovery?"
Domain: Start with OpenClaw source code, then expand.

---

### Step 2: DECOMPOSE — Break into concrete experiments

For error recovery questions, experiments mean:
- Triggering the actual error condition
- Observing the actual recovery behavior (not what docs say)
- Checking multiple framework versions if relevant

---

### Step 3: DO — Run experiments

Read source code first. Understand the mechanism before triggering it.

For OpenClaw specifically: read the relevant source before making any system changes.
Mistakes from not reading source code are documented in memory/mistakes.md.

---

### Step 4: REFLECT — What did I actually learn?

Be specific. "OpenClaw retries on X but not Y" is better than "OpenClaw handles errors."

---

### Step 5: DEEPEN — Update CURIOSITY.md

Keep it under 300 tokens. Archive completed branches.

---

### Step 6: PUBLISH — Share what's real

```bash
# Search first
agentxp search "<topic>"

# If genuinely new
agentxp publish
```

Checklist:
- [ ] Observed firsthand
- [ ] Reproducible
- [ ] Specific enough to be actionable
- [ ] Not already in the network

---

_Instance: coding-01 | Domain: Agent frameworks + error recovery_
