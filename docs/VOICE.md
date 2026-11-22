# Voice discovery

Voice lives in Ask on Overview, Goals and Expenses. It introduces itself as AI, interviews the current viewer about goals, and offers simulations from Converge’s deterministic engine. The viewer can skip sensitive topics, inspect the evidence behind each observation and clear their memory. The app uses the UBS synthetic twin.

## Architecture

- **Transport.** Realtime uses browser-to-OpenAI WebRTC. The backend mints a short-lived secret and the browser relays tools and transcripts over the existing app API. Local mode uses a same-origin WebSocket, an AudioWorklet for 16 kHz PCM, a push-to-talk control, a server-side energy gate, faster-whisper, an OpenAI-compatible local chat server, and Piper. Both use the same tool dispatcher.
- **Discovery.** `voice.sqlite3` lives in `CONVERGE_STATE_DIR`. Sessions, transcripts, memory, question history and recent tool facts are scoped to the viewer. Facts require a matching user quote. A pending inference can become confirmed when the viewer verifies it. Unknowns explain why the detail matters. Extraction uses the configured typed provider with an offline fallback. Local transport keeps extraction offline and can add pending observations through the local model’s tool calls.
- **Plan tools.** `execute_tool` validates requests with Pydantic and applies the existing lever whitelist before evaluating changes. The model can compare a scenario before a goal is confirmed. A confirmed goal needs an amount and calendar month before it can be added to a draft. The normal DraftBar handles review and approvals.
- **Grounding.** After each assistant turn, transcript numbers are compared against the recent engine responses. The app flags a mismatch and logs only the count. This lexical check can miss a wrong claim that reuses a correct number in a different context.

## Configuration

Set values in the ignored root `.env` and restart the backend. Keep API keys there.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CONVERGE_VOICE_PROVIDER` | `off` | `off`, `openai_realtime` or `local` |
| `OPENAI_API_KEY` | empty | Server-side key for Realtime session secrets |
| `CONVERGE_VOICE_MAX_SECONDS` | `300` | App session cap, constrained to 30–900 seconds |
| `CONVERGE_STATE_DIR` | `app/backend/.state` | Local workspace and SQLite directory |
| `CONVERGE_LOCAL_LLM_URL` | `http://127.0.0.1:11434/v1` | Loopback OpenAI-compatible API base |
| `CONVERGE_LOCAL_LLM_MODEL` | empty | Local model with tool support |
| `CONVERGE_LOCAL_STT_MODEL` | empty | Absolute path to the faster-whisper model directory |
| `CONVERGE_LOCAL_TTS_MODEL` | empty | Absolute path to the Piper ONNX file, beside its `.onnx.json` |

For a text-only session, from the repository root run:

```sh
PYTHONPATH=app/backend app/backend/.venv/bin/python scripts/discovery_chat.py
```

Use `--person P00809` to interview Emil or `--provider` to enable the configured extraction provider. The CLI is offline by default.

### Phone and HTTPS

Start Converge with `make dev`. Enable MagicDNS and HTTPS on a private tailnet and sign both the development machine and phone into it. Run `tailscale serve 3000` on the development machine and open the HTTPS URL it prints on the phone. Leave the backend on its local port. Stop Serve when finished. If Next.js blocks the dev origin, add the exact tailnet hostname to its `allowedDevOrigins` for your dev session. Use only trusted devices because the demo viewer switch does not authenticate users. [Tailscale Serve setup](https://tailscale.com/docs/features/tailscale-serve)

### Optional local setup

After syncing the existing backend environment, install the optional packages into the existing virtual environment. The following commands are for an operator who chooses to install the models:

```sh
uv pip install --python app/backend/.venv/bin/python faster-whisper piper-tts huggingface_hub
mkdir -p /tmp/converge-voice-models
app/backend/.venv/bin/hf download Systran/faster-whisper-tiny --local-dir /tmp/converge-voice-models/whisper-tiny
app/backend/.venv/bin/python -m piper.download_voices en_US-lessac-medium --data-dir /tmp/converge-voice-models
ollama serve
```

In a second terminal, use an installed, tool-capable Ollama model from `ollama list`, or explicitly download one with `ollama pull qwen3:0.6b` if its roughly 523 MB download is acceptable. Set the model name to `CONVERGE_LOCAL_LLM_MODEL`, the Whisper directory to `CONVERGE_LOCAL_STT_MODEL`, and `/tmp/converge-voice-models/en_US-lessac-medium.onnx` to `CONVERGE_LOCAL_TTS_MODEL`. Set the provider to `local`. Run `cd app/backend && uv run --no-sync uvicorn converge.api:app --port 8000` in the backend terminal and `make frontend` from the repository root in another. A later exact environment sync may remove optional packages. [faster-whisper](https://github.com/SYSTRAN/faster-whisper) · [Piper voices](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/CLI.md) · [Ollama model size](https://ollama.com/library/qwen3%3A0.6b)

## Decisions made

- Realtime uses `gpt-realtime-2.1-mini`, the cheapest maintained Realtime conversational model documented with tool calling. Voice defaults off. Local mode remains opt-in and loads only model files already on disk. [Model and pricing](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini)
- Scope affects the plan views and typed Ask. Voice memory follows **Viewing as**. Personal savings goals use the viewer’s goal list. A confirmed home purchase budget and month use shared property price and target-date levers. Scheduling the actual purchase is a separate plan decision.
- The app starts with a goal, asks one missing detail at a time, and asks permission before risk comfort. It uses existing income, spending, balances and debts from the twin. It treats a year-only answer as incomplete until the viewer gives a month.
- The browser stages a scenario only after the viewer clicks **Add to draft**. Confirmation changes memory only. A scenario that includes hypothetical personal goals can be simulated before confirmation without adding those goals to the draft.
- Audio is transient. Realtime sends audio directly to OpenAI for processing. Hosted extraction sends the current transcript and question context to the configured provider. Converge stores only text and JSON in SQLite. **Clear discovery memory** deletes the selected viewer’s sessions, transcripts and memory in Converge. Provider-side handling follows the provider’s settings and policies.
- The app mints at most ten Realtime or local admissions per process per rolling hour, counting failed startup attempts. A Realtime credential expires after 30 seconds. The browser releases audio on End, page hide, max duration or 30 seconds idle. The backend expires tool sessions and local sockets. OpenAI’s credential expiry limits when a call can start. Browser teardown applies the app cap to its Realtime connection.
- Local mode uses push-to-talk with a short PCM buffer and an energy-based VAD. It streams transient WAV fragments back to the browser. Quality, language coverage and latency depend on the installed local models. Recommendation preference weighting is a follow-up.

## Verification limits

See [the checkpoint log](VOICE_PROGRESS.md) and [the six-step audio checklist](VOICE_TEST.md). Realtime was exercised with mocks and rendered in Chrome, with no audio and no live mint because the backend had no OpenAI key. The local pipeline ran through the WebSocket with fake STT, LLM and TTS. Provider audio and real local models remain for manual verification. Simulated plan results are for planning only.
