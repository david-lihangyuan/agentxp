#!/usr/bin/env python3
"""AgentXP setup for Hermes Agent v1.2.0 — creates reflection dirs, signing keys, and pre-loads experiences."""

import os
import sys
import json

SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATES_DIR = os.path.join(SKILL_DIR, "templates")


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


def preload_reflection_file(reflection_dir, fname, template_path):
    """Write pre-loaded content to a reflection file if it doesn't already have pre-loaded entries."""
    fpath = os.path.join(reflection_dir, fname)

    # Check if pre-loaded content already exists
    if os.path.exists(fpath):
        with open(fpath) as f:
            content = f.read()
        if "[pre-loaded]" in content:
            print(f"  · {fpath} (pre-loaded content already present)")
            return

    # Load template content
    if os.path.exists(template_path):
        with open(template_path) as f:
            template_content = f.read()
        # Add [pre-loaded] tag to each ## heading
        tagged = template_content.replace("\n## ", "\n## [pre-loaded] ")
        # First heading too
        if tagged.startswith("## "):
            tagged = "## [pre-loaded] " + tagged[3:]
    else:
        tagged = f"# {fname.replace('.md', '').title()}\n\n"
        print(f"  ⚠ Template not found: {template_path} — creating empty file")

    # Prepend to existing file or create new
    if os.path.exists(fpath):
        with open(fpath) as f:
            existing = f.read()
        with open(fpath, "w") as f:
            f.write(tagged + "\n\n---\n\n" + existing)
        print(f"  ✓ Pre-loaded content prepended to {fpath}")
    else:
        with open(fpath, "w") as f:
            f.write(tagged)
        print(f"  ✓ Created {fpath} with pre-loaded content")


def main():
    home = os.path.expanduser("~")
    hermes_home = os.path.join(home, ".hermes")

    # 1. Create reflection directory structure
    reflection_dir = os.path.join(hermes_home, "memories", "reflection")
    subdirs = [
        reflection_dir,
        os.path.join(reflection_dir, "drafts"),
        os.path.join(reflection_dir, "published"),
        os.path.join(reflection_dir, "traces"),  # new in v1.2.0
    ]

    print("Creating directory structure...")
    for d in subdirs:
        ensure_dir(d)
        print(f"  ✓ {d}")

    # 2. Create / pre-load reflection files
    print("\nSetting up reflection files...")

    # Pre-load mistakes and lessons from templates
    for fname, template_name in [
        ("mistakes.md", "preloaded-mistakes.md"),
        ("lessons.md", "preloaded-lessons.md"),
    ]:
        template_path = os.path.join(TEMPLATES_DIR, template_name)
        preload_reflection_file(reflection_dir, fname, template_path)

    # Create other reflection files if they don't exist
    for fname in ["feelings.md", "thoughts.md"]:
        fpath = os.path.join(reflection_dir, fname)
        if not os.path.exists(fpath):
            with open(fpath, "w") as f:
                f.write(f"# {fname.replace('.md', '').title()}\n\n")
            print(f"  ✓ Created {fpath}")
        else:
            print(f"  · {fpath} (already exists)")

    # 3. Generate identity keys
    print("\nSetting up identity keys...")
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

    print("\n✓ AgentXP v1.2.0 setup complete!")
    print(f"  Reflection dir: {reflection_dir}")
    print(f"  Traces dir:     {os.path.join(reflection_dir, 'traces')}")
    print(f"  Identity dir:   {identity_dir}")
    print("\nNext: the skill is ready. Pre-loaded experiences are in mistakes.md and lessons.md.")


if __name__ == "__main__":
    main()
