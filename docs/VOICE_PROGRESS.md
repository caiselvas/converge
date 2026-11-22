# Voice progress

- M1 — done. Person-scoped SQLite, text controller, strict extraction with offline fallback, tools, grounding flag, API and CLI. Seven targeted tests and the unchanged demo replay passed.
- M2 — implemented. Four mocked mint/limits tests, TypeScript, ESLint, the unchanged demo replay and off/enabled headless renders passed. Live mint blocked because no OpenAI key is configured. No real audio was started.
- M3 — implemented. Fake STT, LLM and TTS passed through the WebSocket, including silence rejection and grounded tool results. Faster Whisper, Piper and real local model execution remain unverified. No models were downloaded.
- Stretch — follow-up. The existing recommendation scoring and demo defaults are unchanged.
- Docs — done. Voice setup, decisions, safeguards and manual test are documented. Final checks passed (15 targeted tests, TypeScript, ESLint and the unchanged demo replay).
