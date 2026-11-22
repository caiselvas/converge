import { call } from "./api";
import type { Change } from "./types";

export type VoiceState = "connecting" | "listening" | "thinking" | "speaking";
export type Speaker = "user" | "assistant";
export type MemoryItem = {
  id: number;
  key: string;
  value: string | number | null;
  kind: "fact" | "inference" | "unknown";
  status: "pending" | "confirmed" | "rejected";
  quote: string | null;
  why: string | null;
};
type IngestResult = { memory: MemoryItem[]; grounded: boolean };
type ToolResult = Record<string, unknown> & { draft_changes?: Change[]; memory?: MemoryItem[] };

export type VoiceStatus = { provider: "off" | "openai_realtime" | "local"; enabled: boolean; reason: string | null };
export type VoiceSession = {
  provider: "openai_realtime" | "local";
  session_id: string;
  ends_at: number;
  idle_seconds: number;
  token?: string;
  call_url?: string;
  socket_path?: string;
};

export const voiceApi = {
  startText: (person: string) => call<{ session_id: string }>("/twin/session", { json: { person } }),
  status: () => call<VoiceStatus>("/voice/status"),
  start: (person: string, signal: AbortSignal) => call<VoiceSession>("/voice/session", { json: { person }, signal }),
  ingest: (session_id: string, speaker: Speaker, text: string, signal: AbortSignal) =>
    call<IngestResult>("/twin/ingest", { json: { session_id, speaker, text }, signal }),
  tool: (session_id: string, name: string, args: Record<string, unknown>, draft: Change[], signal?: AbortSignal) =>
    call<ToolResult>("/twin/tool", { json: { session_id, name, args, draft }, signal }),
  memory: (person: string) => call<{ memory: MemoryItem[] }>(`/twin/memory?person=${encodeURIComponent(person)}`),
  clear: (person: string) =>
    call<{ memory: MemoryItem[] }>(`/twin/memory?person=${encodeURIComponent(person)}`, { method: "DELETE" }),
  resolve: (person: string, id: number, action: "confirm" | "reject") =>
    call<{ memory: MemoryItem[] }>(`/twin/memory/${id}/${action}`, { json: { person } }),
};

export type Transport = {
  session: VoiceSession;
  stream: MediaStream;
  signal: AbortSignal;
  activity: () => void;
  state: (state: VoiceState) => void;
  transcript: (speaker: Speaker, text: string, grounded?: boolean) => void | Promise<void>;
  tool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  error: (message: string) => void;
};

type FunctionCall = { type: string; call_id?: string; name?: string; arguments?: string };

type RealtimeEvent = {
  type: string;
  transcript?: string;
  response?: { status: string; output: FunctionCall[] };
};

export async function connectRealtime({ session, stream, signal, activity, state, transcript, tool, error }: Transport) {
  if (!session.token || session.call_url !== "https://api.openai.com/v1/realtime/calls") {
    throw new Error("Voice could not obtain a Realtime connection.");
  }
  const connection = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  const channel = connection.createDataChannel("oai-events");
  function close() {
    channel.close();
    connection.close();
    audio.pause();
    audio.srcObject = null;
  }
  signal.addEventListener("abort", close, { once: true });
  connection.ontrack = (event) => { audio.srcObject = event.streams[0] ?? new MediaStream([event.track]); };
  stream.getAudioTracks().forEach((track) => connection.addTrack(track, stream));
  connection.onconnectionstatechange = () => {
    if (connection.connectionState === "failed" && !signal.aborted) error("Voice lost its connection.");
  };
  const send = (message: object) => {
    if (!signal.aborted && channel.readyState === "open") channel.send(JSON.stringify(message));
  };
  let queue = Promise.resolve();
  let revision = 0;
  let rounds = 0;
  const respond = (askFirst = false) => send(askFirst
    ? { type: "response.create", response: { tool_choice: { type: "function", name: "next_question" } } }
    : { type: "response.create" });
  channel.onopen = () => {
    activity();
    state("listening");
    respond(true);
  };
  channel.onclose = () => { if (!signal.aborted) error("Voice connection ended."); };
  channel.onmessage = ({ data }) => {
    if (signal.aborted || typeof data !== "string") return;
    let event: RealtimeEvent;
    try { event = JSON.parse(data); } catch { return; }
    if (event.type === "input_audio_buffer.speech_started") {
      revision++;
      activity();
      state("listening");
      return;
    }
    const turn = revision;
    queue = queue.then(async () => {
      if (signal.aborted) return;
      switch (event.type) {
        case "conversation.item.input_audio_transcription.completed":
          activity();
          rounds = 0;
          if (event.transcript?.trim()) await transcript("user", event.transcript);
          if (turn === revision) respond(true);
          break;
        case "conversation.item.input_audio_transcription.failed":
          error("Voice could not transcribe the last turn.");
          break;
        case "response.created":
          activity();
          state("thinking");
          break;
        case "response.output_audio_transcript.delta":
          activity();
          state("speaking");
          break;
        case "response.output_audio_transcript.done":
          if (event.transcript?.trim()) await transcript("assistant", event.transcript);
          break;
        case "response.done": {
          const response = event.response;
          if (response?.status === "failed" || response?.status === "incomplete") {
            error("OpenAI could not complete the voice response.");
            break;
          }
          if (response?.status !== "completed") break;
          const calls = response.output.filter((item) => item.type === "function_call" && item.name && item.call_id);
          if (!calls.length) {
            state("listening");
            break;
          }
          if (++rounds > 4 || calls.length > 6) {
            error("Voice reached its tool limit for this turn.");
            break;
          }
          for (const item of calls) {
            let result: ToolResult;
            try {
              result = await tool(item.name!, JSON.parse(item.arguments || "{}"));
            } catch (e) {
              result = { error: e instanceof Error ? e.message : "Invalid discovery tool call." };
            }
            send({ type: "conversation.item.create", item: {
              type: "function_call_output", call_id: item.call_id, output: JSON.stringify(result),
            } });
          }
          if (turn === revision) respond();
          break;
        }
        case "error":
          error("OpenAI voice reported a connection error.");
      }
    }).catch(() => { if (!signal.aborted) error("Voice could not process the last turn."); });
  };

  try {
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    const answer = await fetch(session.call_url, {
      method: "POST", body: offer.sdp, signal,
      headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/sdp" },
    });
    if (!answer.ok) throw new Error("OpenAI could not connect voice.");
    await connection.setRemoteDescription({ type: "answer", sdp: await answer.text() });
  } catch (e) {
    close();
    throw e;
  }
}

type LocalEvent = {
  type: string;
  state?: VoiceState;
  speaker?: Speaker;
  text?: string;
  grounded?: boolean;
  memory?: MemoryItem[];
  draft_changes?: Change[];
  message?: string;
};

export async function connectLocal({
  session, stream, signal, activity, state, transcript, error, onResult, draft,
}: Transport & { onResult: (result: ToolResult) => void; draft: () => Change[] }) {
  if (!session.socket_path?.startsWith("/api/voice/local/ws/")) {
    throw new Error("Voice could not obtain a local connection.");
  }
  const url = new URL(session.socket_path, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const context = new AudioContext({ sampleRate: 16000 });
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  signal.addEventListener("abort", () => {
    socket.close();
    void context.close();
  }, { once: true });

  let recording = false;
  let playback = Promise.resolve();
  let nextAudio = 0;
  socket.onmessage = ({ data }) => {
    if (signal.aborted) return;
    activity();
    if (data instanceof ArrayBuffer) {
      playback = playback.then(async () => {
        const buffer = await context.decodeAudioData(data);
        if (signal.aborted) return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        const time = Math.max(context.currentTime, nextAudio);
        source.start(time);
        nextAudio = time + buffer.duration;
      }).catch(() => { if (!signal.aborted) error("Local voice could not play the reply."); });
      return;
    }
    try {
      const event: LocalEvent = JSON.parse(data);
      if (event.type === "state" && event.state) {
        if (event.state === "listening") {
          void playback.then(() => {
            const settle = Math.max(0, (nextAudio - context.currentTime) * 1000);
            window.setTimeout(() => { if (!signal.aborted) state("listening"); }, settle);
          });
        } else state(event.state);
      }
      if (event.type === "transcript" && event.speaker && event.text) {
        void transcript(event.speaker, event.text, event.grounded ?? true);
      }
      if (event.memory || event.draft_changes) onResult(event);
      if (event.type === "error") error(event.message ?? "Local voice could not finish.");
    } catch {
      error("Local voice sent an unreadable reply.");
    }
  };
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => {
      if (socket.readyState !== WebSocket.OPEN) reject(new Error("Could not connect to the local voice server."));
    };
    socket.onclose = ({ reason }) => {
      reject(new Error("Local voice connection ended."));
      if (!signal.aborted) error(reason || "Local voice connection ended.");
    };
  });
  if (signal.aborted) throw new Error("Local voice connection ended.");
  if (context.sampleRate !== 16000 || !context.audioWorklet) {
    throw new Error("This browser cannot capture local voice at 16 kHz.");
  }
  await context.resume();
  await context.audioWorklet.addModule("/voice-pcm.js");
  const pcm = new AudioWorkletNode(context, "voice-pcm");
  const silent = context.createGain();
  silent.gain.value = 0;
  context.createMediaStreamSource(stream).connect(pcm).connect(silent).connect(context.destination);
  pcm.port.onmessage = ({ data }) => {
    if (recording && socket.readyState === WebSocket.OPEN) socket.send(data);
  };

  let timer: number | undefined;
  function talk(enabled: boolean) {
    if (signal.aborted || socket.readyState !== WebSocket.OPEN) return;
    activity();
    recording = enabled;
    pcm.port.postMessage(enabled ? "start" : "end");
    if (enabled) {
      socket.send(JSON.stringify({ type: "start", draft: draft() }));
      timer = window.setTimeout(() => talk(false), 14_500);
    } else {
      window.clearTimeout(timer);
      state("thinking");
      socket.send(JSON.stringify({ type: "end" }));
    }
  }
  signal.addEventListener("abort", () => window.clearTimeout(timer), { once: true });
  return talk;
}
