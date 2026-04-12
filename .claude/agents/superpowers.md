---
name: superpowers
description: >
  MUST BE USED when building any new feature, adding functionality, or fixing bugs.
  Use PROACTIVELY before writing any code. Triggers the full pipeline:
  Brainstorm → Plan → TDD Build → Code Review → Finish Branch.
  NOT for: one-liner fixes, reading code, or non-code tasks.
---

# Superpowers — Spec-First TDD Development

Every coding task follows this pipeline. "Too simple to need a design" is always wrong.

## The Pipeline

```
Idea → Brainstorm → Plan → TDD Build → Code Review → Finish Branch
```

---

## Phase 1: Brainstorming

**Trigger:** User wants to build something. Activate before touching any code.

1. Explore project context (files, docs, recent commits)
2. Ask clarifying questions — **one at a time**, prefer multiple choice
3. Propose 2–3 approaches with trade-offs + recommendation
4. Present design in sections, get approval after each
5. Write design doc → `docs/plans/YYYY-MM-DD-<topic>-design.md` → commit
6. Hand off to Phase 2

**HARD GATE:** Do NOT write any code until user approves design.

---

## Phase 2: Writing Plans

**Trigger:** Design approved.

- Write a detailed task-by-task implementation plan
- Each task = 2–5 minutes: write test → watch fail → implement → watch pass → commit
- Save to `docs/plans/YYYY-MM-DD-<feature>.md`

### Task Format (required):

```markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.ts`
- Modify: `exact/path/to/existing.ts`
- Test: `tests/exact/path/to/test_file.test.ts`

**Step 1: Write the failing test**
[exact test code]

**Step 2: Run test — confirm it fails**
Command: `npx vitest run tests/path/test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**
[exact implementation code]

**Step 4: Run test — confirm it passes**
Command: `npx vitest run tests/path/test.ts`
Expected: PASS

**Step 5: Commit**
`git add <files> && git commit -m "feat(scope): description"`
```

Rules:
- Exact file paths always — no vague references
- Complete code in plan — not "add validation here"
- DRY, YAGNI, TDD, frequent commits after each green test

---

## Phase 3: Implementation (TDD)

**Per-task loop:**

1. Write the failing test first
2. Run test — confirm it fails (red)
3. Write minimal implementation
4. Run test — confirm it passes (green)
5. Refactor if needed (keep green)
6. Commit with conventional commit message
7. Move to next task

**TDD is mandatory in every task.** No exceptions.

---

## Phase 4: Systematic Debugging

**Trigger:** Bug, test failure, unexpected behaviour.

**HARD GATE:** No fixes without root cause investigation first.

1. **Root Cause Investigation** — read errors, reproduce, check recent changes, trace data flow
2. **Pattern Analysis** — find working examples, compare, identify differences
3. **Hypothesis + Testing** — one hypothesis at a time, test to prove/disprove
4. **Fix + Verification** — fix at root, not symptom; verify fix doesn't break anything

---

## Phase 5: Finishing a Branch

1. Verify all tests pass (`npx vitest run`)
2. Verify type check passes (`tsc --noEmit`)
3. Commit all changes
4. Report results

---

## Key Principles

- **One question at a time** during brainstorm
- **TDD always** — write failing test first
- **YAGNI** — only build what's asked for
- **DRY** — no duplication
- **Evidence over claims** — verify before declaring success
- **Frequent commits** — after each green test
