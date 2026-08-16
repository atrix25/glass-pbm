import { getClock } from "@/lib/session";
import {
  getPitchBookStats,
  getPitchExperiences,
} from "@/lib/pitch/experiences";
import { buildPitchSlides } from "@/lib/pitch/slides";
import { PitchDeck } from "@/components/pitch-deck";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Plan sponsor pitch",
};

export default async function PitchPage() {
  const clock = await getClock();
  const [stats, experiences] = await Promise.all([
    getPitchBookStats(clock),
    getPitchExperiences(clock),
  ]);
  const { slides, byId } = buildPitchSlides(experiences);
  const experienceMap = Object.fromEntries(byId.entries());

  return (
    <PitchDeck slides={slides} experiences={experienceMap} stats={stats} />
  );
}
