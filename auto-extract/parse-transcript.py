# -*- coding: utf-8 -*-
"""Parse OpenClaw session JSONL into a readable transcript for experience extraction."""
import sys
import json

def parse_content(content):
    """Extract readable text from message content."""
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    
    parts = []
    for p in content:
        if not isinstance(p, dict):
            continue
        ptype = p.get("type", "")
        
        if ptype == "text":
            text = p.get("text", "")
            # Skip very long system prompts
            if len(text) > 3000 and any(kw in text for kw in ["HEARTBEAT.md", "SOUL.md", "AGENTS.md"]):
                parts.append("[System prompt omitted]")
            else:
                parts.append(text)
        
        elif ptype == "tool_use":
            name = p.get("name", "?")
            inp = p.get("input", {})
            if name == "exec":
                cmd = inp.get("command", "")[:300]
                parts.append(f"[EXEC] {cmd}")
            elif name == "edit":
                path = inp.get("path", "")
                edits = inp.get("edits", [])
                preview = ""
                for e in edits[:1]:
                    old = e.get("oldText", "")[:80]
                    new = e.get("newText", "")[:150]
                    preview = f"  old: {old}...  new: {new}..."
                parts.append(f"[EDIT] {path}{preview}")
            elif name == "read":
                path = inp.get("path", "")
                parts.append(f"[READ] {path}")
            elif name == "write":
                path = inp.get("path", "")
                content_preview = inp.get("content", "")[:100]
                parts.append(f"[WRITE] {path}: {content_preview}...")
            else:
                args_str = json.dumps(inp, ensure_ascii=False)[:200]
                parts.append(f"[{name}] {args_str}")
        
        elif ptype == "tool_result":
            rc = p.get("content", "")
            if isinstance(rc, list):
                texts = []
                for x in rc:
                    if isinstance(x, dict) and x.get("type") == "text":
                        texts.append(x.get("text", ""))
                rc = " ".join(texts)
            rc = str(rc)[:500]
            
            # Always include results but truncate boring ones
            is_error = p.get("is_error", False)
            if is_error:
                parts.append(f"[ERROR] {rc}")
            elif len(rc) < 20:
                parts.append(f"[OK] {rc}")
            else:
                # Check if interesting
                lower = rc.lower()
                interesting = any(kw in lower for kw in [
                    "error", "fail", "warning", "not found", "cannot", 
                    "undefined", "assert", "fix", "bug", "issue",
                    "deploy", "pass", "succeed", "✅"
                ])
                if interesting:
                    parts.append(f"[RESULT] {rc}")
                else:
                    parts.append(f"[RESULT] {rc[:200]}...")
    
    return "\n".join(parts)


def main():
    if len(sys.argv) < 2:
        print("Usage: parse-transcript.py <session.jsonl>", file=sys.stderr)
        sys.exit(1)
    
    filepath = sys.argv[1]
    
    with open(filepath, "r", encoding="utf-8") as f:
        lines = f.readlines()
    
    for line in lines:
        try:
            obj = json.loads(line.strip())
        except json.JSONDecodeError:
            continue
        
        if obj.get("type") != "message":
            continue
        
        msg = obj.get("message", {})
        role = msg.get("role", "unknown")
        content = parse_content(msg.get("content", ""))
        
        if not content.strip():
            continue
        
        # Only include user (first message) and assistant messages
        if role == "user":
            # Only first user message (the prompt), skip tool results as user messages
            content_short = content[:500] if len(content) > 500 else content
            print(f">>> USER:\n{content_short}\n")
        elif role == "assistant":
            print(f">>> ASSISTANT:\n{content}\n")


if __name__ == "__main__":
    main()
