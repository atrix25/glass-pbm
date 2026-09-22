import { DEMO_MEMBER_STORIES } from "@/lib/demo-members";

export const MEMBER_CALL_SCENARIOS = DEMO_MEMBER_STORIES.map((member, index) => ({
  id: member.id,
  member: member.name,
  title: ["Prescription costs", "Prior authorization", "Coverage denial", "Refill timing"][index],
  description: [
    "A member still pays after reaching her limit.",
    "A member checks approval and specialty access.",
    "A member asks about a denial and alternatives.",
    "A member needs help with an early refill.",
  ][index],
  questions: [member.prompt, [
    "What have I paid for prescriptions this year?",
    "Where can I fill my Skyrizi prescription?",
    "Are there covered alternatives to Skyrizi?",
    "Which pharmacies are in my network?",
  ][index]],
}));

MEMBER_CALL_SCENARIOS.push({
  id: "clinical-question",
  member: DEMO_MEMBER_STORIES[1].name,
  title: "Clinical handoff",
  description: "A member asks for treatment advice.",
  questions: ["Should I stop taking Skyrizi?"],
});

export function scenarioMemberId(id: string) {
  return id === "clinical-question" ? DEMO_MEMBER_STORIES[1].id : id;
}
