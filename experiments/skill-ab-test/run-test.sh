#!/bin/bash
# A/B Test: AgentXP Reflection Skill effectiveness
# Runs 10 tasks through two agents (with-skill vs without-skill)
# Judges each response for trap avoidance

set -euo pipefail

EXPERIMENT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="$EXPERIMENT_DIR/results"
mkdir -p "$RESULTS_DIR/with-skill" "$RESULTS_DIR/without-skill"

TASKS_FILE="$EXPERIMENT_DIR/tasks.json"

echo "========================================="
echo "AgentXP Skill A/B Test"
echo "========================================="
echo ""

# Extract task count
TASK_COUNT=$(python3 -c "import json; print(len(json.load(open('$TASKS_FILE'))['tasks']))")
echo "Tasks: $TASK_COUNT"
echo ""

# Run each task for both agents
for i in $(seq 1 $TASK_COUNT); do
  TASK=$(python3 -c "
import json
tasks = json.load(open('$TASKS_FILE'))['tasks']
t = tasks[$i-1]
print(t['task'])
")
  
  TRAP=$(python3 -c "
import json
tasks = json.load(open('$TASKS_FILE'))['tasks']
t = tasks[$i-1]
print(t.get('trap','none'))
")

  echo "--- Task $i/$TASK_COUNT (trap: $TRAP) ---"
  echo "Task: $TASK"
  echo ""

  # Agent WITH skill - has reflection context
  echo "[with-skill] Running..."
  SKILL_PROMPT="You have a reflection skill installed. Before starting, check if you've seen similar tasks before.

IMPORTANT RULES FROM PAST EXPERIENCE:
$(cat "$RESULTS_DIR/with-skill/reflection.md" 2>/dev/null || echo '(no past experiences yet)')

Now do this task:
$TASK

Write ONLY the code/command. No explanation needed."

  claude -p "$SKILL_PROMPT" --max-turns 1 2>/dev/null > "$RESULTS_DIR/with-skill/task-$i.txt" || true

  # After task, trigger reflection (skill behavior)
  REFLECT_PROMPT="You just completed this task: $TASK

Your output was:
$(cat "$RESULTS_DIR/with-skill/task-$i.txt")

Reflect: Was there a potential issue with your solution? If the task mentioned a file/resource that doesn't exist, or an HTTP endpoint that returns errors, or an env var that might not be set — did you handle that? 

Write a ONE LINE lesson in this format:
- [trap-type]: [what to check next time]

Output ONLY the lesson line, nothing else."

  LESSON=$(claude -p "$REFLECT_PROMPT" --max-turns 1 2>/dev/null || echo "")
  if [ -n "$LESSON" ]; then
    echo "$LESSON" >> "$RESULTS_DIR/with-skill/reflection.md"
  fi

  # Agent WITHOUT skill - no reflection context
  echo "[without-skill] Running..."
  NOSKILL_PROMPT="Do this task:
$TASK

Write ONLY the code/command. No explanation needed."

  claude -p "$NOSKILL_PROMPT" --max-turns 1 2>/dev/null > "$RESULTS_DIR/without-skill/task-$i.txt" || true

  echo "Done task $i"
  echo ""
done

echo "========================================="
echo "All tasks complete. Results in: $RESULTS_DIR"
echo "========================================="
