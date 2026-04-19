"""Thin CLI dispatcher for agentxp-hermes.

Errors surface as readable messages, not stack traces — SPEC
03-modules-product §3 (inherited) + §4 wire-contract parity.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional, Sequence

from .identity import OperatorKeyMissingError
from .init import init_workspace
from .reflect import (
    DraftInput,
    DraftValidationError,
    capture_end_of_session_draft,
    capture_in_session_draft,
    open_store_for_target,
    reflect,
)


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="agentxp-hermes", description="AgentXP Skill-Hermes")
    sub = p.add_subparsers(dest="cmd", required=True)

    init = sub.add_parser("init", help="seed SKILL.md and identity material")
    init.add_argument("--dir", default=None)

    ref = sub.add_parser("reflect", help="publish staged drafts to the relay")
    ref.add_argument("--dir", default=None)

    cap = sub.add_parser("capture", help="stage a reflection draft")
    cap.add_argument("--dir", default=None)
    cap.add_argument("--tier", choices=["in-session", "end-of-session"], default="in-session")
    cap.add_argument("--what", required=True)
    cap.add_argument("--tried", required=True)
    cap.add_argument(
        "--outcome",
        required=True,
        choices=["succeeded", "failed", "partial", "inconclusive"],
    )
    cap.add_argument("--learned", required=True)
    cap.add_argument("--tag", action="append", default=[])

    return p


def run(argv: Optional[Sequence[str]] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    target = Path(args.dir) if args.dir else Path.cwd()

    try:
        if args.cmd == "init":
            result = init_workspace(target)
            print(
                ("skill installed: " if result.created else "skill already present: ")
                + str(result.skill_path)
            )
            print(f"operator pubkey: {result.operator_pubkey}")
            return 0

        if args.cmd == "reflect":
            outcome = reflect(target)
            print(
                f"published={len(outcome.published)} "
                f"retry={len(outcome.retry)} "
                f"rejected={len(outcome.rejected)}"
            )
            for r in outcome.published:
                print(f"  ok event_id={r.event_id}")
            for r in outcome.rejected:
                print(f"  rejected draft={r.draft_id} {r.error or ''}")
            for r in outcome.retry:
                print(f"  retry draft={r.draft_id} {r.error or ''}")
            return 2 if outcome.rejected else 0

        if args.cmd == "capture":
            store = open_store_for_target(target)
            try:
                draft = DraftInput(
                    what=args.what,
                    tried=args.tried,
                    outcome=args.outcome,
                    learned=args.learned,
                    tags=list(args.tag),
                )
                if args.tier == "end-of-session":
                    row = capture_end_of_session_draft(store, draft)
                else:
                    row = capture_in_session_draft(store, draft)
                print(f"captured draft={row.id} tier={row.tier}")
                return 0
            finally:
                store.close()

        parser.error(f"unknown command: {args.cmd}")
        return 1
    except OperatorKeyMissingError as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    except DraftValidationError as err:
        print(f"error: {err} (field: {err.field})", file=sys.stderr)
        return 1
    except Exception as err:  # noqa: BLE001 — CLI boundary
        print(f"error: {err}", file=sys.stderr)
        return 1


def main() -> None:
    sys.exit(run())


if __name__ == "__main__":
    main()
