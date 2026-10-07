"""Thin subprocess wrapper around duckai.py, the "test model" being steered."""
import subprocess
import sys
from pathlib import Path

DUCKAI_PATH = Path(__file__).resolve().parent / "duckai.py"


class ModelError(Exception):
    pass


def ask_model(prompt: str, timeout_s: float = 90.0) -> str:
    try:
        result = subprocess.run(
            [sys.executable, str(DUCKAI_PATH), prompt, "--timeout", str(timeout_s)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout_s + 20,
        )
    except subprocess.TimeoutExpired as e:
        raise ModelError(f"duckai.py did not respond within {timeout_s + 20:.0f}s") from e

    if result.returncode != 0:
        raise ModelError((result.stderr or "").strip() or "duckai.py failed with no error output")

    reply = (result.stdout or "").strip()
    if not reply:
        raise ModelError("duckai.py returned an empty reply")
    return reply
