"""`agentxp-hermes init` — seed SKILL.md and ensure the operator key."""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Optional

from .identity import ensure_operator_key


def _skill_asset_path() -> Path:
    # SKILL.md ships inside the package so resource resolution works
    # identically from source tree and from an installed wheel.
    return Path(str(resources.files("agentxp_skill_hermes").joinpath("SKILL.md")))


@dataclass
class InitResult:
    skill_path: Path
    reflections_dir: Path
    operator_pubkey: str
    created: bool


def init_workspace(
    target_dir: Path | str,
    identity_root: Optional[Path | str] = None,
    asset_path: Optional[Path | str] = None,
) -> InitResult:
    target = Path(target_dir)
    target.mkdir(parents=True, exist_ok=True)
    skill_path = target / "SKILL.md"
    reflections_dir = target / ".agentxp" / "reflections"
    reflections_dir.mkdir(parents=True, exist_ok=True)

    source = Path(asset_path) if asset_path is not None else _skill_asset_path()
    already = skill_path.exists()
    if not already:
        shutil.copyfile(source, skill_path)

    config_path = target / ".agentxp" / "config.json"
    if not config_path.exists():
        config_path.write_text(
            json.dumps({"relay_url": "http://localhost:3141", "agent_id": "default"}, indent=2)
        )

    op = ensure_operator_key(identity_root)
    return InitResult(
        skill_path=skill_path,
        reflections_dir=reflections_dir,
        operator_pubkey=op.public_key,
        created=not already,
    )
