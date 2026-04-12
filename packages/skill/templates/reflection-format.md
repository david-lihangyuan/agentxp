# Reflection Entry Format

Use this format for all entries in reflection files:

```markdown
## [DATE] [TITLE]
- Tried: [specific action taken]
- Expected: [what you thought would happen]
- Outcome: [succeeded | failed | partial]
- Learned: [actionable lesson]
- Tags: [tag1, tag2]
```

## Example

```markdown
## 2026-04-11 Missed import paths after directory restructure
- Tried: Reorganized directory structure, updated paths in main repo
- Expected: Tests would pass after updating main repo imports
- Outcome: failed — agentxp repo's app.ts still had old paths
- Learned: Cross-repo operations require listing ALL affected imports, not just checking one repo's tests
- Tags: refactoring, imports
```
