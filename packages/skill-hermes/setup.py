#!/usr/bin/env python3
"""AgentXP setup for Hermes Agent — creates reflection dirs + signing keys."""

import os
import sys
import json
import hashlib

def ensure_dir(path):
    os.makedirs(path, exist_ok=True)

def generate_ed25519_keypair():
    """Generate Ed25519 keypair using Python's cryptography lib or nacl."""
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat, PrivateFormat, NoEncryption
        
        private_key = Ed25519PrivateKey.generate()
        private_bytes = private_key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
        public_bytes = private_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        return private_bytes.hex(), public_bytes.hex()
    except ImportError:
        pass

    # Fallback: PyNaCl (already installed with Hermes for discord.py)
    try:
        import nacl.signing
        signing_key = nacl.signing.SigningKey.generate()
        private_hex = signing_key.encode().hex()
        public_hex = signing_key.verify_key.encode().hex()
        return private_hex, public_hex
    except ImportError:
        pass

    print("ERROR: Neither 'cryptography' nor 'PyNaCl' found. Install one:")
    print("  pip install cryptography")
    print("  pip install PyNaCl")
    sys.exit(1)

def main():
    home = os.path.expanduser("~")
    hermes_home = os.path.join(home, ".hermes")
    
    # 1. Create reflection directories
    reflection_dir = os.path.join(hermes_home, "memories", "reflection")
    drafts_dir = os.path.join(reflection_dir, "drafts")
    published_dir = os.path.join(reflection_dir, "published")
    
    for d in [reflection_dir, drafts_dir, published_dir]:
        ensure_dir(d)
        print(f"  ✓ {d}")

    # 2. Create reflection files if they don't exist
    for fname in ["mistakes.md", "lessons.md", "feelings.md", "thoughts.md"]:
        fpath = os.path.join(reflection_dir, fname)
        if not os.path.exists(fpath):
            with open(fpath, "w") as f:
                f.write(f"# {fname.replace('.md', '').title()}\n\n")
            print(f"  ✓ Created {fpath}")
        else:
            print(f"  · {fpath} (already exists)")

    # 3. Generate identity keys
    identity_dir = os.path.join(home, ".agentxp", "identity")
    key_path = os.path.join(identity_dir, "operator.key")
    pub_path = os.path.join(identity_dir, "operator.pub")

    if os.path.exists(key_path) and os.path.exists(pub_path):
        with open(pub_path) as f:
            pubkey = f.read().strip()
        print(f"  · Keys already exist (pubkey: {pubkey[:16]}...)")
    else:
        ensure_dir(identity_dir)
        private_hex, public_hex = generate_ed25519_keypair()

        with open(key_path, "w") as f:
            f.write(private_hex)
        os.chmod(key_path, 0o600)

        with open(pub_path, "w") as f:
            f.write(public_hex)

        print(f"  ✓ Generated Ed25519 keys")
        print(f"    Public key: {public_hex[:16]}...")
        print(f"    Key path: {key_path}")

    print("\n✓ AgentXP setup complete!")
    print(f"  Reflection dir: {reflection_dir}")
    print(f"  Identity dir: {identity_dir}")

if __name__ == "__main__":
    main()
