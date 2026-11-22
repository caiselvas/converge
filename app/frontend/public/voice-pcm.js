/* global AudioWorkletProcessor, registerProcessor */
class VoicePCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(640);
    this.offset = 0;
    this.recording = false;
    this.port.onmessage = ({ data }) => {
      this.recording = data === "start";
      this.offset = 0;
    };
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples || !this.recording) return true;
    for (const sample of samples) {
      const bounded = Math.max(-1, Math.min(1, sample));
      this.frame[this.offset++] = bounded < 0 ? bounded * 0x8000 : bounded * 0x7fff;
      if (this.offset === this.frame.length) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(640);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("voice-pcm", VoicePCM);
