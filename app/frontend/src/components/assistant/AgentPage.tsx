"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { scopedHref, useStore } from "@/lib/store";
import { AssistantConversation } from "./Assistant";

/** Full-page assistant (deep link /agent). Same conversation as the panel. */
export function AgentPage() {
  const { viewer, scope } = useStore();
  return (
    <div className="mx-auto max-w-[760px] pt-5 sm:pt-8">
      <Link href={scopedHref("/", scope)} className="inline-flex min-h-10 items-center gap-1 text-[14px] font-medium text-muted hover:text-ink">
        <ArrowLeft size={15} /> Overview
      </Link>
      <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-[-0.02em] sm:text-[32px]">Assistant</h1>
      <p className="mt-1.5 mb-5 max-w-xl text-[15px] leading-6 text-muted">
        Talk through a goal, ask why an option protects one of you better, or test a change. The engine calculates every figure.
      </p>
      {viewer && <AssistantConversation key={viewer} person={viewer} decision={null} page />}
    </div>
  );
}
