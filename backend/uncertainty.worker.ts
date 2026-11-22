import { uncertainty } from "./uncertainty";
import type { Plan } from "./types";
self.onmessage = (event: MessageEvent<{ id: number; plan: Plan }>) => {
  try {
    self.postMessage({
      id: event.data.id,
      result: uncertainty(event.data.plan),
    });
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : "Simulation failed",
    });
  }
};
