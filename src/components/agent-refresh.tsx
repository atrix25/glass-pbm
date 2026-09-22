"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
export function AgentRefresh() {
  const router = useRouter(); const [pending,start] = useTransition();
  return <button aria-label="Refresh" className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs text-ink-600 disabled:opacity-50" disabled={pending} onClick={()=>start(()=>router.refresh())}><RefreshCw size={13}/><span role="status">{pending ? "Refreshing…" : "Refresh"}</span></button>;
}
