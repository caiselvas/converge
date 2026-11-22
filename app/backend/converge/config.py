"""Runtime configuration (paths, optional API keys)."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent.parent

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_DIR / ".env")

UBS_DATA_DIR = Path(os.environ.get("CONVERGE_UBS_DATA_DIR", REPO_ROOT / "external" / "ubs" / "Data"))
STATE_DIR = Path(os.environ.get("CONVERGE_STATE_DIR", BACKEND_DIR / ".state"))
CACHE_DIR = Path(os.environ.get("CONVERGE_CACHE_DIR", BACKEND_DIR / ".cache"))

# Demo couple (hypothetical relationship between two independent synthetic profiles).
DEFAULT_PARTNERS = tuple(os.environ.get("CONVERGE_PARTNERS", "P00918,P00809").split(","))

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
ANTHROPIC_MODEL = os.environ.get("CONVERGE_LLM_MODEL", "claude-opus-5-5")
