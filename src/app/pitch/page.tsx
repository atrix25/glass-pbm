import { prisma } from "@/lib/db";
import { buildPitchSlides } from "@/lib/pitch";
import { formatNumber } from "@/lib/utils";
import { PitchDeck } from "./deck";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pitch — Glass",
  description:
    "Glass pitch deck: transparent pharmacy benefit management where every dollar shows its derivation.",
};

async function liveFigures() {
  const [members, claims, sources] = await Promise.all([
    prisma.member.count(),
    prisma.claim.count(),
    prisma.sourceDocument.count(),
  ]);
  return {
    lives: formatNumber(members),
    claims: formatNumber(claims),
    sources: formatNumber(sources),
  };
}

export default async function PitchPage() {
  let figures = {
    lives: "~100,000",
    claims: "running book",
    sources: "22",
  };

  try {
    figures = await liveFigures();
  } catch {
    // Local setups without the seeded book still get a presentable deck.
  }

  const slides = buildPitchSlides(figures);
  return <PitchDeck slides={slides} />;
}
