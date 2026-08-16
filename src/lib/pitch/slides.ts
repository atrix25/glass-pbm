/**
 * Interactive pitch deck slide order.
 *
 * Narrative slides (title, problem, pillars, ask) plus experience slides that
 * deep-link into recorded paths through the live book.
 */

import type { PitchExperience } from "./experiences";

export type PitchSlide =
  | {
      kind: "title";
      id: string;
      eyebrow: string;
      title: string;
      lede: string;
    }
  | {
      kind: "problem";
      id: string;
      eyebrow: string;
      title: string;
      lede: string;
    }
  | {
      kind: "pillars";
      id: string;
      eyebrow: string;
      title: string;
      lede: string;
    }
  | {
      kind: "experience";
      id: string;
      experienceId: string;
    }
  | {
      kind: "ask";
      id: string;
      eyebrow: string;
      title: string;
    };

/** Static spine. Experience slides are filled from DB-resolved experiences. */
export const PITCH_SPINE: PitchSlide[] = [
  {
    kind: "title",
    id: "title",
    eyebrow: "Transparent pharmacy benefit management",
    title: "Glass for plan sponsors",
    lede:
      "Best-in-class reporting, radical transparency without locking you into one fee model, and member service that answers in chat and text — from the same rules that adjudicate the claim.",
  },
  {
    kind: "problem",
    id: "problem",
    eyebrow: "The status quo",
    title: "What sponsors are tired of",
    lede:
      "Reports that cannot be checked, fees that hide inside drug cost, and member service that cannot explain a reject.",
  },
  {
    kind: "pillars",
    id: "pillars",
    eyebrow: "The offer",
    title: "Three pillars",
    lede:
      "Reporting, transparency with flexible pricing, and service by chat and text. Everything else is packaging.",
  },
  // Experience order — ids must match getPitchExperiences()
  { kind: "experience", id: "exp-book", experienceId: "book-spend" },
  { kind: "experience", id: "exp-claim", experienceId: "claim-derivation" },
  { kind: "experience", id: "exp-margaret", experienceId: "mbr-DEMO-0001-01" },
  { kind: "experience", id: "exp-david", experienceId: "mbr-DEMO-0002-01" },
  { kind: "experience", id: "exp-jennifer", experienceId: "mbr-DEMO-0003-01" },
  { kind: "experience", id: "exp-thomas", experienceId: "mbr-DEMO-0004-01" },
  { kind: "experience", id: "exp-nps", experienceId: "member-experience" },
  { kind: "experience", id: "exp-changes", experienceId: "change-console" },
  { kind: "experience", id: "exp-pa", experienceId: "pa-criteria" },
  { kind: "experience", id: "exp-data", experienceId: "data-agent" },
  {
    kind: "ask",
    id: "ask",
    eyebrow: "Next step",
    title: "The ask",
  },
];

export function buildPitchSlides(
  experiences: PitchExperience[],
): { slides: PitchSlide[]; byId: Map<string, PitchExperience> } {
  const byId = new Map(experiences.map((e) => [e.id, e]));
  const slides = PITCH_SPINE.filter((s) => {
    if (s.kind !== "experience") return true;
    return byId.has(s.experienceId);
  });
  return { slides, byId };
}
