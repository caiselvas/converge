"use client";

import { CircleUserRound } from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { VoicePanel } from "@/components/VoicePanel";
import { scopedHref, useStore } from "@/lib/store";

const desktopQuery = "(min-width: 768px)";

function subscribe(listener: () => void) {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

function isMobile() {
  return !window.matchMedia(desktopQuery).matches;
}

export default function CallPage() {
  const { scope, viewer } = useStore();
  const mobile = useSyncExternalStore<boolean | null>(subscribe, isMobile, () => null);
  if (mobile === null) return null;

  return (
    <div className="mx-auto mt-10 max-w-sm">
      {mobile ? <>
        <h1 className="text-2xl font-semibold tracking-tight">Call the finance agent</h1>
        <p className="mb-4 mt-2 text-sm leading-relaxed text-muted">Talk through your goals and what you’re willing to change. The agent saves what it learns to your profile for review.</p>
        {viewer && <VoicePanel key={viewer} person={viewer} />}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm font-medium text-accent">
          <Link href={scopedHref("/profile", scope)} className="inline-flex items-center gap-1.5 hover:underline"><CircleUserRound size={16} /> Review your profile</Link>
          <Link href={scopedHref("/agent", scope)} className="hover:underline">Continue in chat</Link>
        </div>
      </> : <section className="rounded-2xl border border-line bg-white p-6">
        <h1 className="text-xl font-semibold">Open the call on mobile</h1>
        <Link href={scopedHref("/agent", scope)} className="mt-4 inline-flex text-sm font-medium text-accent hover:underline">Back to chat</Link>
      </section>}
    </div>
  );
}
