# Voice discovery

The assistant opens from **Ask** on any page (a full-screen sheet on phones, `/agent` as a full page). Inside a decision planner it receives the engine's comparison of the options on screen. Without a configured agent model it falls back to the built-in parser and engine summaries. **Talk instead** opens the optional voice call (`/call`). The assistant profile (`/profile`, also under `···`) shows the current viewer’s goals, motivations, priorities, timelines, and limits recorded by the agent across chat and calls. The viewer can inspect supporting quotes, confirm or remove observations, and clear the stored profile and conversation history. The app uses the UBS synthetic twin.

## Architecture

- **Transport.** Text chat and local speech use a bounded server-side model/tool loop. Realtime uses browser-to-OpenAI WebRTC. The backend mints a short-lived secret and the browser relays tools and transcripts over the app API. Local speech uses a same-origin WebSocket, an AudioWorklet for 16 kHz PCM, a push-to-talk control, faster-whisper, an OpenAI-compatible local model, and Piper. All three transports use the same dispatcher and validation. A call can run from a phone browser over HTTPS. The app does not provision a public telephone number.
- **Discovery.** `voice.sqlite3` lives in `CONVERGE_STATE_DIR`. Sessions, transcripts, memory and recent tool facts are scoped to the viewer. Facts require a matching user quote. An underlying objective stays an inference until the viewer confirms it in their own words. Unknowns explain why the detail matters. Extraction uses the configured typed provider with an offline fallback. Local transport keeps extraction offline and can add pending observations through the local model’s tool calls.
- **Plan tools.** `execute_tool` validates requests with Pydantic and applies the existing lever whitelist before evaluating changes. The agent can read profile facts, check what it knows about the viewer’s goals, compare with the baseline, or request verified alternatives. The chat streams tool activity while each tool runs, and simulations show cards sourced directly from the engine. A confirmed goal needs an amount and calendar month before it can be added to a draft. The normal DraftBar handles review and approvals.
- **Grounding.** The app compares numeric magnitudes in a reply with recent tool facts. Chat falls back to verified engine wording for calculated results or asks for a missing study assumption during discovery. The hosted call flags unverified figures in its transcript after the audio has played. The lexical check cannot establish that a number is assigned to the right fact or that every non-numeric claim is correct.

## Configuration

Set values in the ignored root `.env` and restart the backend. Keep API keys there.

| Variable | Default | Purpose |
| --- | --- | --- |
| `CONVERGE_AGENT_PROVIDER` | `auto` | `auto`, `local`, `openai`, `openrouter` or `off`. Auto prefers a configured local model, then OpenAI, then OpenRouter |
| `CONVERGE_AGENT_MODEL` | `gpt-5-mini` on OpenAI, `openai/gpt-5-mini` on OpenRouter | Optional hosted tool-capable chat model override |
| `CONVERGE_VOICE_PROVIDER` | `openai_realtime` when an OpenAI key is present, otherwise `off` | `off`, `openai_realtime` or `local` |
| `OPENAI_API_KEY` | empty | Server-side key for chat and Realtime session secrets |
| `OPENROUTER_API_KEY` | empty | Server-side key for OpenRouter chat |
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

Use `--person P00809` to interview Emil. The CLI uses the configured Anthropic or OpenAI provider and reports input and output tokens on exit.

### Phone and HTTPS

Open the app’s HTTPS URL on the phone, then choose **Agent → Voice call → Start call**. Grant microphone access and use **Enable sound** if the browser blocks playback. After the call, choose **Review your profile** to see saved observations. The desktop Agent page keeps chat available.

The hosted call uses a longer silence window for natural pauses and keeps the connection open after failed transcription or an incomplete response. If the transcript misses a key detail, repeat it once the call is listening.

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

Qwen3 4B Instruct can need more context than Ollama's 4K setting when the engine returns a comparison. To reuse the installed weights with an 8K context, put these two lines in a Modelfile:

```text
FROM qwen3:4b-instruct
PARAMETER num_ctx 8192
```

Run `ollama create converge-qwen3:4b-instruct -f Modelfile` and set `CONVERGE_LOCAL_LLM_MODEL=converge-qwen3:4b-instruct` before starting the backend. The local turn has a four-minute processing limit. The 30-second idle timer resumes after playback. [Ollama context configuration](https://docs.ollama.com/api/openai-compatibility#setting-the-local-context-size)

## Decisions made

- Realtime uses `gpt-realtime-2.1-mini` with tool calling. For local text and speech, configure both providers as `local` and point them at the installed loopback model. Local speech also needs the speech model files. [Realtime model](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini)
- Chat and voice both follow **Viewing as** and share that viewer’s discovery memory. Each new call starts a separate conversation. Personal savings goals use the viewer’s goal list. A confirmed home purchase budget and month use shared property price and target-date levers. Scheduling the actual purchase is a separate plan decision.
- The coach answers the viewer’s questions first and uses `get_gaps` to see what still needs clarification. It chooses its own questions and checks the objective behind a stated goal. `get_profile` labels existing figures by provenance. `compare_paths` compares simulations and dates the lead under the assumptions supplied.
- The browser stages a scenario only after the viewer clicks **Add to draft**. Confirmation changes memory only. A scenario that includes hypothetical personal goals can be simulated before confirmation without adding those goals to the draft.
- Audio in the development transports is transient. Realtime sends audio directly to OpenAI for processing. Hosted extraction sends the current transcript and recent conversational context to the configured provider. Converge stores text and JSON in SQLite. **Clear profile and history** deletes the selected viewer’s sessions, transcripts and memory in Converge. Provider-side handling follows the provider’s settings and policies.
- The app mints at most ten Realtime or local admissions per process per rolling hour, counting failed startup attempts. A Realtime credential expires after 30 seconds. The browser releases audio on End, page hide, max duration or 30 seconds idle. The backend expires tool sessions and local sockets. OpenAI’s credential expiry limits when a call can start. Browser teardown applies the app cap to its Realtime connection.
- Local mode uses push-to-talk with a short PCM buffer and an energy-based VAD. It streams transient WAV fragments back to the browser. Quality, language coverage and latency depend on the installed local models. Recommendation preference weighting is a follow-up.

## Verification limits

The backend suite covers local voice with mocked speech and language models, the Realtime token contract, and the text agent’s end-to-end tool dispatch and fallback. See [the checkpoint log](VOICE_PROGRESS.md) for earlier iterations and [the audio checklist](VOICE_TEST.md) for verification with a physical microphone.
