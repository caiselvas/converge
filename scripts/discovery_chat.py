"""Talk to the configured Anthropic or OpenAI coaching model using the shared discovery tools."""
import argparse
import asyncio
import json
import re

from converge import ai, config
from converge.seed import default_plan
from converge.voice.realtime import INSTRUCTIONS
from converge.voice.routes import ingest_turn, memory_db
from converge.voice.tools import Session, definitions, execute_tool, unmatched_numbers


class ToolRequest(ai.StructuredOutput):
    name: str
    arguments_json: str


class CoachReply(ai.StructuredOutput):
    reply: str | None
    calls: list[ToolRequest]


TURN_RULES = """
Return either a conversational reply or a list of tool calls, never both. Each tool's arguments_json is a JSON object string.
After tool results, continue with another call or a brief reply that addresses the current user turn. Call real tools, do not describe imagined results.
When confirming an underlying objective, save it on the confirmation turn before moving on; keep the exact user evidence.
Use the exact tool figures or its preformatted speakable wording. Only restate numeric user assumptions after a simulation has echoed them.
Do not use shorthand like 293k or convert decimals to percentages unless the tool already supplied that percentage.
Only say memory was saved when a tool result or the supplied confirmed objectives shows that it was.
Do not persist personal information outside the synthetic plan discovery session.
"""


def questions(text):
    return {re.sub(r"[^\w ]", "", part).strip() for part in re.findall(r"[^.!?]+\?", text.casefold())}


async def coach(session, provider, model, usage):
    objectives = [i for i in session.memory.items(session.person_id)
                  if i["status"] == "confirmed" and i["key"].endswith(".underlying_objective")]
    viewer = session.plan.person(session.person_id)
    context = {"viewer": {"name": viewer.name, "person_id": viewer.id}, "conversation": session.memory.recent_turns(session.id, 12), "tool_results_this_turn": [],
               "confirmed_objectives": [{"key": i["key"], "value": i["value"]} for i in objectives]}
    asked = set().union(*(questions(turn["text"]) for turn in context["conversation"] if turn["speaker"] == "assistant"))
    instructions = INSTRUCTIONS + TURN_RULES + "\nTools: " + json.dumps(definitions(), separators=(",", ":"))
    for _ in range(6):
        raw = await asyncio.to_thread(ai._call_structured, provider, model, instructions,
                                      json.dumps(context, ensure_ascii=False), CoachReply, 1600, usage=usage)
        if len(raw.calls) > 3:
            raise ValueError("The coach exceeded the tool limit for a response.")
        if raw.calls:
            for call in raw.calls:
                try:
                    args = json.loads(call.arguments_json)
                    result = execute_tool(call.name, args, session)
                except (ValueError, TypeError) as error:
                    result = {"error": str(error)}
                context["tool_results_this_turn"].append({"tool": call.name, "result": result})
        elif raw.reply and raw.reply.strip():
            if questions(raw.reply) & asked:
                context["revision"] = {"draft": raw.reply, "issue": "Ask at most one question and avoid repeating an earlier question."}
                continue
            if unsupported := unmatched_numbers(session, raw.reply):
                context["revision"] = {"draft": raw.reply, "unsupported_numbers": unsupported,
                                       "issue": "Remove unsupported numbers or use the exact figures already returned by tools."}
                continue
            return raw.reply.strip()
    raise ValueError("The coaching turn ran out of tool rounds.")


async def chat(args):
    provider = config.llm_provider()
    if not provider or not ai.llm_available():
        print("Configure an Anthropic or OpenAI key for the discovery coach.")
        return
    model = ai.llm_model(provider)
    plan = default_plan()
    person = plan.person(args.person or plan.people[0].id)
    memory = memory_db()
    session = Session(memory, memory.start(person.id), plan)
    usage = []
    print(f"AI discovery coach · {person.name} · {provider}/{model}")
    print("Commands /memory, /confirm ID, /draft, /quit")
    try:
        while True:
            text = input("You: ").strip()
            if not text:
                continue
            if text == "/quit":
                break
            if text == "/memory":
                for item in memory.items(person.id):
                    if item["status"] != "rejected":
                        print(item["id"], item["status"], item["key"], item["value"], repr(item["quote"] or item["why"]))
                continue
            try:
                if text.startswith("/confirm "):
                    memory.resolve(person.id, int(text.split()[1]), "confirmed")
                elif text == "/draft":
                    print(execute_tool("propose_changes", {"from_confirmed_goals": True}, session))
                else:
                    await ingest_turn(session, "user", text, usage=usage)
                    reply = await coach(session, provider, model, usage)
                    result = await ingest_turn(session, "assistant", reply)
                    print(f"AI: {reply}")
                    if not result["grounded"]:
                        print("[Numeric grounding flagged this reply]")
                    if result["multiple_questions"]:
                        print("[Multiple questions flagged in this reply]")
            except Exception as error:
                print(f"Coaching turn failed ({type(error).__name__}).")
    except (EOFError, KeyboardInterrupt):
        pass
    finally:
        print(f"Usage: {sum(i for i, _ in usage):,} input / {sum(o for _, o in usage):,} output tokens ({len(usage)} calls).")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--person", help="Demo profile ID, e.g. P00809 for Emil.")
    asyncio.run(chat(parser.parse_args()))
