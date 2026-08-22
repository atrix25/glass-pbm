import type { ReactNode } from "react";
import { requirePageSession } from "@/lib/require-auth";

/**
 * Pitch deck chrome is self-contained. No sidebar, demo rail, or clock bar —
 * those belong to the operating product, not the room presentation.
 */
export default async function PitchLayout({ children }: { children: ReactNode }) {
  await requirePageSession();
  return children;
}
