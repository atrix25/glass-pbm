import type { ReactNode } from "react";

/**
 * Pitch deck chrome is self-contained. No sidebar, demo rail, or clock bar —
 * those belong to the operating product, not the room presentation.
 */
export default function PitchLayout({ children }: { children: ReactNode }) {
  return children;
}
