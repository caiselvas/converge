"""Bounded, provider-independent tool loop for the finance agent."""
from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from converge import config
from converge.voice.tools import Session, definitions, execute_tool


@dataclass(frozen=True)
class Provider:
    name: str
    url: str
    model: str
    key: str = ""


def provider() -> Provider | None:
    mode = config.AGENT_PROVIDER
    if mode == "local" or (mode == "auto" and config.LOCAL_LLM_MODEL):
        url = urlparse(config.LOCAL_LLM_URL)
        if url.scheme in {"http", "https"} and url.hostname in {"127.0.0.1", "localhost", "::1"} and not url.username and config.LOCAL_LLM_MODEL:
            return Provider("local", config.LOCAL_LLM_URL, config.LOCAL_LLM_MODEL)
        return None
    if mode in {"auto", "openai"} and config.OPENAI_API_KEY:
        return Provider("openai", "https://api.openai.com/v1", config.AGENT_MODEL or "gpt-5-mini", config.OPENAI_API_KEY)
    if mode in {"auto", "openrouter"} and config.OPENROUTER_API_KEY:
        return Provider("openrouter", "https://openrouter.ai/api/v1", config.AGENT_MODEL or "openai/gpt-5-mini", config.OPENROUTER_API_KEY)
    return None


def chat_tools() -> list[dict]:
    return [{"type": "function", "function": {k: v for k, v in item.items() if k != "type"}}
            for item in definitions()]


async def complete(client: httpx.AsyncClient, selected: Provider, messages: list[dict]) -> dict:
    if selected.name == "openai":
        options = {"max_completion_tokens": 1800}
        if selected.model == "gpt-5-mini":
            options["reasoning_effort"] = "minimal"
    elif selected.name == "local":
        options = {"max_tokens": 500, "temperature": 0}
    else:
        options = {"max_tokens": 1800}
    result = await client.post(
        selected.url.rstrip("/") + "/chat/completions",
        headers={"Authorization": f"Bearer {selected.key}"} if selected.key else {},
        json={"model": selected.model, "messages": messages, "tools": chat_tools(), **options},
        follow_redirects=False,
    )
    result.raise_for_status()
    return result.json()["choices"][0]["message"]


async def run_tools(session: Session, messages: list[dict], next_message, on_tool, on_tool_start=None) -> str:
    for _ in range(6):
        message = await next_message(messages)
        calls = message.get("tool_calls") or []
        if not calls:
            answer = str(message.get("content") or "").strip()[:3000]
            if answer:
                return answer
            raise ValueError("The model returned an empty reply.")
        if len(calls) > 6:
            break
        messages.append({"role": "assistant", "content": message.get("content"), "tool_calls": calls})
        for call in calls:
            function = call["function"]
            name = function["name"]
            if on_tool_start is not None:
                on_tool_start(name)
            try:
                result = await asyncio.to_thread(execute_tool, name, json.loads(function["arguments"]), session)
            except (ValueError, KeyError) as error:
                result = {"error": str(error)[:500]}
            await on_tool(name, result)
            facts = {key: value for key, value in result.items() if key != "draft_changes"}
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(facts, ensure_ascii=False)})
    raise ValueError("The finance agent reached its tool limit for this turn.")
