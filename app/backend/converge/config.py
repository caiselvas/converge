"""Runtime configuration (paths, optional API keys)."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

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
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
ANTHROPIC_MODEL = os.environ.get("CONVERGE_LLM_MODEL", "").strip() or "claude-haiku-5-5"
OPENAI_MODEL = os.environ.get("CONVERGE_OPENAI_MODEL", "").strip() or "gpt-6-luna"
LLM_PROVIDER = os.environ.get("CONVERGE_LLM_PROVIDER", "auto").strip().lower() or "auto"

if LLM_PROVIDER not in {"auto", "anthropic", "openai"}:
    raise ValueError("CONVERGE_LLM_PROVIDER must be auto, anthropic or openai")

Provider = Literal["anthropic", "openai"]


def llm_provider() -> Provider | None:
    if LLM_PROVIDER == "anthropic" or (LLM_PROVIDER == "auto" and ANTHROPIC_API_KEY):
        return "anthropic"
    if LLM_PROVIDER == "openai" or (LLM_PROVIDER == "auto" and OPENAI_API_KEY):
        return "openai"
    return None
