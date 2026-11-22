"use client";

import { ShieldCheck } from "lucide-react";

import type { Evaluation } from "@/lib/types";
import { Tip, clsx } from "./ui";

export function ChecksBadge({ ev }: { ev: Evaluation }) {
  const c = ev.checks;
  return (
    <Tip
      content={
        <div className="space-y-0.5">
          <div className="font-semibold">Accounting identities, checked on every run</div>
          <div>Opening cash + net flows = closing cash: max error CHF {Number(c.cash_identity_max_error).toExponential(1)}</div>
          <div>Partner transfers cancel at household level: {Number(c.transfers_cancel_max_error).toExponential(1)}</div>
          <div>Net worth = assets − liabilities: {Number(c.net_worth_identity_max_error).toExponential(1)}</div>
          <div>Property & mortgage shares sum to totals: {Number(c.ownership_split_max_error).toExponential(1)}</div>
        </div>
      }
    >
      <span tabIndex={0} className={clsx("inline-flex items-center gap-1 text-[12px]", c.ok ? "text-good" : "text-bad-strong")}>
        <ShieldCheck size={13} /> {c.ok ? "Accounting checks pass" : "Accounting check failed"}
      </span>
    </Tip>
  );
}

