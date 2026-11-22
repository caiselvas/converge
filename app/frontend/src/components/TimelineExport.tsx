"use client";

import { Download, Share2 } from "lucide-react";
import { useState } from "react";

import { timelineImage } from "@/lib/timeline-image";
import type { WhatIfResult } from "@/lib/types";
import { Button } from "./ui";

export function TimelineExport({ results }: { results: WhatIfResult[] }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!results.length) return null;

  async function exportImage(share: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const blob = await timelineImage(results);
      const file = new File([blob], "converge-timelines.png", { type: "image/png" });
      if (share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Converge financial timelines" });
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.name;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        setMessage(share ? "Image downloaded for sharing." : "Image downloaded.");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setMessage(error instanceof Error ? error.message : "Could not export the image.");
      }
    } finally {
      setBusy(false);
    }
  }

  return <div className="flex flex-wrap items-center gap-2">
    <Button variant="secondary" disabled={busy} onClick={() => void exportImage(false)}><Download size={15} /> Download timeline image</Button>
    <Button variant="ghost" disabled={busy} onClick={() => void exportImage(true)}><Share2 size={15} /> Share image</Button>
    <p role="status" className="text-xs text-muted">{message}</p>
  </div>;
}
