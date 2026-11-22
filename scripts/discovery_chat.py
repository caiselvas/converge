"""Run the discovery controller without a browser. Offline unless --provider is set."""
import argparse
import asyncio

from converge import config
from converge.seed import default_plan
from converge.voice.routes import ingest_turn, memory_db
from converge.voice.tools import Session, execute_tool


async def chat(args):
    if not args.provider:
        config.LLM_PROVIDER = "auto"
        config.ANTHROPIC_API_KEY = config.OPENAI_API_KEY = ""
    plan = default_plan()
    person = args.person or plan.people[0].id
    plan.person(person)
    memory = memory_db()
    session = Session(memory, memory.start(person), plan)
    print("AI discovery assistant · synthetic data · simulations only")
    print("Commands: /memory, /confirm ID, /draft, /summary, /clear, /quit")
    print(execute_tool("next_question", {}, session)["question"])
    while True:
        try:
            text = input("> ").strip()
            if not text:
                continue
            if text == "/quit":
                return
            if text == "/memory":
                for item in memory.items(person):
                    print(item["id"], item["status"], item["key"], item["value"], item["quote"] or item["why"])
            elif text.startswith("/confirm "):
                memory.resolve(person, int(text.split()[1]), "confirmed")
            elif text == "/draft":
                print(execute_tool("propose_changes", {"from_confirmed_goals": True}, session))
            elif text == "/summary":
                print(execute_tool("get_summary", {}, session)["speakable"])
            elif text == "/clear":
                memory.clear(person)
                session = Session(memory, memory.start(person), plan)
            else:
                await ingest_turn(session, "user", text)
                print(execute_tool("next_question", {}, session)["question"])
        except (EOFError, KeyboardInterrupt):
            return
        except ValueError as error:
            print(error)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--person")
    parser.add_argument("--provider", action="store_true", help="Enable the configured text extraction provider.")
    asyncio.run(chat(parser.parse_args()))
