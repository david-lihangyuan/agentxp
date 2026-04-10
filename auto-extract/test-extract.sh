#!/bin/bash
# Phase 3.1: Test experience extraction from a real transcript
# Usage: ./test-extract.sh <session_jsonl_file>

set -e

SESSION_FILE="${1:-/Users/david/.openclaw/agents/main/sessions/cdc4289a-2f34-43bb-a110-82a2476470b9.jsonl}"
OUTPUT_DIR="/Users/david/.openclaw/workspace/agentxp/auto-extract/results"
mkdir -p "$OUTPUT_DIR"

echo "=== Phase 3.1: Experience Extraction Experiment ==="
echo "Session: $SESSION_FILE"
echo "Size: $(wc -c < "$SESSION_FILE") bytes"

# Step 1: Convert JSONL to readable transcript
python3 /Users/david/.openclaw/workspace/agentxp/auto-extract/parse-transcript.py "$SESSION_FILE" > "$OUTPUT_DIR/transcript.txt"
echo "Transcript: $(wc -l < "$OUTPUT_DIR/transcript.txt") lines, $(wc -c < "$OUTPUT_DIR/transcript.txt") bytes"

# Step 2: Send to LLM for extraction
echo "Sending to LLM for extraction..."
