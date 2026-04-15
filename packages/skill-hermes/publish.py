#!/usr/bin/env python3
"""
AgentXP Publisher for Hermes Agent
Publishes experience drafts to relay.agentxp.io with Ed25519 signing.

Usage:
  python3 publish.py <draft_file.json>
  python3 publish.py --batch  (publish all drafts in ~/.hermes/memories/reflection/drafts/)
"""

import os
import sys
import json
import time
import hashlib
import re
import shutil
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

RELAY_URL = "https://relay.agentxp.io"


# ─── Crypto ───────────────────────────────────────────────────────────────────

def _load_crypto():
    """Load Ed25519 signing capability from available libraries."""
    # Try PyNaCl first (already installed with Hermes via discord.py)
    try:
        import nacl.signing
        import nacl.encoding

        def sign(message_bytes, private_key_hex):
            sk = nacl.signing.SigningKey(bytes.fromhex(private_key_hex))
            signed = sk.sign(message_bytes)
            return signed.signature.hex()

        def get_public_key(private_key_hex):
            sk = nacl.signing.SigningKey(bytes.fromhex(private_key_hex))
            return sk.verify_key.encode().hex()

        return sign, get_public_key
    except ImportError:
        pass

    # Fallback: cryptography
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat, PrivateFormat, NoEncryption

        def sign(message_bytes, private_key_hex):
            pk = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(private_key_hex))
            sig = pk.sign(message_bytes)
            return sig.hex()

        def get_public_key(private_key_hex):
            pk = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(private_key_hex))
            pub = pk.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
            return pub.hex()

        return sign, get_public_key
    except ImportError:
        pass

    print("ERROR: Neither 'PyNaCl' nor 'cryptography' found.")
    sys.exit(1)


sign_fn, get_pubkey_fn = _load_crypto()


# ─── Serendip Protocol ────────────────────────────────────────────────────────

def sorted_json(value):
    """Recursively sort keys and produce deterministic JSON (no whitespace)."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(sorted_json(v) for v in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value.keys())
        pairs = [json.dumps(k) + ":" + sorted_json(value[k]) for k in keys]
        return "{" + ",".join(pairs) + "}"
    return json.dumps(value, ensure_ascii=False)


def sha256_hex(data_str):
    """SHA-256 of a UTF-8 string, returned as hex."""
    return hashlib.sha256(data_str.encode("utf-8")).hexdigest()


def create_event(kind, payload, tags):
    """Create an unsigned Serendip event."""
    return {
        "v": 1,
        "created_at": int(time.time()),
        "kind": kind,
        "payload": payload,
        "tags": tags,
        "visibility": "public",
    }


def sign_event(event, private_key_hex, public_key_hex, operator_pubkey_hex):
    """Sign a Serendip event with Ed25519. Returns the fully signed event."""
    with_keys = {
        **event,
        "pubkey": public_key_hex,
        "operator_pubkey": operator_pubkey_hex,
    }
    canonical = sorted_json(with_keys)
    event_id = sha256_hex(canonical)
    id_bytes = bytes.fromhex(event_id)
    sig = sign_fn(id_bytes, private_key_hex)
    return {**with_keys, "id": event_id, "sig": sig}


def delegate_agent_key(operator_private_hex, operator_public_hex):
    """Create a short-lived agent key pair delegated from operator."""
    # For simplicity, use operator key directly (self-delegation)
    # This is valid per protocol: delegatedBy == pubkey
    return operator_private_hex, operator_public_hex, operator_public_hex


# ─── Quality Gate ─────────────────────────────────────────────────────────────

CONCRETE_RE = re.compile(
    r'[/\\]|`[^`]+`|\b\d{2,5}\b|\b\w+\.\w+|\.(?:ts|js|py|md|json|yaml|yml|toml|sh)\b'
    r'|[\u7aef\u53e3\u6587\u4ef6\u547d\u4ee4\u8def\u5f84\u914d\u7f6e\u9519\u8bef\u4fee\u590d\u5d29\u6e83\u8d85\u65f6]'
)


def quality_gate(draft):
    """Check draft quality. Returns (pass, reason)."""
    if len(draft.get("what", "")) <= 10:
        return False, '"what" must be longer than 10 characters'
    if len(draft.get("learned", "")) <= 20:
        return False, '"learned" must be longer than 20 characters'
    if len(draft.get("tried", "")) <= 20:
        return False, '"tried" must be longer than 20 characters'
    if not CONCRETE_RE.search(draft.get("learned", "")):
        if draft.get("outcome") == "succeeded" and len(draft.get("learned", "")) > 50:
            return True, None
        return False, '"learned" must contain at least one concrete detail'
    return True, None


# ─── Relay Interaction ────────────────────────────────────────────────────────

def search_relay(query, limit=3):
    """Search relay for similar experiences. Returns list of matches."""
    from urllib.parse import urlencode
    params = urlencode({"q": query[:300], "limit": str(limit)})
    url = f"{RELAY_URL}/api/v1/search?{params}"
    try:
        req = Request(url, method="GET")
        req.add_header("User-Agent", "agentxp-hermes/1.0")
        with urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
        return data.get("precision", [])
    except Exception:
        return []


def is_duplicate(draft, threshold=0.7):
    """Check if a similar experience already exists on relay."""
    query = f"{draft['what']} {draft['learned']}"
    matches = search_relay(query)
    for m in matches:
        if m.get("match_score", 0) >= threshold:
            return True
    return False


def publish_to_relay(signed_event):
    """POST signed event to relay."""
    url = f"{RELAY_URL}/api/v1/events"
    body = json.dumps(signed_event).encode("utf-8")
    req = Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "agentxp-hermes/1.0")
    try:
        with urlopen(req, timeout=10) as resp:
            return resp.status < 300
    except HTTPError as e:
        print(f"  ✗ Relay returned HTTP {e.code}: {e.read().decode()[:200]}")
        return False
    except URLError as e:
        print(f"  ✗ Network error: {e}")
        return False


# ─── Key Loading ──────────────────────────────────────────────────────────────

def load_keys():
    """Load operator keys from ~/.agentxp/identity/."""
    home = os.path.expanduser("~")
    key_path = os.path.join(home, ".agentxp", "identity", "operator.key")
    pub_path = os.path.join(home, ".agentxp", "identity", "operator.pub")

    if not os.path.exists(key_path) or not os.path.exists(pub_path):
        print("ERROR: No identity keys found. Run setup first:")
        print("  python3 ~/.hermes/skills/productivity/agentxp/setup.py")
        sys.exit(1)

    with open(key_path) as f:
        private_hex = f.read().strip()
    with open(pub_path) as f:
        public_hex = f.read().strip()

    return private_hex, public_hex


# ─── Main ─────────────────────────────────────────────────────────────────────

def publish_draft(draft_path, move_after=True):
    """Publish a single draft file to relay."""
    with open(draft_path) as f:
        draft = json.load(f)

    print(f"\n📤 Publishing: {draft.get('what', '?')[:60]}")

    # Quality gate
    passed, reason = quality_gate(draft)
    if not passed:
        print(f"  ⚠ Quality gate failed: {reason}")
        print(f"  → Keeping as local-only")
        if move_after:
            _move_to(draft_path, "local")
        return False

    # Duplicate check
    if is_duplicate(draft):
        print(f"  ⚠ Similar experience already exists on relay — skipping")
        if move_after:
            _move_to(draft_path, "dup")
        return False

    # Load keys and sign
    private_hex, public_hex = load_keys()
    agent_priv, agent_pub, operator_pub = delegate_agent_key(private_hex, public_hex)

    payload = {
        "type": "experience",
        "data": {
            "what": draft["what"],
            "tried": draft["tried"],
            "outcome": draft.get("outcome", "unknown"),
            "learned": draft["learned"],
        }
    }
    if draft.get("context"):
        payload["data"]["context"] = draft["context"]

    event = create_event("intent.broadcast", payload, [])
    signed = sign_event(event, agent_priv, agent_pub, operator_pub)

    # Publish
    if publish_to_relay(signed):
        print(f"  ✓ Published to relay (id: {signed['id'][:16]}...)")
        if move_after:
            _move_to(draft_path, "published")
        return True
    else:
        print(f"  ✗ Failed to publish")
        return False


def _move_to(draft_path, dest_prefix):
    """Move a draft to the published/ directory with a prefix."""
    home = os.path.expanduser("~")
    published_dir = os.path.join(home, ".hermes", "memories", "reflection", "published")
    os.makedirs(published_dir, exist_ok=True)
    filename = os.path.basename(draft_path)
    dest = os.path.join(published_dir, f"{dest_prefix}-{filename}")
    shutil.move(draft_path, dest)


def batch_publish():
    """Publish all pending drafts."""
    home = os.path.expanduser("~")
    drafts_dir = os.path.join(home, ".hermes", "memories", "reflection", "drafts")
    if not os.path.exists(drafts_dir):
        print("No drafts directory found.")
        return

    draft_files = [f for f in os.listdir(drafts_dir) if f.endswith(".json")]
    if not draft_files:
        print("No pending drafts.")
        return

    print(f"Found {len(draft_files)} draft(s)")
    published = 0
    for f in draft_files:
        if publish_draft(os.path.join(drafts_dir, f)):
            published += 1

    print(f"\n✓ Published {published}/{len(draft_files)} experiences")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 publish.py <draft_file.json>")
        print("  python3 publish.py --batch")
        sys.exit(1)

    if sys.argv[1] == "--batch":
        batch_publish()
    else:
        publish_draft(sys.argv[1])
